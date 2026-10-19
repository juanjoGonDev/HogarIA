import type { TranslationKey } from '../../core/i18n';
import type { IconName } from '../components/ui/icon/icon-paths';

/**
 * Perfil de gustos, alergias y objetivo del comensal.
 *
 * Se rellena en el onboarding (justo al registrarse, se puede saltar) y se
 * edita a mano en Preferencias. Lo consume la IA al generar recetas y al planificar
 * la semana: sin él no sabe qué ingredientes no puede usar.
 */

export type TasteGoal =
  'balanced' | 'weight-loss' | 'weight-gain' | 'muscle-gain' | 'maintenance' | 'variety' | 'custom';

export interface TasteProfile {
  goals: TasteGoal[];
  goalNotes: string;
  /** Alergias e intolerancias: la IA no puede colar ni una variante. */
  allergies: string[];
  likes: string[];
  dislikes: string[];
  /** Texto libre: horarios, estilo de cocina, cosas de casa... */
  notes: string;
}

export type OnboardingStatus = 'pending' | 'done' | 'skipped';

export interface OnboardingState {
  status: OnboardingStatus;
  completedAt: string | null;
}

export interface TasteResponse {
  taste: TasteProfile;
  onboarding: OnboardingState;
  /** Nivel de cocina y secciones de casa (ver home-profile.ts). */
  profile?: import('./home-profile').HomeProfile;
  /**
   * A que hora come esta casa (ver `core/meal-times.ts`). `Partial` y con `null` admitidos a proposito:
   * esto es la forma del cable, no la del estado. La API contesta siempre las cuatro, pero el lector las
   * normaliza, y el formulario manda el bloque incompleto cuando solo se ha cambiado una comida.
   */
  mealTimes?: Partial<Record<import('./calendar.model').MealType, string | null>>;
  /**
   * Que la IA planifique cada comida (12t-T). `Partial` y con `null` por el mismo motivo que `mealTimes`:
   * esto es la forma del cable. La respuesta trae siempre los cuatro; el formulario manda solo los que
   * cambio, y `null` (que aqui no escribe ningun boton) significa «quita la clave y vuelve al fabrica».
   */
  mealPlan?: Partial<Record<import('./calendar.model').MealType, boolean | null>>;
}

/** Opción de un selector de chips: lo que se guarda es el propio texto. */
export interface ChipOption {
  value: string;
  icon?: string;
}

export function emptyTasteProfile(): TasteProfile {
  return {
    goals: ['balanced'],
    goalNotes: '',
    allergies: [],
    likes: [],
    dislikes: [],
    notes: ''
  };
}

/** ¿Ha dicho algo? (para no hablar de "tus gustos" con el perfil vacío) */
export function hasTasteProfile(taste: TasteProfile | null): boolean {
  if (!taste) return false;
  return (
    taste.allergies.length > 0 ||
    taste.likes.length > 0 ||
    taste.dislikes.length > 0 ||
    taste.notes.trim().length > 0 ||
    taste.goalNotes.trim().length > 0 ||
    taste.goals.some((goal) => goal !== 'balanced')
  );
}

/** Mantiene el objetivo neutro como opción exclusiva y permite combinar el resto, incluida Personalizada. */
export function toggleTasteGoal(goals: TasteGoal[], goal: TasteGoal): TasteGoal[] {
  if (goal === 'balanced') return goals.includes(goal) ? [] : [goal];
  const withoutBalanced = goals.filter((selected) => selected !== 'balanced');
  return withoutBalanced.includes(goal)
    ? withoutBalanced.filter((selected) => selected !== goal)
    : [...withoutBalanced, goal];
}

/** Normaliza respuestas nuevas y conserva la lectura de perfiles guardados antes de los objetivos múltiples. */
export function normalizeTasteProfile(
  input: (Partial<TasteProfile> & { goal?: TasteGoal }) | null | undefined
): TasteProfile {
  const value = input ?? {};
  const legacyGoals = value.goals ?? (value.goal ? [value.goal] : undefined);
  const { goal: _legacyGoal, ...current } = value;
  return {
    ...emptyTasteProfile(),
    ...current,
    goals: Array.isArray(legacyGoals) ? [...new Set(legacyGoals)] : ['balanced'],
    goalNotes: value.goalNotes ?? '',
    allergies: value.allergies ?? [],
    likes: value.likes ?? [],
    dislikes: value.dislikes ?? [],
    notes: value.notes ?? ''
  };
}

/**
 * Las opciones del objetivo. `value` es lo que se guarda; `labelKey`/`hintKey` son claves del
 * diccionario, porque lo que se ensena tiene que cambiar de idioma y lo que se guarda, no.
 */
export const GOAL_OPTIONS: {
  value: TasteGoal;
  labelKey: TranslationKey;
  icon: IconName;
  hintKey: TranslationKey;
}[] = [
  {
    value: 'balanced',
    labelKey: 'taste.goal.balanced',
    icon: 'scale',
    hintKey: 'taste.goalHint.balanced'
  },
  {
    value: 'weight-loss',
    labelKey: 'taste.goal.weight-loss',
    icon: 'remove_circle',
    hintKey: 'taste.goalHint.weight-loss'
  },
  {
    value: 'weight-gain',
    labelKey: 'taste.goal.weight-gain',
    icon: 'add_circle',
    hintKey: 'taste.goalHint.weight-gain'
  },
  {
    value: 'muscle-gain',
    labelKey: 'taste.goal.muscle-gain',
    icon: 'favorite',
    hintKey: 'taste.goalHint.muscle-gain'
  },
  {
    value: 'maintenance',
    labelKey: 'calendar.goal.maintenance',
    icon: 'scale',
    hintKey: 'taste.goalHint.maintenance'
  },
  {
    value: 'variety',
    labelKey: 'taste.goal.variety',
    icon: 'star',
    hintKey: 'taste.goalHint.variety'
  },
  { value: 'custom', labelKey: 'taste.goal.custom', icon: 'edit', hintKey: 'taste.goalHint.custom' }
];

export const GOAL_LABEL_KEYS: Record<TasteGoal, TranslationKey> = GOAL_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.labelKey }),
  {} as Record<TasteGoal, TranslationKey>
);

/** Los 14 alérgenos de la UE, que es lo que viene en las etiquetas. */
export const COMMON_ALLERGENS: ChipOption[] = [
  { value: 'Gluten', icon: '🌾' },
  { value: 'Lactosa', icon: '🥛' },
  { value: 'Huevo', icon: '🥚' },
  { value: 'Pescado', icon: '🐟' },
  { value: 'Marisco', icon: '🦐' },
  { value: 'Moluscos', icon: '🐚' },
  { value: 'Frutos secos', icon: '🌰' },
  { value: 'Cacahuete', icon: '🥜' },
  { value: 'Soja', icon: '🫘' },
  { value: 'Sésamo', icon: '⚪' },
  { value: 'Mostaza', icon: '🟡' },
  { value: 'Apio', icon: '🥬' },
  { value: 'Sulfitos', icon: '🍷' },
  { value: 'Altramuces', icon: '🌼' },
  { value: 'Cebolleta/Ajo', icon: '🧄' },
  { value: 'Sin cerdo', icon: '🐖' },
  { value: 'Sin alcohol', icon: '🚫' },
  { value: 'Vegetariano', icon: '🌱' },
  { value: 'Vegano', icon: '🌿' }
];

/** Lo que suele gustar, en las palabras que usaría alguien en la mesa. */
export const COMMON_LIKES: ChipOption[] = [
  { value: 'Pollo', icon: '🍗' },
  { value: 'Pavo', icon: '🦃' },
  { value: 'Pescado al horno', icon: '🐟' },
  { value: 'Verduras', icon: '🥦' },
  { value: 'Ensaladas', icon: '🥗' },
  { value: 'Legumbres', icon: '🫘' },
  { value: 'Arroz', icon: '🍚' },
  { value: 'Pasta', icon: '🍝' },
  { value: 'Patata', icon: '🥔' },
  { value: 'Huevos', icon: '🍳' },
  { value: 'Queso', icon: '🧀' },
  { value: 'Fruta', icon: '🍎' },
  { value: 'Sopas y cremas', icon: '🍲' },
  { value: 'Cocina española', icon: '🇪🇸' },
  { value: 'Cocina italiana', icon: '🇮🇹' },
  { value: 'Cocina asiática', icon: '🥢' },
  { value: 'Cocina mexicana', icon: '🌮' },
  { value: 'Picante', icon: '🌶️' },
  { value: 'A la plancha', icon: '🔥' },
  { value: 'Al horno', icon: '🍞' },
  { value: 'En airfryer', icon: '🌪️' },
  { value: 'Postres', icon: '🍰' },
  { value: 'Desayunos salados', icon: '🥐' },
  { value: 'Cocina de aprovechamiento', icon: '♻️' }
];

/** Lo que más se repite en el «esto no me lo pongas». */
export const COMMON_DISLIKES: ChipOption[] = [
  { value: 'Vísceras y casquería', icon: '🫀' },
  { value: 'Anchoas y boquerones', icon: '🐟' },
  { value: 'Sardinas', icon: '🐟' },
  { value: 'Marisco', icon: '🦐' },
  { value: 'Aceitunas', icon: '🫒' },
  { value: 'Alcaparras', icon: '🌿' },
  { value: 'Cilantro', icon: '🌿' },
  { value: 'Menta', icon: '🌱' },
  { value: 'Regaliz', icon: '🖤' },
  { value: 'Brócoli y coliflor', icon: '🥦' },
  { value: 'Coles de Bruselas', icon: '🥬' },
  { value: 'Espinacas', icon: '🥬' },
  { value: 'Setas y champiñones', icon: '🍄' },
  { value: 'Calabacín y berenjena', icon: '🍆' },
  { value: 'Nabo y chirivía', icon: '🥕' },
  { value: 'Pepino', icon: '🥒' },
  { value: 'Pimientos asados', icon: '🫑' },
  { value: 'Pasas y fruta pasada', icon: '🍇' },
  { value: 'Muy picante', icon: '🌶️' },
  { value: 'Muy dulce', icon: '🍬' },
  { value: 'Fritos', icon: '🍟' },
  { value: 'Nata y queso crema', icon: '🥛' },
  { value: 'Crudos (sashimi, steak tartar)', icon: '🍣' }
];

/** Categorías de utensilios que de verdad cambian qué recetas se pueden hacer. */
export const ONBOARDING_UTENSIL_CATEGORIES = [
  'oven',
  'microwave',
  'airfryer',
  'stovetop',
  'blender',
  'mixer',
  'food-processor'
] as const;
