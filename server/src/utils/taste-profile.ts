import Database from 'better-sqlite3';
import { z } from 'zod';
import { formField, formTime } from '../schemas/form.js';

/**
 * Perfil de gustos, alergias y objetivo del comensal.
 *
 * Se rellena en el onboarding (nada más registrarse) y se puede editar a mano
 * en Ajustes. Se guarda dentro del JSON `users.preferences` — bajo las claves
 * `taste` y `onboarding` — para no añadir columnas ni migraciones: es data
 * propia de la cuenta, no compartida con el hogar.
 *
 * Lo consume la IA: sin él, las recetas que genera pueden llevar ingredientes
 * que el usuario no puede comer o que no le gustan.
 */

/**
 * Los tipos de comida, en el orden del dia espanol: la merienda va antes que la cena.
 *
 * Viven aqui y no en una hoja de estilos porque los consume media app: el calendario (donde se
 * colocan), el planificador de la IA (que pregunta por ellos) y las preferencias (donde se-editan las
 * horas). Un `MEAL_ORDER` aparte en el frontend fue exactamente el origen del «el orden esta mal» que
 * report6 el usuario.
 */
export const MEAL_TYPE_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealTypeKey = (typeof MEAL_TYPE_KEYS)[number];

export const MEAL_TYPE_LABELS: Record<MealTypeKey, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Merienda',
  dinner: 'Cena'
};

/**
 * A que hora come esta casa. Un ajuste con defecto, no una constante: el usuario puede cambiarlo
 * cuando quiera y la app no tiene opinion sobre si las 22:00 es «raro».
 *
 * Que exista un defecto es lo que permite que «vaciar la casilla» signifique «vuelve al defecto» en
 * vez de «no hay hora», y que la rejilla del calendario y el plan de la IA hablen de las mismas horas
 * sin que nadie tenga que reconciliar dos fuentes.
 */
export const MEAL_TIME_DEFAULTS: Record<MealTypeKey, string> = {
  breakfast: '09:00',
  lunch: '14:00',
  snack: '17:00',
  dinner: '20:30'
};

/** La hora tal y como la escribe un `<input type="time">`. */
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates a persisted meal time without applying the UI's read-time default. */
export function isMealTimeValue(value: unknown): value is string {
  return typeof value === 'string' && HOUR_MINUTE.test(value.trim());
}

export const mealTimesSchema = z.object({
  breakfast: formTime('Desayuno'),
  lunch: formTime('Almuerzo'),
  snack: formTime('Merienda'),
  dinner: formTime('Cena')
});

/** Horas de la casa, siempre completas: lo que no esta escrito es el defecto, no un hueco. */
export type MealTimes = Record<MealTypeKey, string>;

/** Defensivo igual que `toTasteProfile`: un JSON viejo o escrito a mano no puede romper una lectura. */
export function toMealTimes(stored: unknown): MealTimes {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out: MealTimes = { ...MEAL_TIME_DEFAULTS };
  for (const key of MEAL_TYPE_KEYS) {
    const value = String(raw[key] ?? '').trim();
    if (isMealTimeValue(value)) out[key] = value;
  }
  return out;
}

/**
 * Que la IA planifique cada comida. `true` de fabrica para las cuatro, que es exactamente lo que hacia la app
 * antes de esta preferencia: una casa que no ha dicho nada sigue teniendo el semana completo.
 *
 * No es un filtro del prompt, es un contrato de escritura: `plan-week` recorta lo que ofrece y
 * `persistWeeklyPlan` ignora lo bloqueado aunque el modelo se lo invente (12t-T).
 */
export const MEAL_PLAN_DEFAULTS: Record<MealTypeKey, boolean> = {
  breakfast: true,
  lunch: true,
  snack: true,
  dinner: true
};

export const mealPlanSchema = z.object({
  breakfast: z.boolean().nullish(),
  lunch: z.boolean().nullish(),
  snack: z.boolean().nullish(),
  dinner: z.boolean().nullish()
});

export type MealPlan = Record<MealTypeKey, boolean>;

/** Como `toMealTimes`: un JSON viejo, escrito a mano o roto no puede romper una lectura. */
export function toMealPlan(stored: unknown): MealPlan {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out: MealPlan = { ...MEAL_PLAN_DEFAULTS };
  for (const key of MEAL_TYPE_KEYS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  return out;
}

/** Las comidas que el planificador tiene permiso de escribir, en el orden del dia. */
export function plannedMealTypes(plan: MealPlan): MealTypeKey[] {
  return MEAL_TYPE_KEYS.filter((key) => plan[key]);
}

/** Lo que la IA necesita saber para no proponer una cena a las 13:00. */
export function mealTimesPromptLines(times: MealTimes): string {
  const list = MEAL_TYPE_KEYS.map(
    (key) => `${MEAL_TYPE_LABELS[key].toLowerCase()} a las ${times[key]}`
  );
  return `Horarios de la casa: ${list.join(', ')}. Usa esas horas para situar cada comida.`;
}

export const tasteGoalEnum = z.enum([
  'balanced',
  'weight-loss',
  'weight-gain',
  'muscle-gain',
  'maintenance',
  'variety',
  'custom'
]);
export type TasteGoal = z.infer<typeof tasteGoalEnum>;

const DEFAULT_TASTE_GOALS: TasteGoal[] = ['balanced'];

export const GOAL_LABELS: Record<string, string> = {
  balanced: 'Equilibrada',
  'weight-loss': 'Perder peso',
  'weight-gain': 'Ganar peso',
  'muscle-gain': 'Ganar músculo',
  maintenance: 'Mantener peso',
  variety: 'Variada',
  custom: 'Personalizada'
};

/**
 * Nivel en la cocina. `none` («apenas cocino») llega con HogarIA: la app ya no
 * es solo de recetas, así que quien no cocina también tiene que poder decirlo.
 * Se guarda en `users.cooking_level` (TEXT sin CHECK: no hace falta migración).
 */
export const COOKING_LEVELS = ['none', 'beginner', 'intermediate', 'expert'] as const;
export const cookingLevelEnum = z.enum(COOKING_LEVELS);
export type CookingLevel = (typeof COOKING_LEVELS)[number];

/** Secciones de HogarIA que la persona quiere llevar desde la app. */
export const HOME_MODULES = ['meals', 'pantry', 'shopping', 'receipts', 'home'] as const;
export const homeModuleEnum = z.enum(HOME_MODULES);
export type HomeModule = (typeof HOME_MODULES)[number];

/** Qué se responde y qué se guarda: el nivel vive en la columna, los módulos en el JSON. */
export interface HomeProfileView {
  cookingLevel: CookingLevel;
  modules: HomeModule[];
}

/**
 * El nivel tiene que servir para algo: sin petición explícita de la UI, la IA
 * explica más a quien empieza y va al grano con quien domina la cocina.
 */
export function detailLevelForCookingLevel(level: unknown): 'basic' | 'intermediate' | 'expert' {
  if (level === 'expert') return 'expert';
  if (level === 'intermediate') return 'intermediate';
  return 'basic';
}

/** Defensivo al leer: JSON antiguos o escritos a mano no pueden colar valores desconocidos. */
export function toHomeProfile(stored: unknown, cookingLevel: unknown): HomeProfileView {
  const raw = readPreferences(stored);
  const modules: HomeModule[] = [];
  if (Array.isArray(raw.modules)) {
    for (const item of raw.modules) {
      const value = String(item ?? '') as HomeModule;
      if (!HOME_MODULES.includes(value) || modules.includes(value)) continue;
      modules.push(value);
    }
  }
  const level = COOKING_LEVELS.includes(cookingLevel as CookingLevel)
    ? (cookingLevel as CookingLevel)
    : 'beginner';
  return { cookingLevel: level, modules: modules.slice(0, HOME_MODULES.length) };
}

/** Listas cortas y sin vacíos: son cadenas que se envían tal cual a la IA. */
const stringList = z.array(z.string().trim().min(1)).max(60).optional();

export const tasteProfileSchema = z.object({
  /**
   * Preferencias simultáneas; `goal` se conserva solo para aceptar formularios legacy durante el
   * cambio de cliente. En almacenamiento y respuestas se usa siempre la forma plural.
   */
  goals: z.array(tasteGoalEnum).max(7).optional(),
  goal: tasteGoalEnum.optional(),
  goalNotes: z.string().trim().optional(),
  allergies: stringList,
  likes: stringList,
  dislikes: stringList,
  notes: z.string().trim().optional()
});

export const updateTasteSchema = z.object({
  // `formField` en todo: el onboarding manda el perfil por partes (y «omitir el onboarding» es un
  // PATCH con un solo campo), y un hueco aqui tiene que significar «no tocar», no un 400.
  taste: formField(tasteProfileSchema.optional()),
  /** 'done' al terminar el onboarding, 'skipped' si se salta. */
  onboardingStatus: formField(z.enum(['done', 'skipped'])),
  /** Nivel de cocina: se escribe en su columna, no en el JSON. */
  cookingLevel: formField(cookingLevelEnum),
  /** Qué se quiere llevar desde la app (ver HOME_MODULES). */
  modules: formField(z.array(homeModuleEnum).max(HOME_MODULES.length)),
  /**
   * Las horas de las comidas. `formField` alrededor del objeto: el onboarding y Preferencias mandan el
   * bloque entero, pero un PATCH parcial (o una casilla vaciada) tiene que significar «no tocar» y
   * «vuelve al defecto» respectivamente, no un 400.
   */
  mealTimes: formField(mealTimesSchema),
  /** Que la IA planifique cada comida (12t-T). Mismo contrato de tres estados que `mealTimes`. */
  mealPlan: formField(mealPlanSchema)
});

export type TasteProfileInput = z.infer<typeof tasteProfileSchema>;
export type UpdateTasteInput = z.infer<typeof updateTasteSchema>;

export interface TasteProfile {
  goals: TasteGoal[];
  goalNotes: string;
  allergies: string[];
  likes: string[];
  dislikes: string[];
  notes: string;
}

export interface OnboardingState {
  status: 'pending' | 'done' | 'skipped';
  completedAt: string | null;
}

export interface TasteResponse {
  taste: TasteProfile;
  onboarding: OnboardingState;
  profile: HomeProfileView;
  /** Siempre las cuatro horas: las que la casa no ha tocado salen con el defecto. */
  mealTimes: MealTimes;
  /** Y siempre los cuatro permisos: sin decir nada, la IA planifica las cuatro comidas. */
  mealPlan: MealPlan;
}

export const emptyTasteProfile = (): TasteProfile => ({
  goals: [...DEFAULT_TASTE_GOALS],
  goalNotes: '',
  allergies: [],
  likes: [],
  dislikes: [],
  notes: ''
});

const pendingOnboarding: OnboardingState = { status: 'pending', completedAt: null };

/** El JSON de preferencias puede venir roto o vacío: nunca rompe una lectura. */
function readPreferences(raw: unknown): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

/** Une el perfil guardado con los valores por defecto (nunca undefined). */
export function toTasteProfile(stored: unknown): TasteProfile {
  const raw = readPreferences(stored);
  const rawGoals = Array.isArray(raw.goals)
    ? raw.goals
    : typeof raw.goal === 'string'
      ? [raw.goal]
      : DEFAULT_TASTE_GOALS;
  const goals: TasteGoal[] = [];
  for (const value of rawGoals) {
    const parsed = tasteGoalEnum.safeParse(value);
    if (parsed.success && !goals.includes(parsed.data)) goals.push(parsed.data);
  }

  return {
    goals: rawGoals.length > 0 && goals.length === 0 ? [...DEFAULT_TASTE_GOALS] : goals,
    goalNotes: normalizeText(raw.goalNotes),
    allergies: normalizeList(raw.allergies),
    likes: normalizeList(raw.likes),
    dislikes: normalizeList(raw.dislikes),
    notes: normalizeText(raw.notes)
  };
}

function toOnboardingState(stored: unknown): OnboardingState {
  const raw = readPreferences(stored);
  if (!raw || typeof raw !== 'object' || typeof raw.status !== 'string')
    return { ...pendingOnboarding };

  const status = raw.status === 'done' || raw.status === 'skipped' ? raw.status : 'pending';
  return { status, completedAt: typeof raw.at === 'string' ? raw.at : null };
}

interface UserPreferenceRow {
  preferences: string | null;
  cooking_level: string | null;
}

function selectUserRow(db: Database.Database, userId: string): UserPreferenceRow | undefined {
  return db.prepare('SELECT preferences, cooking_level FROM users WHERE id = ?').get(userId) as
    UserPreferenceRow | undefined;
}

export function readTasteResponse(db: Database.Database, userId: string): TasteResponse {
  const row = selectUserRow(db, userId);
  const prefs = readPreferences(row?.preferences);
  return {
    taste: toTasteProfile(prefs.taste),
    onboarding: toOnboardingState(prefs.onboarding),
    profile: toHomeProfile(prefs.profile, row?.cooking_level),
    mealTimes: toMealTimes(prefs.mealTimes),
    mealPlan: toMealPlan(prefs.mealPlan)
  };
}

/** Lo que necesita la IA antes de escribir un prompt: el nivel del comensal. */
export function readCookingLevel(db: Database.Database, userId: string): CookingLevel {
  const row = selectUserRow(db, userId);
  const level = row?.cooking_level;
  return COOKING_LEVELS.includes(level as CookingLevel) ? (level as CookingLevel) : 'beginner';
}

/**
 * Fusiona el parche en `users.preferences` sin tocar el resto (tema, idioma,
 * nivel de detalle...): se leen, se modifica solo `taste`/`onboarding` y se
 * vuelve a escribir el objeto completo.
 */
export function saveTasteProfile(
  db: Database.Database,
  userId: string,
  patch: UpdateTasteInput
): TasteResponse {
  const row = selectUserRow(db, userId);
  const prefs = readPreferences(row?.preferences);

  if (patch.taste) {
    const previous = toTasteProfile(prefs.taste);
    const next = patch.taste;
    const goals =
      next.goals !== undefined
        ? [...new Set(next.goals)]
        : next.goal !== undefined
          ? [next.goal]
          : previous.goals;
    prefs.taste = {
      goals,
      goalNotes: next.goalNotes !== undefined ? normalizeText(next.goalNotes) : previous.goalNotes,
      allergies: next.allergies !== undefined ? normalizeList(next.allergies) : previous.allergies,
      likes: next.likes !== undefined ? normalizeList(next.likes) : previous.likes,
      dislikes: next.dislikes !== undefined ? normalizeList(next.dislikes) : previous.dislikes,
      notes: next.notes !== undefined ? normalizeText(next.notes) : previous.notes
    };
  }

  if (patch.mealTimes === null) {
    // `null` es «quita la preferencia», y hay que decirlo antes del `if (patch.mealTimes)`: null es falsy y
    // sin esta rama el tri-estado se quedaba en dos (ausente no toca, booleano escribe, y el borrado no
    // existia). Se borra la clave, no se rellena de defectos: la lectura ya los pone.
    delete prefs.mealTimes;
  } else if (patch.mealTimes) {
    // Clave que no viene = clave que no se toca (un «solo he cambiado la cena» no puede borrar el
    // desayuno). Clave que viene vacia o null = se ELIMINA, que es lo que hace que la proxima lectura
    // conteste el defecto: «quitar mi horario raro» no necesita boton de restablecer.
    const stored = prefs.mealTimes && typeof prefs.mealTimes === 'object' ? prefs.mealTimes : {};
    const next: Record<string, string> = { ...(stored as Record<string, string>) };
    const patchTimes = patch.mealTimes as Record<string, unknown>;
    for (const key of MEAL_TYPE_KEYS) {
      if (!(key in patchTimes)) continue;
      const value = String(patchTimes[key] ?? '').trim();
      if (isMealTimeValue(value)) next[key] = value;
      else delete next[key];
    }
    prefs.mealTimes = next;
  }

  if (patch.mealPlan === null) {
    delete prefs.mealPlan; // lo mismo que arriba: «devolverlo a que la IA lo planifique todo»
  } else if (patch.mealPlan) {
    // Tres estados, los mismos de arriba: clave ausente no se toca, `null` vuelve al fabrica (que para un
    // permiso es «dejarla planificar»), y un booleano escribe. `''` no es un estado valido aqui: un
    // checkbox no se vacia, se marca o se desmarca.
    const stored = prefs.mealPlan && typeof prefs.mealPlan === 'object' ? prefs.mealPlan : {};
    const next: Record<string, boolean> = { ...(stored as Record<string, boolean>) };
    const patchPlan = patch.mealPlan as Record<string, unknown>;
    for (const key of MEAL_TYPE_KEYS) {
      if (!(key in patchPlan)) continue;
      const value = patchPlan[key];
      if (typeof value === 'boolean') next[key] = value;
      else delete next[key];
    }
    prefs.mealPlan = next;
  }

  if (patch.onboardingStatus) {
    prefs.onboarding = {
      status: patch.onboardingStatus,
      at: new Date().toISOString()
    };
  }

  if (patch.modules !== undefined) {
    const profile = readPreferences(prefs.profile);
    profile.modules = [...new Set(patch.modules)];
    prefs.profile = profile;
  }

  const sets = ['preferences = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [JSON.stringify(prefs)];
  if (patch.cookingLevel !== undefined) {
    sets.unshift('cooking_level = ?');
    values.unshift(patch.cookingLevel);
  }
  values.push(userId);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return readTasteResponse(db, userId);
}

/** Solo el perfil, para los prompts de la IA. */
export function readTasteProfile(db: Database.Database, userId: string): TasteProfile {
  return readTasteResponse(db, userId).taste;
}

/** Las horas de la casa, para quien escribe el plan (la IA) y para quien lo guarda. */
export function readMealTimes(db: Database.Database, userId: string): MealTimes {
  const row = selectUserRow(db, userId);
  return toMealTimes(readPreferences(row?.preferences).mealTimes);
}

/** Lo que pregunta el calendario antes de mandar `mealTypes`, y lo que respeta la persistencia. */
export function readMealPlan(db: Database.Database, userId: string): MealPlan {
  const row = selectUserRow(db, userId);
  return toMealPlan(readPreferences(row?.preferences).mealPlan);
}

/**
 * Bloque de prompt con lo que ha contestado el usuario. Vacío si no ha
 * configurado nada, para no rellenar el prompt de líneas sin contenido.
 */
export function tastePromptLines(taste: TasteProfile): string {
  const lines: string[] = [];

  if (taste.allergies.length > 0) {
    lines.push(
      `Alergias e intolerancias (no uses NADA de esto, ni en variantes ni como opcional): ${taste.allergies.join(', ')}`
    );
  }
  if (taste.likes.length > 0) {
    lines.push(`Le gusta: ${taste.likes.join(', ')}`);
  }
  if (taste.dislikes.length > 0) {
    lines.push(`Prefiere evitar (no lo propongas si no hace falta): ${taste.dislikes.join(', ')}`);
  }

  const selectedGoals = taste.goals.filter((goal) => goal !== 'custom');
  const hasOnlyDefaultGoal = selectedGoals.length === 1 && selectedGoals[0] === 'balanced';
  const labels = selectedGoals.map((goal) => GOAL_LABELS[goal] ?? goal);
  if (labels.length > 0 && !hasOnlyDefaultGoal) {
    lines.push(`Objetivos del comensal: ${labels.join(', ')}`);
  }
  if (taste.goalNotes && labels.length > 0 && !hasOnlyDefaultGoal) {
    lines.push(`Indicaciones del objetivo: ${taste.goalNotes}`);
  } else if (taste.goalNotes) {
    lines.push(`Objetivo del comensal: ${taste.goalNotes}`);
  }

  if (taste.notes) {
    lines.push(`Notas del comensal: ${taste.notes}`);
  }

  return lines.join('\n');
}

/** ¿Tiene algo dicho el usuario? (para no hablar de "tus gustos" con un perfil vacío) */
export function hasTasteProfile(taste: TasteProfile): boolean {
  return (
    taste.allergies.length > 0 ||
    taste.likes.length > 0 ||
    taste.dislikes.length > 0 ||
    taste.notes.length > 0 ||
    taste.goalNotes.length > 0 ||
    taste.goals.some((goal) => goal !== 'balanced' && goal !== 'custom')
  );
}
