import { DICTS } from './index';
import { homeProfilePickerEs, homeProfilePickerEn } from './dict/home_profile_picker';
import { shoppingListsEs, shoppingListsEn } from './dict/shopping_lists';
import { shoppingListDetailEs, shoppingListDetailEn } from './dict/shopping_list_detail';
import { onboardingEs, onboardingEn } from './dict/onboarding';
import { inviteEs, inviteEn } from './dict/invite';
import { aiConfigEs, aiConfigEn } from './dict/ai_config';
import { avatarEditorEs, avatarEditorEn } from './dict/avatar_editor';
import { accountEs, accountEn } from './dict/account';
import { authEs, authEn } from './dict/auth';
import { caducidadesEs, caducidadesEn } from './dict/caducidades';
import { shoppingSuggestedEs, shoppingSuggestedEn } from './dict/shopping_suggested';
import { calendarEs, calendarEn } from './dict/calendar';
import { dashboardEs, dashboardEn } from './dict/dashboard';
import { logsEs, logsEn } from './dict/logs';
import { pantryEs, pantryEn } from './dict/pantry';
import { preferencesEs, preferencesEn } from './dict/preferences';
import { profileEs, profileEn } from './dict/profile';
import { settingsEs, settingsEn } from './dict/settings';
import { tasteEs, tasteEn } from './dict/taste';
import { aiParticipantsEs, aiParticipantsEn } from './dict/ai_participants';
import { householdEs, householdEn } from './dict/household';
import { recipesEs, recipesEn } from './dict/recipes';
import { aiActionAssistantEs, aiActionAssistantEn } from './dict/ai_action_assistant';

/**
 * El diccionario, por dentro. `check-ui` (reglas 15 y 20) ya vigila que una clave usada exista en los dos
 * idiomas y que nadie pinte la clave en crudo; esto cubre lo que un escaneo estatico no puede ver, porque es
 * una propiedad de LOS DOS OBJETOS a la vez:
 *
 *  - simetria: `es` y `en` tienen exactamente las mismas claves (un `Record<keyof typeof es, string>` en el
 *    fuente no vale si un dominio se olvida de declararlo: aqui se corta);
 *  - huecos: ninguna traduccion esta vacia, que es la forma de pantalla en blanco con el idioma cambiado;
 *  - calcos: una frase larga escrita igual en los dos idiomas es una traduccion pendiente disfrazada, y es
 *    justo lo que hace que «cambiar a ingles» parezca que no hace nada. Se perdonan las palabras sueltas
 *    («Gluten», «Soy»), que son iguales en los dos idiomas por naturaleza.
 */
describe('diccionario simetrico', () => {
  const es = {
    ...DICTS.es,
    ...homeProfilePickerEs,
    ...shoppingListsEs,
    ...shoppingListDetailEs,
    ...onboardingEs,
    ...inviteEs,
    ...aiConfigEs,
    ...avatarEditorEs,
    ...accountEs,
    ...authEs,
    ...caducidadesEs,
    ...shoppingSuggestedEs,
    ...calendarEs,
    ...dashboardEs,
    ...logsEs,
    ...pantryEs,
    ...preferencesEs,
    ...profileEs,
    ...settingsEs,
    ...tasteEs,
    ...aiParticipantsEs,
    ...householdEs,
    ...recipesEs,
    ...aiActionAssistantEs
  } as Record<string, string>;
  const en = {
    ...DICTS.en,
    ...homeProfilePickerEn,
    ...shoppingListsEn,
    ...shoppingListDetailEn,
    ...onboardingEn,
    ...inviteEn,
    ...aiConfigEn,
    ...avatarEditorEn,
    ...accountEn,
    ...authEn,
    ...caducidadesEn,
    ...shoppingSuggestedEn,
    ...calendarEn,
    ...dashboardEn,
    ...logsEn,
    ...pantryEn,
    ...preferencesEn,
    ...profileEn,
    ...settingsEn,
    ...tasteEn,
    ...aiParticipantsEn,
    ...householdEn,
    ...recipesEn,
    ...aiActionAssistantEn
  } as Record<string, string>;
  const claveDe = (dict: Record<string, string>) => Object.keys(dict).sort();

  it('tiene las mismas claves en los dos idiomas', () => {
    expect(claveDe(en)).toEqual(claveDe(es));
  });

  it('no deja ninguna traduccion vacia', () => {
    for (const [idioma, dict] of [
      ['es', es],
      ['en', en]
    ] as const) {
      // Se aserta sobre la lista unida, y no con el segundo argumento de `expect`: en Karma (Jasmine) ese
      // sitio lo ocupa `withContext`, que vitest no tiene —y este spec se corre en los dos.
      const vacias = Object.entries(dict)
        .filter(([, valor]) => valor.trim() === '')
        .map(([clave]) => `${idioma}:${clave}`);
      expect(vacias.join(', ')).toBe('');
    }
  });

  it('explica en ambos idiomas el error al quitar una comida', () => {
    expect(es['calendar.no_se_pudo_quitar_comida']).toBe(
      'No se pudo quitar la comida. Vuelve a intentarlo.'
    );
    expect(en['calendar.no_se_pudo_quitar_comida']).toBe(
      "The meal couldn't be removed. Try again."
    );
  });

  it('no calca frases largas del castellano', () => {
    const calcos = Object.keys(es).filter((clave) => {
      const a = es[clave];
      const b = en[clave];
      if (typeof b !== 'string' || a !== b) return false;
      return /[áéíóúüñ¿¡]/.test(a) && a.trim().split(/\s+/).length >= 2;
    });
    expect(`mismo texto en los dos idiomas: ${calcos.slice(0, 10).join(', ')}`).toBe(
      'mismo texto en los dos idiomas: '
    );
  });
});
