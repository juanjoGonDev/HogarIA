import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.middleware.js';
import { createHouseholdSchema, joinHouseholdSchema } from '../schemas/household.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { seedDefaultsForHousehold, adoptPersonalRowsIntoHousehold } from '../utils/seed-data.js';
import { activeHouseholdId } from '../utils/household-context.js';
import { copyActivePersonalAiConfigToHousehold } from '../utils/household-ai-config.js';
import { initializeHouseholdMealPlanningFromCreator } from '../utils/household-meal-planning.store.js';

const householdRoutes = new Hono<AppEnv>();

// Generate invite code
function generateInviteCode(): string {
  return nanoid(8).toUpperCase();
}

function mapHousehold(raw: any) {
  return {
    id: raw.id,
    name: raw.name,
    inviteCode: raw.invite_code,
    sharedPantry: !!raw.shared_pantry,
    shareRecipes: !!raw.share_recipes,
    shareCalendar: !!raw.share_calendar,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    members: (raw.members || []).map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      name: m.name,
      email: m.email,
      avatar: m.avatar ?? undefined,
      role: m.role,
      cookingLevel: m.cooking_level,
      joinedAt: m.joined_at,
      isActive: m.is_active !== 0,
      permissions: m.permissions ? JSON.parse(m.permissions) : defaultPermissions(m.role)
    }))
  };
}

export function defaultPermissions(role: string) {
  // Default permissions by role. Granular flags allow fine-tuning later.
  if (role === 'admin') {
    return {
      pantry: { view: true, edit: true, manage: true },
      recipes: { view: true, create: true, edit: true, delete: true, generateAI: true },
      calendar: { view: true, edit: true },
      members: { invite: true, kick: true, manageRoles: true },
      settings: true
    };
  }
  if (role === 'child') {
    return {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
  }
  // member
  return {
    pantry: { view: true, edit: true, manage: false },
    recipes: { view: true, create: true, edit: false, delete: false, generateAI: true },
    calendar: { view: true, edit: true },
    members: { invite: false, kick: false, manageRoles: false },
    settings: false
  };
}

function canKickMember(membership: { role: string; permissions: string | null }): boolean {
  try {
    const permissions = JSON.parse(membership.permissions ?? '{}');
    const configuredPermission = permissions?.members?.kick;
    return typeof configuredPermission === 'boolean'
      ? configuredPermission
      : membership.role === 'admin';
  } catch {
    return false;
  }
}

// Public (no auth) invite info endpoint — so links work for non-logged users
householdRoutes.get('/invite/:code', optionalAuthMiddleware, async (c) => {
  const code = c.req.param('code');
  const db = getDatabase();

  const household = db
    .prepare('SELECT id, name FROM households WHERE invite_code = ?')
    .get(code) as any;
  if (!household) {
    return c.json({ success: false, message: 'Invalid invite code' }, 404);
  }

  const memberCount = db
    .prepare(
      'SELECT COUNT(*) as count FROM household_members WHERE household_id = ? AND is_active = 1'
    )
    .get(household.id) as any;

  return c.json({
    success: true,
    data: {
      householdId: household.id,
      householdName: household.name,
      memberCount: memberCount.count,
      alreadyMember: !!(
        c.get('userId') &&
        db
          .prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
          .get(household.id, c.get('userId'))
      )
    }
  });
});

// GET /api/household/memberships — list the user's homes and current selection
householdRoutes.get('/memberships', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const currentHouseholdId = activeHouseholdId(db, userId);
  const memberships = db
    .prepare(
      `SELECT h.id, h.name, hm.role, hm.permissions, hm.joined_at
         FROM household_members hm
         JOIN households h ON h.id = hm.household_id
        WHERE hm.user_id = ? AND hm.is_active = 1
        ORDER BY hm.joined_at ASC, h.id ASC`
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    role: string;
    permissions: string | null;
    joined_at: string;
  }>;

  return c.json({
    success: true,
    data: {
      activeHouseholdId: currentHouseholdId,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        name: membership.name,
        role: membership.role,
        permissions: membership.permissions
          ? JSON.parse(membership.permissions)
          : defaultPermissions(membership.role),
        joinedAt: membership.joined_at,
        active: membership.id === currentHouseholdId
      }))
    }
  });
});

// POST /api/household/active — change selection only to an existing membership
householdRoutes.post('/active', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const householdId = body && typeof body.householdId === 'string' ? body.householdId.trim() : '';
  if (!householdId) {
    return c.json({ success: false, message: 'Household is required' }, 400);
  }
  const db = getDatabase();
  const selected = db.transaction(() => {
    const membership = db
      .prepare(
        'SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ? AND is_active = 1'
      )
      .get(householdId, userId);
    if (!membership) return false;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
    return true;
  })();
  if (!selected) {
    return c.json({ success: false, message: 'Household membership not found' }, 404);
  }

  return c.json({ success: true, data: { activeHouseholdId: householdId } });
});

// POST /api/household/join/:code — join by code (also accepts the link from invite page)
householdRoutes.post('/join/:code', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code') || '';
  return doJoin(c, userId, code);
});

// GET /api/household
householdRoutes.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const selectedHouseholdId = activeHouseholdId(db, userId);

  if (!selectedHouseholdId) {
    return c.json({ success: true, data: null });
  }

  const household = db
    .prepare(
      `SELECT h.* FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE h.id = ? AND hm.user_id = ? AND hm.is_active = 1`
    )
    .get(selectedHouseholdId, userId) as any;
  if (!household) return c.json({ success: true, data: null });
  const members = db
    .prepare(
      `
    SELECT hm.id, hm.user_id, u.name, u.email, u.avatar, u.cooking_level, hm.role, hm.joined_at, hm.permissions, hm.is_active
    FROM household_members hm
    JOIN users u ON u.id = hm.user_id
    WHERE hm.household_id = ?
  `
    )
    .all(selectedHouseholdId);

  return c.json({
    success: true,
    data: mapHousehold({ ...household, members })
  });
});

// POST /api/household
householdRoutes.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = createHouseholdSchema.parse(body);

  const db = getDatabase();
  const id = nanoid();
  const inviteCode = generateInviteCode();

  db.transaction(() => {
    const hasMembership = Boolean(
      db.prepare('SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1').get(userId)
    );

    db.prepare(
      `
      INSERT INTO households (
        id, name, invite_code, shared_pantry, share_recipes, share_calendar
      ) VALUES (?, ?, ?, ?, 1, 1)
    `
    ).run(id, input.name, inviteCode, input.sharedPantry ? 1 : 0);

    const perms = JSON.stringify(defaultPermissions('admin'));
    db.prepare(
      `
      INSERT INTO household_members (id, household_id, user_id, role, permissions)
      VALUES (?, ?, ?, 'admin', ?)
    `
    ).run(nanoid(), id, userId, perms);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(id, userId);
    initializeHouseholdMealPlanningFromCreator(db, id, userId);
    copyActivePersonalAiConfigToHousehold(db, id, userId);

    // Solo la primera casa adopta las filas personales; crear otra no copia ni
    // mueve datos que ya pertenecen a otra casa.
    if (!hasMembership) adoptPersonalRowsIntoHousehold(db, id, userId);

    // Seed default pantry items and utensils for the household (assigned to admin)
    seedDefaultsForHousehold(db, id, userId);
  })();

  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(id) as any;
  const members = db
    .prepare(
      `
    SELECT hm.id, hm.user_id, u.name, u.email, u.avatar, u.cooking_level, hm.role, hm.joined_at, hm.permissions, hm.is_active
    FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE hm.household_id = ?
  `
    )
    .all(id);

  return c.json({ success: true, data: mapHousehold({ ...household, members }) }, 201);
});

// POST /api/household/join
householdRoutes.post('/join', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = joinHouseholdSchema.parse(body);
  return doJoin(c, userId, input.inviteCode);
});

async function doJoin(c: any, userId: string, inviteCode: string) {
  const db = getDatabase();

  const result = db.transaction((): 'invalid-invite' | 'already-member' | 'joined' => {
    const household = db
      .prepare('SELECT * FROM households WHERE invite_code = ?')
      .get(inviteCode) as any;
    if (!household) return 'invalid-invite';

    const existing = db
      .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
      .get(household.id, userId);
    if (existing) return 'already-member';

    const hasMembership = Boolean(
      db.prepare('SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1').get(userId)
    );

    const perms = JSON.stringify(defaultPermissions('member'));
    db.prepare(
      `
      INSERT INTO household_members (id, household_id, user_id, role, permissions)
      VALUES (?, ?, ?, 'member', ?)
    `
    ).run(nanoid(), household.id, userId, perms);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(household.id, userId);

    // Solo el primer hogar adopta filas personales; un segundo hogar no absorbe
    // datos personales ni de una casa a la que el usuario ya pertenece.
    if (!hasMembership) adoptPersonalRowsIntoHousehold(db, household.id, userId);
    seedDefaultsForHousehold(db, household.id, userId);
    return 'joined';
  })();

  if (result === 'invalid-invite') {
    return c.json({ success: false, message: 'Invalid invite code' }, 404);
  }
  if (result === 'already-member') {
    return c.json({ success: false, message: 'Already a member' }, 409);
  }

  return c.json({ success: true, message: 'Joined household' });
}

// PATCH /api/household — settings (admin only)
householdRoutes.patch('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  if (body?.memberRole !== undefined && !['admin', 'member', 'child'].includes(body.memberRole)) {
    return c.json({ success: false, message: 'Invalid member role' }, 400);
  }

  const db = getDatabase();
  const selectedHouseholdId = activeHouseholdId(db, userId);
  if (!selectedHouseholdId) {
    return c.json({ success: false, message: 'No household found' }, 404);
  }

  const membership = db
    .prepare(
      'SELECT role, permissions FROM household_members WHERE household_id = ? AND user_id = ?'
    )
    .get(selectedHouseholdId, userId) as { role: string; permissions: string | null } | undefined;
  const hasMemberActive = Object.prototype.hasOwnProperty.call(body ?? {}, 'memberActive');
  if (hasMemberActive && typeof body.memberActive !== 'boolean') {
    return c.json({ success: false, message: 'Member active status must be boolean' }, 400);
  }
  const hasHouseholdChanges =
    body.name !== undefined ||
    body.sharedPantry !== undefined ||
    body.shareRecipes !== undefined ||
    body.shareCalendar !== undefined;
  const hasRoleOrPermissionChanges = Boolean(body.memberRole || body.memberPermissions);
  const isStatusOnlyRequest =
    hasMemberActive && !hasHouseholdChanges && !hasRoleOrPermissionChanges;
  if (!membership || (membership.role !== 'admin' && !isStatusOnlyRequest)) {
    return c.json({ success: false, message: 'Only admins can change settings' }, 403);
  }
  if (hasMemberActive && !canKickMember(membership)) {
    return c.json({ success: false, message: 'Missing members.kick permission' }, 403);
  }

  const updatesMember = Boolean(body.memberId && (hasRoleOrPermissionChanges || hasMemberActive));
  if ((hasRoleOrPermissionChanges || hasMemberActive) && !body.memberId) {
    return c.json({ success: false, message: 'Member id is required' }, 400);
  }
  if (updatesMember) {
    const targetMember = db
      .prepare(
        'SELECT id, user_id, role, is_active FROM household_members WHERE id = ? AND household_id = ?'
      )
      .get(body.memberId, selectedHouseholdId) as
      { id: string; user_id: string; role: string; is_active: number } | undefined;
    if (!targetMember) {
      return c.json({ success: false, message: 'Member not found' }, 404);
    }
    if (
      body.memberRole &&
      body.memberRole !== 'admin' &&
      targetMember.role === 'admin' &&
      targetMember.is_active === 1
    ) {
      const activeAdmins = db
        .prepare(
          `SELECT COUNT(*) AS count FROM household_members
            WHERE household_id = ? AND role = 'admin' AND is_active = 1`
        )
        .get(selectedHouseholdId) as { count: number };
      if (activeAdmins.count <= 1) {
        return c.json({ success: false, code: 'LAST_ACTIVE_ADMIN' }, 409);
      }
    }
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.sharedPantry !== undefined) {
    updates.push('shared_pantry = ?');
    values.push(body.sharedPantry ? 1 : 0);
  }
  if (body.shareRecipes !== undefined) {
    updates.push('share_recipes = ?');
    values.push(body.shareRecipes ? 1 : 0);
  }
  if (body.shareCalendar !== undefined) {
    updates.push('share_calendar = ?');
    values.push(body.shareCalendar ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(selectedHouseholdId);
    db.prepare(`UPDATE households SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  // Update member role/permissions if provided (admin only)
  if (updatesMember) {
    const memUpdates: string[] = [];
    const memValues: any[] = [];
    if (body.memberRole) {
      memUpdates.push('role = ?');
      memValues.push(body.memberRole);
    }
    if (body.memberPermissions !== undefined) {
      memUpdates.push('permissions = ?');
      memValues.push(JSON.stringify(body.memberPermissions));
    } else if (body.memberRole) {
      memUpdates.push('permissions = ?');
      memValues.push(JSON.stringify(defaultPermissions(body.memberRole)));
    }
    if (hasMemberActive) {
      const result = db.transaction(() => {
        const target = db
          .prepare(
            `SELECT user_id, role, is_active FROM household_members
              WHERE id = ? AND household_id = ?`
          )
          .get(body.memberId, selectedHouseholdId) as
          { user_id: string; role: string; is_active: number } | undefined;
        if (!target) return 'missing';
        if (target.user_id === userId) return 'self';
        if (target.is_active === 1 && body.memberActive === false && target.role === 'admin') {
          const activeAdmins = db
            .prepare(
              `SELECT COUNT(*) AS count FROM household_members
                WHERE household_id = ? AND role = 'admin' AND is_active = 1`
            )
            .get(selectedHouseholdId) as { count: number };
          if (activeAdmins.count <= 1) return 'last-admin';
        }
        memUpdates.push('is_active = ?');
        memValues.push(body.memberActive ? 1 : 0);
        memValues.push(body.memberId, selectedHouseholdId);
        db.prepare(
          `UPDATE household_members SET ${memUpdates.join(', ')} WHERE id = ? AND household_id = ?`
        ).run(...memValues);
        return 'ok';
      })();
      if (result === 'missing') return c.json({ success: false, message: 'Member not found' }, 404);
      if (result === 'self') {
        return c.json({ success: false, code: 'MEMBER_CANNOT_DEACTIVATE_SELF' }, 409);
      }
      if (result === 'last-admin') {
        return c.json({ success: false, code: 'LAST_ACTIVE_ADMIN' }, 409);
      }
    } else {
      memValues.push(body.memberId, selectedHouseholdId);
      db.prepare(
        `UPDATE household_members SET ${memUpdates.join(', ')} WHERE id = ? AND household_id = ?`
      ).run(...memValues);
    }
  }

  const household = db
    .prepare('SELECT * FROM households WHERE id = ?')
    .get(selectedHouseholdId) as any;
  const members = db
    .prepare(
      `
    SELECT hm.id, hm.user_id, u.name, u.email, u.avatar, u.cooking_level, hm.role, hm.joined_at, hm.permissions, hm.is_active
    FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE hm.household_id = ?
  `
    )
    .all(selectedHouseholdId);
  return c.json({ success: true, data: mapHousehold({ ...household, members }) });
});

// POST /api/household/regenerate-invite
householdRoutes.post('/regenerate-invite', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();

  const selectedHouseholdId = activeHouseholdId(db, userId);
  if (!selectedHouseholdId) {
    return c.json({ success: false, message: 'No household found' }, 404);
  }

  const newCode = generateInviteCode();
  db.prepare(
    'UPDATE households SET invite_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(newCode, selectedHouseholdId);

  return c.json({ success: true, data: { inviteCode: newCode } });
});

// DELETE /api/household/leave
householdRoutes.delete('/leave', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const leftHouseholdId = db.transaction(() => {
    const selectedHouseholdId = activeHouseholdId(db, userId);
    if (!selectedHouseholdId) return null;

    const memberCount = db
      .prepare('SELECT COUNT(*) as c FROM household_members WHERE household_id = ?')
      .get(selectedHouseholdId) as { c: number };
    const membership = db
      .prepare('SELECT role FROM household_members WHERE household_id = ? AND user_id = ?')
      .get(selectedHouseholdId, userId) as { role: string } | undefined;
    if (!membership) return null;

    db.prepare('DELETE FROM household_members WHERE household_id = ? AND user_id = ?').run(
      selectedHouseholdId,
      userId
    );

    // Leaving a home must not silently switch the user's context to another one.
    // The normal resolver may auto-select a sole remaining membership; with multiple
    // memberships, keep the pointer empty until the user explicitly chooses.
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(userId);

    // Existing last-admin cleanup applies only to the household being left.
    if (membership.role === 'admin' && memberCount.c <= 1) {
      db.prepare('DELETE FROM ingredients WHERE household_id = ?').run(selectedHouseholdId);
      db.prepare('DELETE FROM utensils WHERE household_id = ?').run(selectedHouseholdId);
      db.prepare('DELETE FROM households WHERE id = ?').run(selectedHouseholdId);
    }
    return selectedHouseholdId;
  })();
  if (!leftHouseholdId) return c.json({ success: false, message: 'No household found' }, 404);

  return c.json({ success: true, message: 'Left household' });
});

export { householdRoutes };
