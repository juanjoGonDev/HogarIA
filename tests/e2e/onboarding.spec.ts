import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * Configuración inicial, nada más registrarse: perfil (nivel y qué se quiere
 * llevar desde la app), alergias, gustos, objetivo, horarios de las comidas y
 * utensilios. Es saltable —por completo o paso a paso—, se guarda en la cuenta
 * (no en el hogar) y se puede editar a mano en Preferencias.
 *
 * Los «Paso N de 6» son el contrato con `ONBOARDING_STEPS` (frontend/src/app/core/onboarding-steps.ts):
 * el número se deriva de la lista, así que añadir una pregunta cambia estos literales y nada más. Que
 * aquí estén escritos a propósito (y no calculados) es lo que hace que alguien tenga que decidir si el
 * usuario debe ver seis pasos o cinco.
 *
 * Escrito en la ronda de los horarios; en el sandbox no hay Chromium, así que estos casos no se han
 * ejecutado aquí —corren en CI (`playwright test`), donde el registro real y el servidor levantan.
 *
 * Los controles se buscan por sus atributos de datos (data-level, data-module),
 * no por su texto: las etiquetas viven en el idioma resuelto y en CI puede ser
 * distinto del castellano en el primer render.
 */
test.describe('Onboarding — gustos, alergias y objetivo', () => {
  test('la configuración inicial se abre tras crear un hogar y se puede saltar', async ({
    page
  }) => {
    await registerAndGoto(page, '/onboarding', 'Salta Tester');

    await expect(page.locator('.onboarding__title')).toHaveText('Configura tu HogarIA');
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 1 de 6 · Perfil');

    // Cuatro niveles, incluido «apenas cocino», y las cinco secciones de la casa
    await expect(page.locator('[data-level]')).toHaveCount(4);
    await expect(page.locator('label[data-module]')).toHaveCount(5);

    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 2 de 6 · Alergias');
    // Alérgenos proposés en su paso, sin tener que escribirlos
    await expect(page.locator('.chip-select__chip').first()).toContainText('Gluten');

    await page.getByRole('button', { name: /Saltar por ahora/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);

    // Saltar no borra nada: en Preferencias sigue el perfil vacío, listo para editar
    await page.goto('/preferences');
    await expect(page.locator('.preferences__title')).toContainText('Preferencias');
    await expect(
      page.locator('.preferences__notice', { hasText: 'Todavía no has marcado nada' })
    ).toBeVisible();
  });

  test('guarda alergias (también una escrita a mano), gustos, objetivo y utensilios', async ({
    page
  }) => {
    await registerAndGoto(page, '/onboarding', 'Perfil Tester');

    // ── Paso 1 · perfil: cuánto se cocina y qué se quiere llevar
    await page.locator('[data-level="none"]').click();
    await expect(page.locator('[data-level="none"]')).toHaveClass(/profile-picker__level--on/);
    await page.locator('label[data-module="shopping"]').click();
    await page.locator('label[data-module="meals"]').click();

    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // ── Paso 2 · alergias: un chip del catálogo + uno propio
    await page.locator('.chip-select__chip', { hasText: 'Lactosa' }).click();
    await page.locator('input[name="chip-select-custom"]').fill('Kiwi');
    await page.getByRole('button', { name: 'Añadir' }).click();

    const selected = page.locator('.chip-select__chip--on');
    await expect(selected).toHaveCount(2);
    await expect(selected.filter({ hasText: 'Kiwi' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // ── Paso 2 · gustos y texto libre
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 3 de 6 · Gustos');
    await page
      .getByRole('group', { name: 'Lo que más te gusta' })
      .locator('.chip-select__chip', { hasText: 'Legumbres' })
      .click();
    await page
      .getByRole('group', { name: 'Lo que prefieres evitar' })
      .locator('.chip-select__chip', { hasText: 'Setas y champiñones' })
      .click();
    await page.fill('textarea#tasteNotes', 'Ceno pronto y como en el trabajo con tupper.');

    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // ── Paso 3 · objetivo
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 4 de 6 · Objetivo');
    const loseWeight = page.locator('.onboarding__goal', { hasText: 'Perder peso' });
    const gainMuscle = page.locator('.onboarding__goal', { hasText: 'Ganar músculo' });
    await loseWeight.click();
    await gainMuscle.click();
    await expect(loseWeight).toHaveAttribute('aria-pressed', 'true');
    await expect(gainMuscle).toHaveAttribute('aria-pressed', 'true');
    await page.fill('textarea#goalNotes', 'Poco frito y nada de bollería.');

    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // ── Paso 5 · a qué hora come esta casa (y cómo se vuelve a la de siempre)
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 5 de 6 · Horarios');
    await expect(page.locator('#ob-meal-breakfast')).toHaveValue('09:00');
    await expect(page.locator('#ob-meal-dinner')).toHaveValue('20:30');

    // «Por defecto» no es un texto del paso: es un botón que solo existe en la fila que se ha tocado.
    // Las cuatro intactas = cero botones; una tocada = uno; devuelta = cero otra vez.
    await expect(page.getByRole('button', { name: 'Por defecto' })).toHaveCount(0);
    await page.fill('#ob-meal-dinner', '21:45');
    await expect(page.getByRole('button', { name: 'Por defecto' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Por defecto' }).click();
    await expect(page.locator('#ob-meal-dinner')).toHaveValue('20:30');
    await expect(page.getByRole('button', { name: 'Por defecto' })).toHaveCount(0);

    // Se queda como lo quería el resto del escenario: cena a las 21:45.
    await page.fill('#ob-meal-dinner', '21:45');
    await expect(page.locator('.onboarding__skip--step')).toBeVisible();

    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // ── Paso 6 · la disponibilidad solo se edita en la propia despensa
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 6 de 6 · Cocina');
    await expect(page.locator('input.utensil-card__check')).toHaveCount(0);
    const pantrySave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/taste' &&
        response.request().method() === 'PATCH'
    );
    await page.getByRole('link', { name: 'Gestionar utensilios →' }).click();
    expect((await pantrySave).status()).toBe(200);
    await expect(page).toHaveURL(/\/pantry\?tab=utensils$/);

    await page.fill('input#utensilios-q', 'Airfryer');
    const airfryer = page.getByRole('row', { name: /Airfryer/ });
    await expect(airfryer).toBeVisible({ timeout: 20000 });
    const availability = airfryer.getByRole('checkbox', { name: 'Airfryer' }).last();
    if ((await availability.getAttribute('aria-checked')) !== 'true') await availability.click();
    await expect(availability).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await page.fill('input#utensilios-q', 'Airfryer');
    await expect(
      page
        .getByRole('row', { name: /Airfryer/ })
        .getByRole('checkbox', { name: 'Airfryer' })
        .last()
    ).toHaveAttribute('aria-checked', 'true');

    // El tour sigue pendiente y vuelve con las respuestas que se guardaron antes de navegar.
    await page.goto('/onboarding');
    await expect(page.locator('[data-level="none"]')).toHaveClass(/profile-picker__level--on/);
    for (let step = 0; step < 5; step += 1) {
      await page.getByRole('button', { name: 'Siguiente →' }).click();
    }
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 6 de 6 · Cocina');
    await page.getByRole('button', { name: 'Guardar y empezar' }).click();
    await expect(page.locator('.toast--success').filter({ hasText: 'Listo' })).toBeVisible();
    await expect(page).toHaveURL(/.*dashboard/);

    // ── Persistido: Preferencias muestra exactamente lo contestado, en su pestaña
    await page.goto('/preferences');
    await expect(page.locator('.tab--active')).toContainText('Perfil');
    await expect(page.locator('[data-level="none"]')).toHaveClass(/profile-picker__level--on/);
    // Los módulos se contestan en el tour, pero su sitio de edicion es Configuracion:
    // Preferencias ya no los pinta (son de la app, no del comensal).
    await page.goto('/settings');
    await expect(page.locator('[data-module-switch="shopping"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('[data-module-switch="pantry"]')).toHaveAttribute(
      'aria-checked',
      'false'
    );

    await page.goto('/preferences');
    await page.locator('.tab', { hasText: 'Alergias' }).click();
    await expect(page.locator('.chip-select__chip--on', { hasText: 'Lactosa' })).toHaveCount(1);
    await expect(page.locator('.chip-select__chip--on', { hasText: 'Kiwi' })).toHaveCount(1);
    await expect(page.locator('.tab', { hasText: 'Alergias' })).toContainText('2');

    await page.locator('.tab', { hasText: 'Gustos' }).click();
    await expect(page).toHaveURL(/tab=tastes/);
    await expect(page.locator('.chip-select__chip--on', { hasText: 'Legumbres' })).toHaveCount(1);
    await expect(page.locator('.chip-select__chip--on', { hasText: 'Setas' })).toHaveCount(1);
    await expect(page.locator('textarea#tasteNotes')).toHaveValue(
      'Ceno pronto y como en el trabajo con tupper.'
    );

    await page.locator('.tab', { hasText: 'Objetivo' }).click();
    await expect(page).toHaveURL(/tab=goal/);
    await expect(page.locator('.preferences__goal', { hasText: 'Perder peso' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('.preferences__goal', { hasText: 'Ganar músculo' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('textarea#goalNotes')).toHaveValue('Poco frito y nada de bollería.');

    // La hora escrita en el tour vive en Preferencias, que es donde se cambia despues
    await page.locator('.tab', { hasText: 'Horarios' }).click();
    await expect(page).toHaveURL(/tab=meals/);
    await expect(page.locator('#meal-dinner')).toHaveValue('21:45');
    await expect(page.locator('#meal-lunch')).toHaveValue('14:00');
    await expect(page.locator('.tab', { hasText: 'Horarios' })).toContainText('09:00–21:45');

    // El utencilio marcado en el onboarding vive en la despensa, no en un sitio aparte.
    // La tabla pagina, asi que se busca: la prueba no depende de en que pagina caiga.
    await page.goto('/pantry?tab=utensils');
    await page.fill('input#utensilios-q', 'Airfryer');
    await expect(page.locator('.utensil-card', { hasText: 'Airfryer' })).toHaveClass(
      /utensil-card--owned/
    );
    await expect(page.locator('.tab', { hasText: 'Utensilios' })).toContainText('1');

    // Y el onboarding vuelve con las respuestas puestas si se rehace
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await expect(page.locator('.chip-select__chip--on', { hasText: 'Lactosa' })).toHaveCount(1);

    // El enlace de rehacer sale de Preferencias, no de la configuración de la app
    await page.goto('/preferences');
    await expect(page.locator('.preferences__redo')).toContainText('Rehacer la configuración');
  });

  test('una alergia escrita a mano se conserva al volver atrás y se puede quitar', async ({
    page
  }) => {
    await registerAndGoto(page, '/onboarding', 'Chip Tester');

    // Se entra en el paso de alergias (el 1 es el perfil)
    await page.getByRole('button', { name: 'Siguiente →' }).click();

    // 'Mango' no está en ninguna lista: la IA lo recibe tal cual se escribió
    await page.locator('input[name="chip-select-custom"]').fill('Mango');
    await page.getByRole('button', { name: 'Añadir' }).click();

    const mango = page.locator('.chip-select__chip--on', { hasText: 'Mango' });
    await expect(mango).toHaveCount(1);

    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await page.getByRole('button', { name: /Atrás/ }).click();

    // Volver atrás no reinicia lo contestado
    await expect(mango).toHaveCount(1);

    // Y se quita volviendo a pulsar la chip
    await mango.click();
    await expect(page.locator('.chip-select__chip--on')).toHaveCount(0);
  });

  test('se puede saltar un paso concreto sin cerrar el tour', async ({ page }) => {
    await registerAndGoto(page, '/onboarding', 'Salto Tester');

    // Se entra en alergias y se salta ESA pregunta: el tour continua, no se va al dashboard.
    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 2 de 6 · Alergias');

    await page.getByRole('button', { name: /Saltar este paso/i }).click();
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 3 de 6 · Gustos');

    // Y la cabecera dice que de alergias no se ha contestado nada (no es un «hecho», es un hueco visto)
    await page.getByRole('button', { name: /Atrás/ }).click();
    await expect(page.locator('.onboarding__step-label')).toContainText('sin responder');

    // Con el teclado: Escape salta el paso en el que estás...
    await page.keyboard.press('Escape');
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 3 de 6 · Gustos');
    // ...y Enter pasa al siguiente, sin cerrar el tour (eso sigue siendo un boton).
    // `.last()`: los pasos ya visitados siguen montados, y el de Alergias trae su propio input libre —el
    // localizador estricto encontraban dos desde que el tour guarda lo Contestado (## 12af).
    await page.locator('input[name="chip-select-custom"]').last().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 4 de 6 · Objetivo');
    await expect(page).toHaveURL(/onboarding/);

    // Lo que ya estaba contestado no se pierde por saltar otro paso
    await page.locator('.onboarding__goal', { hasText: 'Variada' }).click();
    // «Guardar y empezar» solo existe en el ULTIMO paso: desde la ronda de los horarios el tour cerraba en
    // Objetivo y ahora quedan Horarios y Cocina por delante; el spec seguia saltando directo al boton de
    // otro añares (invisible: su shard se cancela siempre en CI) (## 12af).
    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await page.getByRole('button', { name: 'Siguiente →' }).click();
    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 6 de 6');
    await page.getByRole('button', { name: 'Guardar y empezar' }).click();
    // `.last()`: el alta de arriba aun tiene su toast en pantalla, y el del tour es el que importa —el
    // texto antes era la clave cruda porque `save` no traducía (arreglado en la ## 12af).
    await expect(page.locator('.toast--success').last()).toContainText('Listo');
    await expect(page).toHaveURL(/dashboard/);
  });

  test('los horarios del tour y de Preferencias son el mismo ajuste', async ({ page }) => {
    await registerAndGoto(page, '/preferences?tab=meals', 'Horarios Tester');
    await expect(page.locator('#meal-breakfast')).toHaveValue('09:00');
    await expect(page.locator('#meal-snack')).toHaveValue('17:00');

    await page.fill('#meal-dinner', '22:15');
    await expect(page.locator('.preferences__state')).toContainText('Hay cambios sin guardar');
    // El mismo control en las dos pantallas: aqui «hay cambios» se entera porque el componente escribe
    // en el objeto del host (fue el bug de la copia), y el botón aparece en la fila tocada.
    await expect(page.getByRole('button', { name: 'Por defecto' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Por defecto' }).click();
    await expect(page.locator('#meal-dinner')).toHaveValue('20:30');
    // El aviso de «sin guardar» no se esconde: deja de existir (el span vive dentro de un *ngIf), asi que se
    // cuenta, no se le pide texto a un fantasma (## 12af).
    await expect(
      page.locator('.preferences__state', { hasText: 'Hay cambios sin guardar' })
    ).toHaveCount(0);
    await page.fill('#meal-dinner', '22:15');
    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();

    await page.reload();
    await expect(page.locator('#meal-dinner')).toHaveValue('22:15');

    // Vaciar la casilla no guarda una hora en blanco: devuelve la de la app
    await page.fill('#meal-dinner', '');
    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    await page.reload();
    await expect(page.locator('#meal-dinner')).toHaveValue('20:30');
  });

  test('lo guardado en Preferencias es el punto de partida del planificador', async ({ page }) => {
    await registerAndGoto(page, '/preferences?tab=goal', 'Plan Tester');
    await page.locator('.preferences__goal', { hasText: 'Ganar músculo' }).click();
    await expect(page.locator('.preferences__state')).toContainText('Hay cambios sin guardar');
    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();

    await page.goto('/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await page.getByRole('button', { name: /Planificar IA/ }).click();

    await expect(page.locator('[data-test="generate-goal-muscle-gain"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Las cuatro comidas vienen marcadas; desmarcar la merienda es decirle a la IA que no la escriba
    await expect(page.locator('[data-test="gen-meals"]')).toBeVisible();
    await expect(page.locator('[data-test="gen-meal-breakfast"]')).toBeVisible();
    // `app-checkbox` es un `button[role="checkbox"]` con el `data-test` en el propio elemento: no hay ningun
    // input dentro que marcar (esperarlo era esperar 45 segundos a un localizador que no existe). Se pulsa por
    // su rol y se comprueba por `aria-checked`, igual que en `pantry-managers.spec.ts`.
    const casilla = (comida: string) =>
      page.locator(`[data-test="gen-meal-${comida}"] [role="checkbox"]`);
    await casilla('snack').click();
    await casilla('dinner').click();
    await expect(casilla('snack')).toHaveAttribute('aria-checked', 'false');
  });
});
