import type { APIResponse, Page } from '@playwright/test';

import {
  assertSafeAiPersonaSeedTarget,
  createAiPersonaSeedPlan
} from '../../../scripts/ai-persona-seeds.mjs';
import type { HouseholdKey } from '../../../scripts/ai-persona-seeds.mjs';
import { loginUser, logout, registerUser } from './auth';

const AUTH_TOKEN_KEY = 'hogar:v1:auth_token';

export interface SeededPersonaAccount {
  key: string;
  email: string;
  userId: string;
  token: string;
  householdId: string | null;
}

export interface SeededHouseholdMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface SeededPersonaHousehold {
  id: string;
  name: string;
  members: SeededHouseholdMember[];
}

export interface SeededPersonaMatrix {
  accounts: Record<string, SeededPersonaAccount>;
  households: Record<HouseholdKey, SeededPersonaHousehold>;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface PersistedTasteResponse {
  taste: {
    goals: string[];
    allergies: string[];
    likes: string[];
    dislikes: string[];
    notes: string;
  };
  profile: { cookingLevel: string; modules: string[] };
}

interface CreatedHousehold {
  id: string;
  name: string;
  inviteCode: string;
}

interface HouseholdSnapshot extends CreatedHousehold {
  members: SeededHouseholdMember[];
}

async function apiJson<T>(
  page: Page,
  origin: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  token: string,
  data?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  allowEmptyData = false
): Promise<T> {
  const response: APIResponse = await page.request.fetch(new URL(path, origin).toString(), {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      ...extraHeaders
    },
    ...(data ? { data } : {})
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (
    !response.ok() ||
    !payload ||
    payload.success === false ||
    (!allowEmptyData && payload.data === undefined)
  ) {
    throw new Error(method + ' ' + path + ' failed with HTTP ' + response.status() + '.');
  }
  return payload.data as T;
}

async function readAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), AUTH_TOKEN_KEY);
  if (!token) throw new Error('Synthetic E2E registration did not create an access token.');
  return token;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function seedAiPersonaMatrix(page: Page, runId: string): Promise<SeededPersonaMatrix> {
  await page.goto('/auth/login');
  const origin = new URL(page.url()).origin;
  const isolated = assertSafeAiPersonaSeedTarget({
    optIn: process.env.HOGARIA_AI_SEED_GENERATION,
    origin,
    databasePath: process.env.DATABASE_PATH,
    runDirectory: process.env.E2E_RUN_DIR,
    environment: process.env
  });
  const plan = createAiPersonaSeedPlan(runId);
  const accounts: Record<string, SeededPersonaAccount> = Object.create(null) as Record<
    string,
    SeededPersonaAccount
  >;

  for (const [index, persona] of plan.users.entries()) {
    if (index > 0) await logout(page);
    const email = await registerUser(page, persona.name, persona.email);
    const token = await readAccessToken(page);
    accounts[persona.key] = {
      key: persona.key,
      email,
      userId: '',
      token,
      householdId: null
    };
  }

  await logout(page);
  const households = {} as SeededPersonaMatrix['households'];
  for (const householdKey of Object.keys(plan.households) as HouseholdKey[]) {
    const descriptor = plan.households[householdKey];
    const ownerPersona = plan.users.find(
      (user) => user.householdKey === householdKey && user.role === 'admin'
    );
    if (!ownerPersona) throw new Error('Persona household has no synthetic admin.');
    const owner = accounts[ownerPersona.key];
    const created = await apiJson<CreatedHousehold>(
      page,
      isolated.origin,
      'POST',
      '/api/household',
      owner.token,
      { name: descriptor.name, sharedPantry: true }
    );
    const householdId = requireString(created?.id, 'Synthetic household did not return an id.');
    const inviteCode = requireString(
      created?.inviteCode,
      'Synthetic household did not return an invite.'
    );

    for (const memberKey of descriptor.memberKeys) {
      const persona = plan.users.find((user) => user.key === memberKey);
      if (!persona || persona.key === ownerPersona.key) continue;
      const member = accounts[persona.key];
      await apiJson(
        page,
        isolated.origin,
        'POST',
        '/api/household/join',
        member.token,
        { inviteCode },
        {},
        true
      );
      member.householdId = householdId;
    }
    owner.householdId = householdId;

    const beforeRoles = await apiJson<HouseholdSnapshot>(
      page,
      isolated.origin,
      'GET',
      '/api/household',
      owner.token
    );
    for (const persona of plan.users.filter((user) => user.householdKey === householdKey)) {
      const member = beforeRoles.members.find(
        (candidate) => candidate.email === accounts[persona.key].email
      );
      if (!member) throw new Error('Synthetic household member is missing.');
      accounts[persona.key].userId = member.userId;
      if (persona.role === 'admin') continue;
      if (persona.role === member.role) continue;
      await apiJson(page, isolated.origin, 'PATCH', '/api/household', owner.token, {
        memberId: member.id,
        memberRole: persona.role
      });
    }

    for (const memberKey of descriptor.memberKeys) {
      const member = accounts[memberKey];
      await apiJson(
        page,
        isolated.origin,
        'PATCH',
        '/api/household/meal-planning',
        member.token,
        { member: { goalOverrideEnabled: true } },
        { 'x-household-id': householdId }
      );
    }

    const result = await apiJson<HouseholdSnapshot>(
      page,
      isolated.origin,
      'GET',
      '/api/household',
      owner.token
    );
    if (result.members.length !== descriptor.memberKeys.length) {
      throw new Error('Synthetic household member count does not match its fixture.');
    }
    for (const persona of plan.users.filter((user) => user.householdKey === householdKey)) {
      const member = result.members.find(
        (candidate) => candidate.email === accounts[persona.key].email
      );
      if (!member) throw new Error('Synthetic household member is missing from final snapshot.');
      accounts[persona.key].userId = member.userId;
    }
    households[householdKey] = {
      id: householdId,
      name: result.name,
      members: result.members
    };
  }

  for (const persona of plan.users) {
    const account = accounts[persona.key];
    if (!account.userId || !account.householdId) {
      throw new Error('Synthetic account did not complete household setup.');
    }
    await apiJson(page, isolated.origin, 'PATCH', '/api/auth/taste', account.token, {
      taste: persona.taste,
      cookingLevel: persona.cookingLevel,
      modules: persona.modules,
      onboardingStatus: 'done'
    });
    const persisted = await apiJson<PersistedTasteResponse>(
      page,
      isolated.origin,
      'GET',
      '/api/auth/taste',
      account.token
    );
    if (
      !sameStrings(persisted.taste.goals, persona.taste.goals) ||
      !sameStrings(persisted.taste.allergies, persona.taste.allergies) ||
      !sameStrings(persisted.taste.likes, persona.taste.likes) ||
      !sameStrings(persisted.taste.dislikes, persona.taste.dislikes) ||
      persisted.taste.notes !== persona.taste.notes ||
      persisted.profile.cookingLevel !== persona.cookingLevel ||
      !sameStrings(persisted.profile.modules, persona.modules)
    ) {
      throw new Error('Synthetic account taste profile did not persist.');
    }
  }

  return { accounts, households };
}

export async function activateAiPersona(page: Page, account: SeededPersonaAccount): Promise<void> {
  await logout(page);
  await loginUser(page, account.email);
}
