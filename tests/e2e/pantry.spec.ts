import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { registerWithHousehold } from './helpers/auth';
import { ponTamano } from './helpers/tabla';

/**
 * El visor del inventario es `app-data-table` desde la ## 12ab: orden por columna, filtros estilo Excel,
 * paginacion y lote. El riel de chips con scroll y la lista de siempre estan jubilados. Las pruebas
 * empujan la tabla por los huecos que la pantalla le pasa (busqueda/subarbol en la URL, lote con
 * confirmacion propia) y dejan los detalles del mecanismo para la spec de la tabla.
 */

const tabla = (page: Page): Locator => page.locator('[data-test="pantry-tabla-inventario"]');
const fila = (page: Page, nombre: string): Locator =>
  tabla(page).locator('tr.ingredient-item', { hasText: nombre });

const filasPrimera = (page: Page): Locator => tabla(page).locator('tr.ingredient-item').first();

const elegir = async (page: Page, picker: string, opcion: string): Promise<void> => {
  const caja = page.locator(picker);
  await caja.locator('.picker__trigger').click();
  await caja.locator('.picker__option').filter({ hasText: opcion }).first().click();
};

/** Alta por el modal de siempre: el visor no tiene formulario propio, y el modal es de la casa. */
async function darAlta(
  page: Page,
  opts: {
    nombre: string;
    cantidad: string;
    categoria?: string;
    ubicacion?: string;
    unidad?: string;
    caducidad?: string;
  }
): Promise<void> {
  await page.getByRole('button', { name: '+ Agregar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar Ingrediente' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input#ingredientName').fill(opts.nombre);
  await dialog.locator('input#quantity').fill(opts.cantidad);
  if (opts.unidad) await dialog.locator('select[name="unit"]').selectOption(opts.unidad);
  if (opts.categoria) await elegir(page, '[data-test="pantry-picker-categoria"]', opts.categoria);
  if (opts.ubicacion) await elegir(page, '[data-test="pantry-picker-ubicacion"]', opts.ubicacion);
  if (opts.caducidad) await dialog.locator('input#expiration').fill(opts.caducidad);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(fila(page, opts.nombre)).toHaveCount(1);
  await expect(page.locator('.toast--success').last()).toContainText('Agregado');
}

async function capturarInventario(
  page: Page,
  testInfo: { project: { name: string } }
): Promise<void> {
  const directory = join(process.cwd(), '.e2e-screenshots', 'qa-datatable-20261002');
  await mkdir(directory, { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Playwright debe configurar un viewport para capturar la tabla.');
  await page.screenshot({
    path: join(
      directory,
      `pantry-${testInfo.project.name}-${viewport.width}x${viewport.height}.png`
    ),
    fullPage: true,
    animations: 'disabled'
  });
}

test.describe('Pantry — inventario en tabla', () => {
  test.beforeEach(async ({ page }) => {
    // El seed de ingredientes se crea junto al hogar, todo a cero: el inventario empieza vacio.
    await registerWithHousehold(page, '/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();
  });

  test('la pagina abre con las stats y la tabla todavia sin llenar', async ({ page }) => {
    await expect(page.locator('.stat-card__label')).toContainText([
      'En inventario',
      'Por caducar',
      'Caducados'
    ]);
    await expect(page.locator('.stat-card--total .stat-card__value')).toHaveText('0');
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0);
  });

  test('el alta pinta la fila con su cantidad y sube el contador global', async ({
    page
  }, testInfo) => {
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' });
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(fila(page, 'Tomate')).toContainText('500 g'); // el modal nace en gramos
    await expect(page.locator('.stat-card--total .stat-card__value')).toHaveText('1');
    await expect(page.locator('.toast-container .toast')).toHaveCount(0, { timeout: 90_000 });
    await capturarInventario(page, testInfo);
  });

  test('la busqueda es instantanea, ignora mayusculas y acentos, y viaja en la URL', async ({
    page
  }) => {
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' });

    await page.fill('input#search', 'toma');
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(page).toHaveURL(/[?&]buscar=toma/);

    // mayusculas y acentos: «TOMÁ» sigue valiendo para «tomate»… pero sobre todo no la lian al reescribir
    await page.fill('input#search', 'TOMATE');
    await expect(fila(page, 'Tomate')).toHaveCount(1);

    await page.fill('input#search', 'nada-que-ver');
    // (## 12ad, E) El buscador vive ahora dentro de la tarjeta: con cero aciertos la tabla se queda montada
    // para que el campo siga a mano; lo que desaparece son las filas.
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0);

    // F5 con la busqueda puesta: la pantalla vuelve igual, sin depender del server. Antes de recargar se
    // espera a que la URL refleje lo ultimo escrito (el repaso es con debounce; si no, el F5 hereda una
    // busqueda vieja y la prueba mide otra cosa).
    await expect(page).toHaveURL(/[?&]buscar=nada-que-ver/);
    await page.reload();
    await expect(page.locator('input#search')).toHaveValue('nada-que-ver');
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0);

    await page.fill('input#search', '');
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(page).not.toHaveURL(/buscar=/);
  });

  test('el filtro de categorias minimiza el riel en un picker y filtra por subarbol', async ({
    page
  }) => {
    await darAlta(page, { nombre: 'Tomate', cantidad: '500', categoria: 'Verduras' });

    const picker = page.locator('[data-test="pantry-filtro-categoria"]');
    await picker.locator('.picker__trigger').click();
    // ## 12aa: el padre (Alimentos) existe como opcion aparte; «Todos» es el valor limpio.
    const opciones = picker.locator('.picker__option');
    await expect(opciones.filter({ hasText: 'Todos' })).toHaveCount(1);
    await expect(opciones.filter({ hasText: 'Verduras' })).toHaveCount(1);
    await opciones.filter({ hasText: 'Alimentos' }).first().click();

    // «Alimentos» arrastra a sus hijas: el tomate (Verduras) se ve con el padre elegido.
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(page).toHaveURL(/[?&]category=/);

    await picker.locator('.picker__trigger').click();
    await picker.locator('.picker__option').filter({ hasText: 'Frutas' }).first().click();
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0);

    // La recarga conserva el subarbol elegido: la pantalla sigue siendo enlazable.
    await page.reload();
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0);

    await picker.locator('.picker__trigger').click();
    await picker.locator('.picker__option').filter({ hasText: 'Todos' }).first().click();
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(page).not.toHaveURL(/category=/);
  });

  test('el menu de columna filtra por valores como Excel', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'el cabezal con los menus es del reflujo de escritorio; en movil manda la hoja (abajo)'
    );
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' }); // g
    await darAlta(page, { nombre: 'Leche', cantidad: '2', unidad: 'l' });
    await darAlta(page, { nombre: 'Huevos', cantidad: '12', unidad: 'unit' });

    await tabla(page).locator('[data-test="tabla-filtro-unit"]').click();
    const menu = page.locator('.menu');
    // La semantica es la de Excel: todas las casillas nacen marcadas y lo que se hace es DESMARCAR las que
    // no interesan. Quitar «g» y «unit» deja la tabla con las filas en litros.
    await menu.locator('.menu__fila', { hasText: /^g/ }).locator('button[role="checkbox"]').click();
    await menu
      .locator('.menu__fila', { hasText: /^unit/ })
      .locator('button[role="checkbox"]')
      .click();

    await expect(tabla(page).locator('tr.ingredient-item')).toHaveCount(1);
    await expect(fila(page, 'Leche')).toHaveCount(1);

    await menu.locator('[data-test="tabla-menu-limpiar"]').click();
    await page.keyboard.press('Escape');
    await expect(tabla(page).locator('tr.ingredient-item')).toHaveCount(3);
  });

  test('la caducidad filtra por «hoy» desde su menu', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'el menu de la columna fecha vive en el cabezal: en movil, lo mismo desde la hoja'
    );
    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    await darAlta(page, { nombre: 'Yogur hoy', cantidad: '6', caducidad: iso });
    await darAlta(page, { nombre: 'Leche larga', cantidad: '2', caducidad: '2030-01-01' });

    await tabla(page).locator('[data-test="tabla-filtro-expirationDate"]').click();
    await page.locator('.menu [data-test="tabla-modo-hoy"]').click();
    await page.keyboard.press('Escape');

    await expect(tabla(page).locator('tr.ingredient-item')).toHaveCount(1);
    await expect(fila(page, 'Yogur hoy')).toHaveCount(1);
    // y la celda muestra el dia en dd/mm/aaaa, no el ISO del server
    await expect(fila(page, 'Yogur hoy')).toContainText(
      `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    );
  });

  test('ordenar por columna y orden multiple con shift', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'los botones de orden del cabezal no existen en el reflujo de movil'
    );
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' });
    await darAlta(page, { nombre: 'Leche', cantidad: '2' });
    await darAlta(page, { nombre: 'Huevos', cantidad: '12' });

    const primeraFila = tabla(page).locator('tr.ingredient-item').first();

    await tabla(page).locator('[data-test="tabla-orden-name"]').click(); // primera pulsacion: ascendente
    await expect(primeraFila).toContainText('Huevos');

    await tabla(page).locator('[data-test="tabla-orden-name"]').click(); // segunda: descendente
    await expect(primeraFila).toContainText('Tomate');

    // El numero ordena por numero, no por texto: 2 < 12 < 500 (con texto, 12 ganaria a 2 por el '1').
    await tabla(page).locator('[data-test="tabla-orden-quantity"]').click();
    await expect(primeraFila).toContainText('Leche');

    // Un orden solitario no lleva numero: la insignia ①…② solo aparece con dos criterios o mas.
    await tabla(page).locator('[data-test="tabla-orden-name"]').click(); // click suelto: la columna manda sola otra vez
    await expect(tabla(page).locator('[data-test="tabla-orden-name"] .th__ord')).toHaveCount(0);
    // Shift sujeto con el teclado, no con `modifiers`: es el gesto exacto del usuario, y deja menos
    // margen a que el navegador reparta el clic sin la tecla pisada.
    await page.keyboard.down('Shift');
    await tabla(page).locator('[data-test="tabla-orden-quantity"]').click();
    await page.keyboard.up('Shift');
    await expect(tabla(page).locator('[data-test="tabla-orden-name"] .th__ord')).toHaveText('1');
    await expect(tabla(page).locator('[data-test="tabla-orden-quantity"] .th__ord')).toHaveText(
      '2'
    );
    // Y la secundaria se suelta como en Excel: otra pulsacion la invierte (asc→desc) y la siguiente la
    // quita del orden, dejando la primaria intacta. Rotacion firmada en la spec de la util.
    await page.keyboard.down('Shift');
    await tabla(page).locator('[data-test="tabla-orden-quantity"]').click();
    await page.keyboard.up('Shift');
    await expect(tabla(page).locator('[data-test="tabla-orden-quantity"] .th__ord')).toHaveText(
      '2'
    ); // invertida, sigue segunda
    await page.keyboard.down('Shift');
    await tabla(page).locator('[data-test="tabla-orden-quantity"]').click();
    await page.keyboard.up('Shift');
    await expect(tabla(page).locator('[data-test="tabla-orden-quantity"] .th__ord')).toHaveCount(0); // fuera del orden
    await expect(tabla(page).locator('[data-test="tabla-orden-name"] .th__ord')).toHaveCount(0); // y Nombre manda solo

    // y a 100 por pagina, la cuenta del pie dice la realidad
    await ponTamano(tabla(page), 100);
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('de 3');
  });

  test('el lote: vaciar manda las filas a las sugerencias y borrar las quita, con su confirmacion', async ({
    page
  }) => {
    await darAlta(page, { nombre: 'A lotazo', cantidad: '10' });
    await darAlta(page, { nombre: 'B lotazo', cantidad: '20' });

    for (const nombre of ['A lotazo', 'B lotazo']) {
      await fila(page, nombre)
        .locator('[data-test^="tabla-marcar-"]')
        .locator('button[role="checkbox"]')
        .click();
    }
    await expect(page.locator('[data-test="pantry-lote"]')).toContainText('2 seleccionados');

    // vaciar = PATCH {quantity:0} en bucle, con el dialogo propio de la app en medio
    await page.locator('[data-test="pantry-lote-vaciar"]').click();
    const dialogo = page.locator('.modal-overlay');
    await expect(dialogo.locator('.modal__title')).toContainText('¿Vaciar los articulos elegidos?');
    await expect(dialogo.locator('.confirm__message')).toContainText('2 articulos');
    await dialogo.getByRole('button', { name: 'Vaciar' }).click();
    await expect(page.locator('.toast--success').last()).toContainText('2 articulos vaciados');
    await expect(tabla(page).locator('tr.tabla__fila')).toHaveCount(0); // ya no hay filas con cantidad: 0
    await expect(page.locator('.stat-card--total .stat-card__value')).toHaveText('0');

    // y las dos vuelven a «lo que la casa conoce»: el contador del expand sube
    await expect(page.locator('[data-test="pantry-sugerencias-toggle"]')).toContainText(
      'sin existencias'
    );

    // borrar = DELETE en bucle: las fichas desaparecen del inventario de la casa
    await darAlta(page, { nombre: 'C borrado', cantidad: '5' });
    await fila(page, 'C borrado')
      .locator('[data-test^="tabla-marcar-"]')
      .locator('button[role="checkbox"]')
      .click();
    await page.locator('[data-test="pantry-lote-borrar"]').click();
    await expect(dialogo.locator('.modal__title')).toContainText('¿Borrar los articulos elegidos?');
    await dialogo.getByRole('button', { name: 'Borrar' }).click();
    await expect(page.locator('.toast--success').last()).toContainText('1 articulos borrados');
    await expect(fila(page, 'C borrado')).toHaveCount(0);
  });

  test('anular seleccion suelta el lote sin tocar nada', async ({ page }) => {
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' });
    await fila(page, 'Tomate')
      .locator('[data-test^="tabla-marcar-"]')
      .locator('button[role="checkbox"]')
      .click();
    await expect(page.locator('[data-test="pantry-lote"]')).toBeVisible();
    await page.locator('[data-test="pantry-lote-anular"]').click();
    await expect(page.locator('[data-test="pantry-lote"]')).toHaveCount(0);
    await expect(fila(page, 'Tomate')).toHaveCount(1);
    await expect(fila(page, 'Tomate')).toContainText('500 g');
  });

  test('el stepper de la fila mueve la cantidad de uno en uno y a cero no borra la ficha', async ({
    page
  }) => {
    await darAlta(page, { nombre: 'Tomate stepper', cantidad: '5' });

    const filaEst = fila(page, 'Tomate stepper');
    await filaEst.locator('[data-test^="pantry-stock-mas-"]').click();
    await expect(filaEst).toContainText('6 g');
    await filaEst.locator('[data-test^="pantry-stock-menos-"]').click();
    await expect(filaEst).toContainText('5 g');

    // Bajar a 0 deja la ficha en «lo que la casa conoce» (la semantica de `staples`, ## 12x). Se espera la
    // cifra entre pulsaciones: el PATCH va al server y la tabla se redrawibera con la recarga completa.
    for (let cantidad = 5; cantidad > 0; cantidad--) {
      await page
        .locator('tr.ingredient-item', { hasText: 'Tomate stepper' })
        .locator('[data-test^="pantry-stock-menos-"]')
        .click();
      if (cantidad > 1) {
        await expect(
          page.locator('tr.ingredient-item', { hasText: 'Tomate stepper' })
        ).toContainText(`${cantidad - 1} g`);
      }
    }
    await expect(
      tabla(page).locator('tr.ingredient-item', { hasText: 'Tomate stepper' })
    ).toHaveCount(0);
  });

  test('en movil, el orden y el filtro viven en la hoja inferior', async ({ page }, testInfo) => {
    // La otra cara del cabezal (## 12ab): por debajo de 720 no hay th que pulsar, y el panel entero se
    // convoca desde la barra movil. El spec de la tabla se prueba aqui porque es esta pantalla la que la
    // monta; los detalles del panel, en la propia spec de la tabla.
    test.skip(
      testInfo.project.name === 'chromium',
      'la hoja es el reflujo de movil: en cabecera no hay boton que abrir'
    );
    await darAlta(page, { nombre: 'Tomate', cantidad: '500' }); // g
    await darAlta(page, { nombre: 'Leche', cantidad: '2', unidad: 'l' });

    await tabla(page).locator('[data-test="tabla-hoja-abrir"]').click();
    await expect(page.locator('[data-test="tabla-hoja"]')).toBeVisible();

    // primero el orden, desde la lista de columnas de la hoja
    await page.locator('[data-test="hoja-orden-name"]').click();
    await expect(filasPrimera(page)).toContainText('Leche');

    // y el filtro: la hoja encaja el mismo panel del cabezal, sin copias
    await page.locator('[data-test="hoja-filtro-unit"]').click();
    const menuUnidad = page.locator('.hoja__cuerpo .menu');
    await menuUnidad.locator('[data-test="tabla-menu-nada"]').click();
    await menuUnidad.getByRole('checkbox', { name: 'l', exact: true }).click();
    await page.locator('[data-test="hoja-volver"]').click();
    await page.locator('[data-test="hoja-cerrar"]').click();

    await expect(tabla(page).locator('tr.ingredient-item')).toHaveCount(1);
    await expect(fila(page, 'Leche')).toHaveCount(1);
  });

  test('la tabla cruza el limite movil/escritorio sin overflow en formatos estrechos y apaisados', async ({
    page
  }, testInfo) => {
    await darAlta(page, { nombre: 'Tomate responsive', cantidad: '500' });

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 719, height: 800 },
      { width: 720, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);

      const hojaAbrir = tabla(page).locator('[data-test="tabla-hoja-abrir"]');
      if (viewport.width < 720) {
        await expect(hojaAbrir).toBeVisible();
        await expect(hojaAbrir).toHaveAccessibleName('Ordenar y filtrar');
        await expect(tabla(page).locator('[data-test="tabla-filtro-name"]:visible')).toHaveCount(0);
        await expect(tabla(page).locator('thead')).toBeHidden();
        if (testInfo.project.name === 'mobile-chrome') {
          await hojaAbrir.tap();
        } else {
          await hojaAbrir.focus();
          await page.keyboard.press('Enter');
        }
        await expect(page.getByRole('dialog', { name: 'Ordenar y filtrar' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-test="tabla-hoja"]')).toHaveCount(0);
      } else {
        await expect(hojaAbrir).toBeHidden();
        await expect(tabla(page).locator('[data-test="tabla-filtro-name"]:visible')).toHaveCount(1);
        await expect(tabla(page).locator('thead')).toBeVisible();
      }
    }
  });

  test('las sugerencias viven en un expand cerrado; al abrirlo, el chip prellena el alta', async ({
    page
  }) => {
    await expect(page.locator('.suggestions__title')).toContainText('Sugerencias comunes');
    await expect(page.locator('.suggestions .chip')).toHaveCount(0); // cerrado por defecto (## 12ab)

    const toggle = page.locator('[data-test="pantry-sugerencias-toggle"]');
    await expect(toggle).toContainText('sin existencias');
    await toggle.click();

    // El seed del hogar siembra el catalogo entero a cero: decenas de chips ahora visibles
    const chips = page.locator('.suggestions .chip');
    expect(await chips.count()).toBeGreaterThan(50);

    const chip = chips.first();
    const chipNombre = (await chip.locator('.chip__name').textContent())!.trim();
    await chip.click();

    await expect(page.locator('.modal__title')).toContainText('Agregar Ingrediente');
    await expect(page.locator('input#ingredientName')).toHaveValue(chipNombre);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); // sigue abierta: nadie la cerro
  });

  test('paginar: el tamano corta y las flechas mueven la ventana de filas', async ({
    page
  }, testInfo) => {
    // Once filas con nombre numerado: a 10 por pagina, la onceava vive en la pagina 2
    for (let i = 1; i <= 11; i++) {
      await darAlta(page, { nombre: `Fila ${String(i).padStart(2, '0')}`, cantidad: String(i) });
    }
    await ponTamano(tabla(page), 10);

    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('1-10 de 11');
    await expect(tabla(page).locator('[data-test="tabla-pagina"]')).toContainText('Página 1 de 2');
    await expect(tabla(page).locator('[data-test="tabla-anterior"]')).toBeDisabled();
    // El paginador nuevo (## 12ad): las dos paginas salen como botones y la actual lleva aria-current. Por
    // debajo de 640px la hilera se pliega (regla D): quedan flechas y contador; lo propio de la hilera, aqui.
    const esMovil = testInfo.project.name !== 'chromium';
    if (!esMovil)
      await expect(tabla(page).locator('[data-test="tabla-pagina-1"]')).toHaveAttribute(
        'aria-current',
        'true'
      );

    await tabla(page).locator('[data-test="tabla-siguiente"]').click();
    // El orden por defecto es el del server (llega por creacion), asi que la pagina 2 se comprueba por su
    // tamano y su rango, no por cual de las once filas es: la tabla es la que corta, no la pantalla.
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('11-11 de 11');
    await expect(tabla(page).locator('tr.ingredient-item')).toHaveCount(1);
    await expect(tabla(page).locator('tr.ingredient-item').first()).toContainText('Fila ');
    await expect(tabla(page).locator('[data-test="tabla-siguiente"]')).toBeDisabled();

    // Saltar por numero: con dos paginas en pantalla, el boton «1» lleva de vuelta y deja de estar activo.
    if (esMovil) {
      await expect(tabla(page).locator('[data-test="tabla-pagina-1"]')).toBeHidden(); // plegado por diseno (D)
      await tabla(page).locator('[data-test="tabla-anterior"]').click();
    } else {
      await tabla(page).locator('[data-test="tabla-pagina-1"]').click();
      await expect(tabla(page).locator('[data-test="tabla-pagina-1"]')).toHaveAttribute(
        'aria-current',
        'true'
      );
    }
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('1-10 de 11');

    // Re-ancla (## 12ad): en la pagina 2, pasar a 50 por pagina devuelve a la 1 (la onceava fila viaja ahi).
    await tabla(page).locator('[data-test="tabla-siguiente"]').click();
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('11-11 de 11');
    await ponTamano(tabla(page), 50);
    await expect(tabla(page).locator('[data-test="tabla-pagina"]')).toContainText('Página 1 de 1');

    // Shift+click = tramo estilo Windows, inclusivo y reemplazando: de la 1 a la 4, cuatro filas (## 12ad).
    await ponTamano(tabla(page), 10);
    const casillas = tabla(page).locator(
      'tr.tabla__fila [data-test^="tabla-marcar-"] button[role="checkbox"]'
    );
    await casillas.nth(0).click();
    await expect(page.locator('[data-test="pantry-lote"]')).toContainText('1 seleccionado');
    await casillas.nth(3).click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-test="pantry-lote"]')).toContainText('4 seleccionados');
    await page.locator('[data-test="pantry-lote-anular"]').click();
    await expect(page.locator('[data-test="pantry-lote"]')).toHaveCount(0);
  });
});
