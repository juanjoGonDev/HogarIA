import { resolve } from 'node:path';

import { validateIsolatedEnvironment } from '../server/tests/support/e2e-isolation.mjs';

const COOKING_LEVELS = ['none', 'beginner', 'intermediate', 'expert'];
const TASTE_GOALS = [
  'balanced',
  'weight-loss',
  'weight-gain',
  'muscle-gain',
  'maintenance',
  'variety',
  'custom'
];
const HOME_MODULES = ['meals', 'pantry', 'shopping', 'receipts', 'home'];
const DIET_TYPES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo'];
const SPICE_TOLERANCES = ['low', 'medium', 'high'];
const PORTION_SIZES = ['small', 'medium', 'large'];
const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe'];

const PERSONAS = [
  {
    key: 'solo-beginner',
    name: 'Perfil solo principiante',
    accountType: 'solo',
    cookingLevel: 'none',
    goals: ['balanced'],
    modules: ['meals'],
    allergies: [],
    likes: ['arroz'],
    dislikes: [],
    householdKey: 'solo-one',
    role: 'admin',
    memberProfile: null
  },
  {
    key: 'solo-allergy',
    name: 'Perfil solo con alergia',
    accountType: 'solo',
    cookingLevel: 'beginner',
    goals: ['weight-loss'],
    modules: ['pantry', 'shopping', 'receipts'],
    allergies: ['cacahuete'],
    likes: ['lentejas'],
    dislikes: ['cilantro'],
    householdKey: 'solo-two',
    role: 'admin',
    memberProfile: null
  },
  {
    key: 'couple-owner',
    name: 'Perfil pareja administrador',
    cookingLevel: 'intermediate',
    goals: ['variety'],
    modules: ['receipts'],
    allergies: ['huevo'],
    likes: ['verduras'],
    dislikes: [],
    householdKey: 'couple',
    role: 'admin',
    memberProfile: {
      dietType: 'vegetarian',
      cuisinePreferences: ['mediterranean'],
      spiceTolerance: 'low',
      portionSize: 'small',
      allergies: [{ name: 'huevo', severity: 'mild' }],
      dislikes: []
    }
  },
  {
    key: 'couple-member',
    name: 'Perfil pareja miembro',
    cookingLevel: 'expert',
    goals: ['muscle-gain'],
    modules: ['home'],
    allergies: [],
    likes: ['pescado'],
    dislikes: ['berenjena'],
    householdKey: 'couple',
    role: 'member',
    memberProfile: {
      dietType: 'omnivore',
      cuisinePreferences: ['japanese'],
      spiceTolerance: 'high',
      portionSize: 'large',
      allergies: [],
      dislikes: ['berenjena']
    }
  },
  {
    key: 'family-owner',
    name: 'Perfil hogar administrador',
    cookingLevel: 'beginner',
    goals: ['maintenance'],
    modules: ['meals', 'home'],
    allergies: ['sésamo'],
    likes: ['patata'],
    dislikes: [],
    householdKey: 'family',
    role: 'admin',
    memberProfile: {
      dietType: 'omnivore',
      cuisinePreferences: ['mediterranean'],
      spiceTolerance: 'medium',
      portionSize: 'medium',
      allergies: [{ name: 'sésamo', severity: 'moderate' }],
      dislikes: []
    }
  },
  {
    key: 'family-member-1',
    name: 'Perfil hogar miembro uno',
    cookingLevel: 'none',
    goals: ['weight-gain'],
    modules: ['pantry'],
    allergies: [],
    likes: ['pasta'],
    dislikes: [],
    householdKey: 'family',
    role: 'member',
    memberProfile: {
      dietType: 'vegetarian',
      cuisinePreferences: ['italian'],
      spiceTolerance: 'low',
      portionSize: 'medium',
      allergies: [{ name: 'lactosa', severity: 'mild' }],
      dislikes: []
    }
  },
  {
    key: 'family-member-2',
    name: 'Perfil hogar miembro dos',
    cookingLevel: 'beginner',
    goals: ['custom'],
    modules: ['shopping'],
    allergies: ['marisco'],
    likes: ['garbanzos'],
    dislikes: ['cebolla'],
    householdKey: 'family',
    role: 'child',
    memberProfile: {
      dietType: 'vegan',
      cuisinePreferences: ['mexican'],
      spiceTolerance: 'high',
      portionSize: 'large',
      allergies: [{ name: 'marisco', severity: 'severe' }],
      dislikes: ['cebolla']
    }
  },
  {
    key: 'family-member-3',
    name: 'Perfil hogar miembro tres',
    cookingLevel: 'intermediate',
    goals: ['variety'],
    modules: ['receipts'],
    allergies: [],
    likes: ['tomate'],
    dislikes: [],
    householdKey: 'family',
    role: 'child',
    memberProfile: {
      dietType: 'pescatarian',
      cuisinePreferences: ['asian'],
      spiceTolerance: 'medium',
      portionSize: 'small',
      allergies: [],
      dislikes: []
    }
  },
  {
    key: 'family-member-4',
    name: 'Perfil hogar miembro cuatro',
    cookingLevel: 'expert',
    goals: ['balanced'],
    modules: ['meals'],
    allergies: ['huevo'],
    likes: ['quinoa'],
    dislikes: [],
    householdKey: 'family',
    role: 'child',
    memberProfile: {
      dietType: 'keto',
      cuisinePreferences: ['mediterranean'],
      spiceTolerance: 'low',
      portionSize: 'small',
      allergies: [{ name: 'huevo', severity: 'moderate' }],
      dislikes: []
    }
  },
  {
    key: 'family-member-5',
    name: 'Perfil hogar miembro cinco',
    cookingLevel: 'beginner',
    goals: ['weight-loss'],
    modules: ['home'],
    allergies: ['frutos secos'],
    likes: ['calabacín'],
    dislikes: [],
    householdKey: 'family',
    role: 'child',
    memberProfile: {
      dietType: 'paleo',
      cuisinePreferences: ['middle-eastern'],
      spiceTolerance: 'high',
      portionSize: 'large',
      allergies: [{ name: 'frutos secos', severity: 'severe' }],
      dislikes: []
    }
  }
];

function assertRunId(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(runId)) {
    throw new Error('AI persona seed run id must contain 1-32 letters, numbers, "_" or "-".');
  }
  return runId.toLowerCase();
}

function toUser(persona, runId) {
  return {
    key: persona.key,
    accountType: persona.accountType ?? 'household-member',
    name: persona.name,
    email: `ai-${runId}-${persona.key}@hogaria.test`,
    cookingLevel: persona.cookingLevel,
    taste: {
      goals: [...persona.goals],
      allergies: [...persona.allergies],
      likes: [...persona.likes],
      dislikes: [...persona.dislikes],
      notes: persona.memberProfile
        ? 'Preferencias sintéticas: dieta ' +
          persona.memberProfile.dietType +
          '; picante ' +
          persona.memberProfile.spiceTolerance +
          '; ración ' +
          persona.memberProfile.portionSize +
          '; alergias ' +
          (persona.memberProfile.allergies
            .map((allergy) => allergy.name + ' (' + allergy.severity + ')')
            .join(', ') || 'ninguna') +
          '.'
        : '',
      goalNotes: ''
    },
    modules: [...persona.modules],
    householdKey: persona.householdKey,
    role: persona.role,
    memberProfile: persona.memberProfile
      ? {
          ...persona.memberProfile,
          cuisinePreferences: [...persona.memberProfile.cuisinePreferences],
          allergies: persona.memberProfile.allergies.map((allergy) => ({ ...allergy })),
          dislikes: [...persona.memberProfile.dislikes]
        }
      : null
  };
}

export function createAiPersonaSeedPlan(runId) {
  const normalizedRunId = assertRunId(runId);
  const users = PERSONAS.map((persona) => toUser(persona, normalizedRunId));
  const householdKeys = ['solo-one', 'solo-two', 'couple', 'family'];
  const households = Object.fromEntries(
    householdKeys.map((key) => [
      key,
      {
        key,
        name: `Hogar sintético ${key} ${normalizedRunId}`,
        memberKeys: users.filter((user) => user.householdKey === key).map((user) => user.key)
      }
    ])
  );

  const coverage = {
    cookingLevels: [...COOKING_LEVELS],
    tasteGoals: [...TASTE_GOALS],
    homeModules: [...HOME_MODULES],
    dietTypes: [...DIET_TYPES],
    spiceTolerances: [...SPICE_TOLERANCES],
    portionSizes: [...PORTION_SIZES],
    allergySeverities: [...ALLERGY_SEVERITIES]
  };

  return { runId: normalizedRunId, users, households, coverage };
}

export function assertSafeAiPersonaSeedTarget({
  optIn,
  origin,
  databasePath,
  runDirectory,
  environment = process.env
}) {
  if (optIn !== '1') {
    throw new Error('AI persona seed writes require explicit opt-in.');
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('AI persona seed server origin must be valid loopback HTTP.');
  }
  if (
    parsedOrigin.protocol !== 'http:' ||
    parsedOrigin.hostname !== '127.0.0.1' ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    throw new Error('AI persona seed server origin must use loopback 127.0.0.1 over HTTP.');
  }

  const isolated = validateIsolatedEnvironment({
    ...environment,
    ...(runDirectory ? { E2E_RUN_DIR: runDirectory } : {}),
    ...(databasePath ? { DATABASE_PATH: databasePath } : {}),
    E2E_BASE_URL: parsedOrigin.origin
  });

  return {
    origin: isolated.baseUrl,
    databasePath: resolve(isolated.databasePath),
    runDirectory: isolated.runDir
  };
}
