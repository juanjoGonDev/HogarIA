import { test, expect, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * El invariant de la tanda 20, escrito como test: **al cambiar de idioma no puede quedar texto del otro**.
 *
 * Por que hace falta un test y no basta el check-ui: `check-ui` exige que en la plantilla no haya literales
 * fuera de `| t`, pero no puede ver lo que sale de un dato (`item.name`), ni el texto de un placeholder que
 * alguien escribio en espanol en el `.ts`. Aqui se mira lo que de verdad se pinta, en la pantalla de verdad.
 *
 * Y por que las dos direcciones: en ingles sobra el espanol, y en espanol sobra el ingles —una lista en un
 * solo sentido se conforma con que la app este toda en ingles, que es justo como empezo esta tanda.
 *
 * Las palabras estan escogidas para no salir en un dato: `Mercadona` o `Leche` pueden aparecer en cualquier
 * lista y no son de la interfaz; `Pendientes` o `Pending` solo las escribe la app.
 */
const SOLO_ESPANOL = [
  'Añadir',
  'Agregar',
  'Guardar',
  'Cancelar',
  'Inventario',
  'Recetas',
  'Configuración',
  'Compras',
  'Pendientes',
  'porciones',
  'Reabrir',
  'Terminar lista',
  'Buscar',
  'Sin unidad',
  'Unidad o formato',
  'marcados',
  'Filtros',
  'Cargar',
  'Eliminar',
  'Editar'
];
const SOLO_INGLES = [
  'Add to',
  'Save changes',
  'Cancel',
  'Inventory',
  'Recipes',
  'Settings',
  'Pending',
  'servings',
  'Reopen',
  'Finish the list',
  'Search',
  'No unit',
  'ticked',
  'Filters',
  'Loading',
  'Delete',
  'Edit',
  'Rename the list',
  'Upload a photo'
];

/** Las pantallas por las que alguien navega de verdad, con una frase que SOLO existe en cada idioma. */
const PANTALLAS: { ruta: string; es: string; en: string }[] = [
  { ruta: '/dashboard', es: 'Recetas', en: 'Recipes' },
  { ruta: '/recipes', es: 'Filtros', en: 'Filters' },
  { ruta: '/pantry', es: 'Inventario', en: 'Inventory' },
  // El h1 de la bandeja, no un tab: «Pendientes» vive en la DETALLE de la lista con contador, y una casa
  // recién registrada no tiene pestaña que ver —el par este estaba inventado (## 12af, visible al correr
  // el spec fuera del shard 2 cancelado).
  { ruta: '/shopping', es: 'Lista de la compra', en: 'Shopping list' },
  { ruta: '/calendar', es: 'Calendario', en: 'Calendar' },
  { ruta: '/account', es: 'Configuración', en: 'Settings' },
  { ruta: '/preferences', es: 'Horarios', en: 'Meal times' }
];

/**
 * Lo que se ve y lo que se ve al pasar el raton por encima. Los `placeholder` y los `title` son donde el
 * espanol se escondio mas tiempo: no salen en `innerText`, y ahi es donde `check-ui` no llegaba si la
 * cadena venia de una expresion.
 */
async function textoVisible(page: Page): Promise<string> {
  const attrs = await page.$$eval('[placeholder], [title], [aria-label]', (nodos) =>
    nodos
      .map((n) => {
        const e = n as HTMLElement;
        return [
          e.getAttribute('placeholder'),
          e.getAttribute('title'),
          e.getAttribute('aria-label')
        ]
          .filter(Boolean)
          .join(' · ');
      })
      .filter(Boolean)
      .join('\n')
  );
  const body = await page.locator('body').innerText();
  return `${body}\n${attrs}`;
}

function contiene(texto: string, frase: string): boolean {
  // Con limite de palabra y distinguiendo mayusculas: `Add` dentro de `Address`, o `Edit` dentro de
  // `Editing hours` en la hoja de calculo de alguien, no pueden hacer fallar un test de idioma.
  return new RegExp(
    `(^|[^A-Za-zÁ-ÿ])${frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-zÁ-ÿ]|$)`
  ).test(texto);
}

async function elegirIdioma(page: Page, opcion: 'English' | 'Español'): Promise<void> {
  // Por `data-test`, no por el nombre: las etiquetas llevan bandera y se traducen («Spanish» con la app en
  // inglés), y el acceso exacto por nombre dejó de coincidir el día que los botones ganaron el emoji —la
  // prueba era ciega y el `exact: true` se quedó esperando 45 s en las dos opciones (## 12af).
  const clave = opcion === 'English' ? 'en' : 'es';
  await page.goto('/settings');
  await expect(page.locator('.settings-group__title').nth(1)).toBeVisible();
  await page.locator(`[data-test="settings-lang-${clave}"]`).click();
}

test.describe('el idioma llega a toda la app', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/settings', 'Bilingue');
  });

  for (const pantalla of PANTALLAS) {
    test(`en ingles, ${pantalla.ruta} no tiene restos de espanol`, async ({ page }) => {
      await elegirIdioma(page, 'English');
      await page.goto(pantalla.ruta);
      // El texto esperado se aguarda con asercion retryable ANTES de leer el cuerpo: `textoVisible` es de
      // un solo tiro y con el chunk perezoso sin compilar (ng serve frio, workers=2 en CI) leia el vacio
      // y pintaba «falta el texto» estando el test verde en local (## 12af).
      await expect(page.locator('body')).toContainText(pantalla.en);
      const texto = await textoVisible(page);
      expect(contiene(texto, pantalla.en), `falta el texto en ingles «${pantalla.en}»`).toBe(true);
      const restos = SOLO_ESPANOL.filter((frase) => contiene(texto, frase));
      expect(restos, `texto en espanol con el idioma en ingles: ${restos.join(', ')}`).toEqual([]);
    });

    test(`de vuelta en espanol, ${pantalla.ruta} no tiene restos de ingles`, async ({ page }) => {
      await elegirIdioma(page, 'English');
      await elegirIdioma(page, 'Español');
      await page.goto(pantalla.ruta);
      await expect(page.locator('body')).toContainText(pantalla.es); // mismo retiro a la lectura ciega
      const texto = await textoVisible(page);
      expect(contiene(texto, pantalla.es), `falta el texto en espanol «${pantalla.es}»`).toBe(true);
      const restos = SOLO_INGLES.filter((frase) => contiene(texto, frase));
      expect(restos, `texto en ingles con el idioma en espanol: ${restos.join(', ')}`).toEqual([]);
    });
  }

  test('cambiar de idioma se nota sin recargar la pagina', async ({ page }) => {
    // El control de la pipe IMPURA: si `TranslatePipe` fuera pura, lo unico que cambia al pulsar el boton
    // es lo que se vuelva a pintar desde cero, y una navegacion lo disimula. Por eso aqui se pulsa EN LA
    // MISMA pantalla y se mira el mismo nodo: 'Recetas' tiene que volverse 'Recipes' sin un solo `goto`.
    await elegirIdioma(page, 'English');
    const etiqueta = page
      .locator('.sidebar__label')
      .filter({ hasText: /Recipes|Recetas/ })
      .first();
    if (!(await isVisibleNow(etiqueta))) {
      test.skip(
        true,
        'en esta viewport la navegacion no usa .sidebar__label (la cubre el resto de la suite)'
      );
    }
    await expect(etiqueta).toHaveText('Recipes');
    await page.locator('[data-test="settings-lang-es"]').click();
    await expect(etiqueta).toHaveText('Recetas');
  });

  /** En la pagina de Configuracion no hay navegacion: se comprueba el nodo tal cual esta. */
  async function isVisibleNow(locator: import('@playwright/test').Locator): Promise<boolean> {
    return (await locator.count()) > 0 && locator.first().isVisible();
  }
});
