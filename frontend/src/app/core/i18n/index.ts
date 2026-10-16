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
import { homeProfilePickerEs, homeProfilePickerEn } from './dict/home_profile_picker';
import { shoppingListsEs, shoppingListsEn } from './dict/shopping_lists';
import { shoppingListDetailEs, shoppingListDetailEn } from './dict/shopping_list_detail';
import { onboardingEs, onboardingEn } from './dict/onboarding';
import { inviteEs, inviteEn } from './dict/invite';
import { householdSharedEs, householdSharedEn } from './dict/household_shared';
import { aiConfigEs, aiConfigEn } from './dict/ai_config';
import { avatarEditorEs, avatarEditorEn } from './dict/avatar_editor';
import { accountEs, accountEn } from './dict/account';
import { uiEs, uiEn } from './dict/ui';
import { authEs, authEn } from './dict/auth';
import { caducidadesEs, caducidadesEn } from './dict/caducidades';
import { shoppingSuggestedEs, shoppingSuggestedEn } from './dict/shopping_suggested';
import { calendarEs, calendarEn } from './dict/calendar';
import { dashboardEs, dashboardEn } from './dict/dashboard';
import { logsEs, logsEn } from './dict/logs';
import { navEs, navEn } from './dict/nav';
import { pantryEs, pantryEn } from './dict/pantry';
import { receiptsEs, receiptsEn } from './dict/receipts';
import { preferencesEs, preferencesEn } from './dict/preferences';
import { profileEs, profileEn } from './dict/profile';
import { settingsEs, settingsEn } from './dict/settings';
import { tasteEs, tasteEn } from './dict/taste';
import { aiParticipantsEs, aiParticipantsEn } from './dict/ai_participants';
import { aiActionAssistantEs, aiActionAssistantEn } from './dict/ai_action_assistant';

const es = {
  ...homeProfilePickerEs,
  ...shoppingListsEs,
  ...shoppingListDetailEs,
  ...onboardingEs,
  ...inviteEs,
  ...householdSharedEs,
  ...aiConfigEs,
  ...avatarEditorEs,
  ...accountEs,
  ...authEs,
  ...caducidadesEs,
  ...shoppingSuggestedEs,
  ...calendarEs,
  ...dashboardEs,
  ...logsEs,
  ...navEs,
  ...pantryEs,
  ...preferencesEs,
  ...receiptsEs,
  ...profileEs,
  ...settingsEs,
  ...tasteEs,
  ...aiParticipantsEs,
  ...aiActionAssistantEs,
  ...uiEs
};

const en: Record<keyof typeof es, string> = {
  ...homeProfilePickerEn,
  ...shoppingListsEn,
  ...shoppingListDetailEn,
  ...onboardingEn,
  ...inviteEn,
  ...householdSharedEn,
  ...aiConfigEn,
  ...avatarEditorEn,
  ...accountEn,
  ...authEn,
  ...caducidadesEn,
  ...shoppingSuggestedEn,
  ...calendarEn,
  ...dashboardEn,
  ...logsEn,
  ...navEn,
  ...pantryEn,
  ...preferencesEn,
  ...receiptsEn,
  ...profileEn,
  ...settingsEn,
  ...tasteEn,
  ...aiParticipantsEn,
  ...aiActionAssistantEn,
  ...uiEn
};

export const DICTS = { es, en };

/** Claves estáticas y del diccionario hogar, cargado bajo demanda al entrar en su ruta. */
export type TranslationKey =
  | keyof typeof es
  | keyof typeof import('./dict/household').householdEs
  | keyof typeof import('./dict/recipes').recipesEs;

/** Lo que hay que traducir, por si manana el diccionario viene de un JSON y no de un literal. */
/**
 * Los valores admitidos dentro de `t:{...}`. En la plantilla un `preview()?.householdName` o un
 * `describeOffer(offer)` llegan null o undefined segun el estado, y partir la frase en dos para
 * garantias de tipo era peor: el nullish se sustituye por cadena vacia.
 */
export type TranslationParams = Record<string, string | number | null | undefined>;
