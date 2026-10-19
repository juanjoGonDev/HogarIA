import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

/**
 * El visor del catálogo pre-registrado (HOGARIA-SPEC ## 12aa; tabla, lote y pasillo-picker en la ## 12ac).
 *
 * Lo que prueba no es la calidad del dato —eso vive en `supermarket-catalog.spec.ts` del server— sino la
 * promesa que la pantalla le hace a quien la usa desde que es la tabla del visor: que el catálogo se carga
 * ENTERO y la tabla pagea sola, que buscar sin acentos encuentra, que la fila se añade con un clic y pasa a
 * «en casa», que «añadir lo de la pantalla» manda las filas filtradas —no la página— y no duplica nada, y
 * que el pasillo, minimizado a picker, sigue filtrando el subárbol entero. El estado vive en la URL, y aqui
 * se comprueba entrando directo por ella.
 */
const filaDe = (page: import('@playwright/test').Page, texto: string | RegExp) =>
  page.locator('[data-test^="tabla-fila-"]').filter({ hasText: texto });

test.describe('El catálogo del supermercado', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
  });

  test('de la franja al catálogo: buscar, añadir, la fila pasa a «en casa», y el lote no duplica', async ({
    page
  }) => {
    await page.locator('[data-test="pantry-abrir-catalogo"]').click();
    await expect(page).toHaveURL(/\/pantry\/catalogo/);
    await expect(page.locator('h1')).toContainText('Catálogo del supermercado');

    // El conjunto completo, no la pagina de antes: el contador dice todos los productos, y la tabla corta 24.
    await expect(page.locator('[data-test="catalogo-resultados"]')).toContainText(
      /\d{3,} productos/
    );
    await expect(page.locator('[data-test^="tabla-fila-"]')).toHaveCount(24);

    await page.locator('#catalogo-q').fill('leche');
    await expect(page.locator('[data-test="catalogo-resultados"]')).toContainText('productos');

    // La primera fila con botón: el seed de la casa ya conoce alguna leche, y esas vienen marcadas en casa.
    const fila = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('.celda__accion') })
      .first();
    const nombre = (await fila.locator('.celda--nombre').innerText()).trim();
    await fila.locator('[data-test^="catalogo-anadir-"]').click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(nombre);
    await expect(filaDe(page, nombre).locator('[data-test="catalogo-en-casa"]')).toContainText(
      'En tu inventario'
    );

    // «Añadir lo de la pantalla» cuenta las filas del resultado (no la pagina ni el catalogo) y no duplica.
    await expect(page.locator('[data-test="catalogo-anadir-filtrados"]')).toBeEnabled();
    await page.locator('[data-test="catalogo-anadir-filtrados"]').click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'a tu inventario'
    );
    // Las filas de la pantalla pasan todas a «en casa»; puede quedar alguna que el server conto como saltada
    // por parecerse a un producto de la casa que no es esta ficha: el lote no duplica, y eso es lo que se prueba.
    await expect(page.locator('[data-test^="tabla-fila-"]').locator('.celda__accion')).toHaveCount(
      0
    );
    await expect(page.locator('[data-test="catalogo-anadir-filtrados"]')).toBeDisabled();

    await page.locator('[data-test="catalogo-volver"]').click();
    await expect(page).toHaveURL(/\/pantry$/);
    await expect(page.locator('h1.pantry__title')).toContainText('Inventario');
    // Y lo que se anadio es de la casa: sale en el inventario con su unidad.
    await expect(filaDe(page, nombre)).toBeVisible();
  });

  test('la paginacion mueve el catalogo completo entre paginas', async ({ page }) => {
    await page.goto('/pantry/catalogo');
    const tabla = page.locator('[data-test="catalogo-tabla"]');
    const filas = tabla.locator('[data-test^="tabla-fila-"]');
    const rango = tabla.locator('[data-test="tabla-rango"]');

    await expect(filas).toHaveCount(24);
    await expect(rango).toContainText('1-24 de');
    const primeraPagina = (await filas.first().innerText()).trim();

    await tabla.locator('[data-test="tabla-siguiente"]').click();
    await expect(rango).toContainText('25-48 de');
    await expect(filas).toHaveCount(24);
    expect((await filas.first().innerText()).trim()).not.toBe(primeraPagina);

    await tabla.locator('[data-test="tabla-anterior"]').click();
    await expect(rango).toContainText('1-24 de');
  });

  test('la seleccion multiple anade un lote sin confirmacion (no es destructivo)', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo?q=mantequilla');
    const conBoton = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('.celda__accion') });
    await expect(conBoton.first()).toBeVisible();
    await conBoton
      .first()
      .locator('[data-test^="tabla-marcar-"]')
      .locator('button[role="checkbox"]')
      .click();
    await expect(page.locator('[data-test="catalogo-lote"]')).toContainText('1 seleccionado');
    await page.locator('[data-test="catalogo-lote-anadir"]').click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'añadido a tu inventario'
    );
    await expect(page.locator('[data-test="catalogo-lote"]')).toHaveCount(0);
  });

  test('la query hidratada al montar: entrar directo por URL pinta el pasillo y la búsqueda', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo?q=aceite');
    await expect(page.locator('#catalogo-q')).toHaveValue('aceite');
    await expect(filaDe(page, 'Aceite de oliva virgen extra')).not.toHaveCount(0);

    await page.goto('/pantry/catalogo?cat=vegetables');
    await expect(page.locator('[data-test="catalogo-filtro-pasillo"] button')).toContainText(
      'Verduras'
    );
    await expect(filaDe(page, /./).first()).toBeVisible();

    // El padre filtra su subárbol desde memoria, y el contador es el del subárbol: 334 como firma el server.
    await page.goto('/pantry/catalogo?cat=alimentos');
    await expect(page.locator('[data-test="catalogo-resultados"]')).toContainText('334 productos');
  });

  test('el pasillo se elige y se quita con el picker, y la URL lo cuenta todo', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo');
    await page.locator('[data-test="catalogo-filtro-pasillo"] button').click();
    await page.getByRole('option', { name: /Verduras/ }).click();
    await expect(page).toHaveURL(/cat=vegetables/);
    const contador = (await page.locator('[data-test="catalogo-resultados"]').innerText()).trim();

    // Quitar el pasillo: la opcion «Todos» —el picker del visor, no un riel que se queda clavado—.
    await page.locator('[data-test="catalogo-filtro-pasillo"] button').click();
    await page.getByRole('option', { name: /Todos los pasillos/ }).click();
    await expect(page).not.toHaveURL(/cat=/);
    await expect(page.locator('[data-test="catalogo-resultados"]')).not.toHaveText(contador);

    // Y la busqueda viaja con el pasillo en la misma URL.
    await page.locator('#catalogo-q').fill('espinaca');
    await expect(page).toHaveURL(/q=espinaca/);
  });

  test('el lote también quita del inventario: borra las existencias de casa y respeta la ficha', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo?q=espinaca');
    const nueva = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('.celda__accion') })
      .first();
    const nombre = (await nueva.locator('.celda--nombre').innerText()).trim();
    await nueva.locator('.celda__accion').click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'añadido a tu inventario'
    );

    // Ahora la misma fila es de la casa: al marcarla, el lote ofrece «quitar del inventario» (## 12ad, regla G).
    await page.locator('#catalogo-q').fill(nombre);
    const enCasa = filaDe(page, nombre).first();
    await enCasa.locator('[data-test^="tabla-marcar-"]').locator('button[role="checkbox"]').click();
    await expect(page.locator('[data-test="catalogo-lote"]')).toContainText('1 seleccionado');
    const quitar = page.locator('[data-test="catalogo-lote-quitar"]');
    await expect(quitar).toContainText('Quitar 1 del inventario');

    await quitar.click();
    const dialogo = page.locator('.modal-overlay');
    await expect(dialogo.locator('.modal__title')).toContainText('¿Quitar del inventario?');
    await dialogo.getByRole('button', { name: 'Quitar del inventario' }).click();
    await expect(page.locator('.toast--success').last()).toContainText('1 articulos borrados');

    // La ficha sigue en el catálogo, ya sin marca de «en casa»: el botón de alta ha vuelto a su sitio.
    await expect(filaDe(page, nombre).locator('.celda__accion')).toHaveCount(1);

    // Y en el inventario de la casa ya no está.
    await page.goto('/pantry');
    await expect(
      page.locator('[data-test^="tabla-fila-"]').filter({ hasText: nombre })
    ).toHaveCount(0);
  });

  test('lo que el catálogo alta sale en el gestor de productos, con su padre en el de categorías', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo?q=levadura');
    await page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('.celda__accion') })
      .locator('.celda__accion')
      .first()
      .click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'Levadura química'
    );

    await page.goto('/pantry/products?filter=all&q=levadura');
    await expect(filaDe(page, 'Levadura química')).not.toHaveCount(0);

    await page.goto('/pantry/categories');
    await expect(page.locator('[data-test="gestor-categorias-fila-alimentos"]')).toContainText(
      'Alimentos'
    );
    // `Cereales` cuelga de `Alimentos`: el padre es una COLUMNA en la tabla, no un texto bajo el nombre.
    const granos = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('[data-test="gestor-categorias-fila-grains"]') });
    await expect(granos.locator('.celda--padre')).toHaveText('Alimentos');
  });

  test('las pistas del lote salen al instante (popover, no title) y el buscador respira por abajo', async ({
    page
  }) => {
    await page.goto('/pantry/catalogo?q=espinaca');

    // ## 12af C: padding continuo del slot — arriba y abajo igual, que la caja no quede pegada a la tabla.
    const holgura = await page
      .locator('.tabla__buscar')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { arriba: s.paddingTop, abajo: s.paddingBottom };
      });
    expect(parseFloat(holgura.abajo)).toBeGreaterThan(0);
    expect(holgura.abajo).toBe(holgura.arriba);

    // ## 12af B: el icono sin texto lleva popover propio, no el title nativo que tarda un segundo.
    await filaDe(page, /espinaca/i)
      .first()
      .locator('[data-test^="tabla-marcar-"]')
      .locator('button[role="checkbox"]')
      .click();
    const anular = page.locator('[data-test="catalogo-lote-anular"]');
    await expect(anular).toBeVisible();
    await expect(anular).not.toHaveAttribute('title');
    const burbuja = page.locator('app-tooltip:has([data-test="catalogo-lote-anular"]) .tooltip');
    await expect(burbuja).toHaveCSS('opacity', '0');
    await anular.hover();
    await expect(burbuja).toHaveCSS('opacity', '1');
    await expect(burbuja).toContainText('Anular seleccion');
  });
});
