// =============================================================================
// El diccionario de HogarIA, mezclado.
//
// Como se usa un texto nuevo:
//   1. se anade la clave a `dict/<dominio>.ts` en los dos idiomas (si falta el ingles, no compila);
//   2. en la plantilla, {{ 'dominio.clave' | t }}; en el codigo, this.i18n.t('dominio.clave');
//   3. si lleva un numero o un nombre detras, separamos con {param}: no se pegan frases en la plantilla,
//      que una frase partida en dos no se traduce bien en ningun idioma.
//
// Por que `es` manda: es el idioma en el que esta escrito el producto, y el fallback de una clave
// desconocida tiene que ser el original, no la clave en crudo. Con `strictTemplates`, la union de tipos ya
// impide escribir una clave que no existe; lo que el tipo no puede ver es el `en`, y ahi mira el check-ui
// (regla `clave-sin-traduccion`).
// =============================================================================
import { householdSharedEs, householdSharedEn } from './dict/household_shared';
import { uiEs, uiEn } from './dict/ui';
import { navEs, navEn } from './dict/nav';
import { receiptsEs, receiptsEn } from './dict/receipts';
import {
  aiActionAssistantShellEs,
  aiActionAssistantShellEn
} from './dict/ai_action_assistant_shell';
import { aiActivityEs, aiActivityEn } from './dict/ai_activity';

const es = {
  ...householdSharedEs,
  ...receiptsEs,
  ...aiActivityEs,
  ...aiActionAssistantShellEs,
  ...navEs,
  ...uiEs
};

const en: Record<keyof typeof es, string> = {
  ...householdSharedEn,
  ...receiptsEn,
  ...aiActivityEn,
  ...aiActionAssistantShellEn,
  ...navEn,
  ...uiEn
};

export const DICTS = { es, en };

/** Diccionarios de dominio cargados antes de activar su ruta o al abrir el asistente. */
export type TranslationBundleName =
  | 'homeProfilePicker'
  | 'shoppingLists'
  | 'shoppingListDetail'
  | 'onboarding'
  | 'invite'
  | 'aiConfig'
  | 'avatarEditor'
  | 'account'
  | 'auth'
  | 'caducidades'
  | 'shoppingSuggested'
  | 'calendar'
  | 'dashboard'
  | 'logs'
  | 'pantry'
  | 'preferences'
  | 'profile'
  | 'settings'
  | 'taste'
  | 'aiParticipants'
  | 'household'
  | 'recipes'
  | 'aiActionAssistant';

/** Claves estáticas y de los diccionarios de dominio cargados bajo demanda. */
export type TranslationKey =
  | keyof typeof es
  | keyof typeof import('./dict/home_profile_picker').homeProfilePickerEs
  | keyof typeof import('./dict/shopping_lists').shoppingListsEs
  | keyof typeof import('./dict/shopping_list_detail').shoppingListDetailEs
  | keyof typeof import('./dict/onboarding').onboardingEs
  | keyof typeof import('./dict/invite').inviteEs
  | keyof typeof import('./dict/ai_config').aiConfigEs
  | keyof typeof import('./dict/avatar_editor').avatarEditorEs
  | keyof typeof import('./dict/account').accountEs
  | keyof typeof import('./dict/auth').authEs
  | keyof typeof import('./dict/caducidades').caducidadesEs
  | keyof typeof import('./dict/shopping_suggested').shoppingSuggestedEs
  | keyof typeof import('./dict/calendar').calendarEs
  | keyof typeof import('./dict/dashboard').dashboardEs
  | keyof typeof import('./dict/logs').logsEs
  | keyof typeof import('./dict/pantry').pantryEs
  | keyof typeof import('./dict/preferences').preferencesEs
  | keyof typeof import('./dict/profile').profileEs
  | keyof typeof import('./dict/settings').settingsEs
  | keyof typeof import('./dict/taste').tasteEs
  | keyof typeof import('./dict/ai_participants').aiParticipantsEs
  | keyof typeof import('./dict/household').householdEs
  | keyof typeof import('./dict/recipes').recipesEs
  | keyof typeof import('./dict/ai_action_assistant').aiActionAssistantEs;

/** Lo que hay que traducir, por si manana el diccionario viene de un JSON y no de un literal. */
/**
 * Los valores admitidos dentro de `t:{...}`. En la plantilla un `preview()?.householdName` o un
 * `describeOffer(offer)` llegan null o undefined segun el estado, y partir la frase en dos para
 * garantias de tipo era peor: el nullish se sustituye por cadena vacia.
 */
export type TranslationParams = Record<string, string | number | null | undefined>;
