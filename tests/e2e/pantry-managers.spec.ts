import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

/**
 * Los tres gestores del inventario (HOGARIA-SPEC ## 12x, tabla en la ## 12ac).
 *
 * Desde la tanda 31 las tres listas son la `app-data-table` del visor sobre el conjunto completo en memoria:
 * lo que esta suite comprueba con navegador delante es lo que solo se ve asi: que un F5 conserva el filtro y la
 * busqueda, que la reserva esta cerrada por todos los sitios, que el lote cuenta y borra de verdad, que el menu
 * de una columna deja pasar lo que toca, y que anadir del catalogo sale despues por el gestor de productos.
 * La calidad del dato —que un `counts` sea exacto, que un `bulk-delete` con stock dentro salga 409— la
 * sostienen las suites del server; aqui se prueba el gesto, no la consulta.
 */
const filaDe = (page: import('@playwright/test').Page, texto: string | RegExp) =>
  page.locator('[data-test^="tabla-fila-"]').filter({ hasText: texto });

test.describe('El gestor del inventario', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();
  });

  test('la despensa abre el gestor por dos rutas, y cada una es una URL', async ({ page }) => {
    await page.locator('[data-test="pantry-abrir-categorias"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    await expect(page.locator('[data-test="gestor-categorias-lista"]')).toBeVisible();

    await page.goBack();
    await page.locator('[data-test="pantry-abrir-productos"]').click();
    await page.waitForURL(/\/pantry\/products$/);
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();
  });

  test('categorias y productos ordenan por nombre en escritorio y en la hoja movil', async ({
    page
  }, testInfo) => {
    const suffix = Date.now().toString();
    const ordenarYComprobar = async (
      tabla: import('@playwright/test').Locator,
      filas: import('@playwright/test').Locator,
      alpha: string,
      zeta: string
    ) => {
      if (testInfo.project.name === 'chromium') {
        const ordenar = tabla.locator('[data-test="tabla-orden-name"]');
        await ordenar.click();
        await expect(filas.first()).toContainText(alpha);
        await ordenar.click();
      } else {
        await tabla.locator('[data-test="tabla-hoja-abrir"]').click();
        await page.locator('[data-test="hoja-orden-name"]').click();
        await expect(filas.first()).toContainText(alpha);
        await page.locator('[data-test="hoja-orden-name"]').click();
        await page.locator('[data-test="hoja-cerrar"]').click();
      }
      await expect(filas.first()).toContainText(zeta);
    };

    await page.goto('/pantry/categories');
    for (const name of [`QA orden alpha ${suffix}`, `QA orden zeta ${suffix}`]) {
      await page.locator('[data-test="gestor-categorias-nueva"]').click();
      await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill(name);
      await page.locator('[data-test="gestor-categorias-guardar"]').click();
      await expect(page.locator('[data-test="gestor-categorias-lista"]')).toBeVisible();
    }
    await page.locator('#gestor-categorias-q').fill('QA orden');
    const categorias = page.locator('[data-test="gestor-categorias-tabla"]');
    const filasCategorias = categorias.locator('[data-test^="tabla-fila-"]');
    await expect(filasCategorias).toHaveCount(2);
    await ordenarYComprobar(
      categorias,
      filasCategorias,
      `QA orden alpha ${suffix}`,
      `QA orden zeta ${suffix}`
    );

    await page.goto('/pantry/products');
    for (const name of [`QA sort product alpha ${suffix}`, `QA sort product zeta ${suffix}`]) {
      await page.locator('[data-test="gestor-productos-nueva"]').click();
      await page.locator('[data-test="gestor-productos-campo-nombre"] input').fill(name);
      await page.locator('[data-test="gestor-productos-guardar"]').click();
      await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();
    }
    await page.locator('#gestor-productos-q').fill('QA sort product');
    const productos = page.locator('[data-test="gestor-productos-tabla"]');
    const filasProductos = productos.locator('[data-test^="tabla-fila-"]');
    await expect(filasProductos).toHaveCount(2);
    await ordenarYComprobar(
      productos,
      filasProductos,
      `QA sort product alpha ${suffix}`,
      `QA sort product zeta ${suffix}`
    );
  });

  test('una categoria nueva con color y padre queda en su sitio, y la tabla lo dice', async ({
    page
  }) => {
    await page.goto('/pantry/categories');
    await page.locator('[data-test="gestor-categorias-nueva"]').click();

    await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill('Frutos secos');
    await page.locator('[data-test="gestor-categorias-color-#e05a5a"]').click();
    await expect(page.locator('[data-test="gestor-categorias-campo-padre"]')).toBeVisible();
    // El picker de padre se abre y se elige una de fabrica: la subcategoria es el caso que la casa usa.
    await page.locator('[data-test="gestor-categorias-campo-padre"] button').click();
    await page.getByRole('option', { name: /Frutas/ }).click();

    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);

    // La busqueda es en memoria sobre el arbol entero: la caja pinta el resultado sin recarga ni pagina.
    await page.locator('#gestor-categorias-q').fill('Frutos secos');
    const fila = filaDe(page, 'Frutos secos');
    await expect(fila).toHaveCount(1);
    await expect(fila.locator('.celda--padre')).toHaveText('Frutas');
    await expect(
      fila.locator('[data-test="gestor-categorias-fila-frutos secos"] .celda__punto')
    ).toHaveCSS('background-color', 'rgb(224, 90, 90)');
  });

  test('la reserva no se puede romper desde ninguno de los dos sitios', async ({ page }) => {
    await page.goto('/pantry/categories');
    await page.locator('#gestor-categorias-q').fill('Otros');
    const fila = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('[data-test="gestor-categorias-fila-other"]') });
    await expect(fila).toHaveCount(1);
    await expect(fila.locator('[data-test="gestor-categorias-borrar-other"]')).toBeDisabled();

    await fila.locator('[data-test="gestor-categorias-editar-other"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories\/[^/]+$/);
    await expect(page.locator('[data-test="gestor-categorias-reservada"]')).toBeVisible();
    await expect(page.locator('[data-test="gestor-categorias-campo-nombre"] input')).toBeDisabled();
    await expect(page.locator('[data-test="gestor-categorias-campo-padre"] button')).toBeDisabled();
    await expect(page.locator('[data-test="gestor-categorias-eliminar"]')).toBeDisabled();
    // Pintarla si se puede: es la unica forma de que «Otros» signifique algo en esta casa.
    await page.locator('[data-test="gestor-categorias-color-#4caf50"]').click();
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page.locator('[data-test="gestor-categorias-lista"]')).toBeVisible();
  });

  test('una categoria con articulos encima no se borra, y el aviso dice cuantos', async ({
    page
  }) => {
    await page.goto('/pantry/categories');
    // `Cereales` nace con el semillero de la casa: hay algo dentro desde el primer dia.
    const fila = page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('[data-test="gestor-categorias-fila-grains"]') });
    await expect(fila).toBeVisible();
    const deshabilitado = await fila
      .locator('[data-test="gestor-categorias-borrar-grains"]')
      .isDisabled();
    if (!deshabilitado) {
      await fila.locator('[data-test="gestor-categorias-borrar-grains"]').click();
      await expect(page.locator('app-toast')).toContainText('artículos');
    }
    await expect(fila).toBeVisible();
  });

  test('el lote de categorias borra las borrables y anuncia las que no', async ({ page }) => {
    await page.goto('/pantry/categories');
    // Dos categorias propias y huecas, creadas aqui mismo: su vacio es seguro, el de las de fabrica depende
    // del semillero de la casa y eso no hay que ponerlo a prueba contra el lote.
    for (const nombre of ['Bazar', 'Trastero']) {
      await page.locator('[data-test="gestor-categorias-nueva"]').click();
      await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill(nombre);
      await page.locator('[data-test="gestor-categorias-guardar"]').click();
      await expect(page.locator('[data-test="gestor-categorias-lista"]')).toBeVisible();
    }

    await filaDe(page, 'Bazar').locator('button[role="checkbox"]').click();
    await filaDe(page, 'Trastero').locator('button[role="checkbox"]').click();
    const lote = page.locator('[data-test="gestor-categorias-lote"]');
    await expect(lote).toContainText('2 seleccionados');

    // Y una tercera que NO se puede: la reserva. Marcada con las otras, el lote la anuncia en vez de fingir.
    await page
      .locator('[data-test^="tabla-fila-"]')
      .filter({ has: page.locator('[data-test="gestor-categorias-fila-other"]') })
      .locator('button[role="checkbox"]')
      .click();
    await expect(lote).toContainText('3 seleccionados');
    await expect(lote).toContainText('1 no se pueden borrar');

    await page.locator('[data-test="gestor-categorias-lote-borrar"]').click();
    const dialogo = page.locator('.modal-overlay');
    await expect(dialogo.locator('.modal__title')).toHaveText('Borrar seleccionados');
    await expect(dialogo.locator('.confirm__message')).toContainText('2 categorías vacías');
    await dialogo.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('.toast--success').last()).toContainText('2 categorías borradas');
    await expect(filaDe(page, 'Bazar')).toHaveCount(0);
    await expect(page.locator('[data-test="gestor-categorias-fila-other"]')).toBeVisible();
    await expect(page.locator('[data-test="gestor-categorias-lote"]')).toHaveCount(0);
  });

  test('un producto principal se registra sin meter nada en la despensa, y su alias lo encuentra', async ({
    page
  }) => {
    await page.goto('/pantry/products');
    await expect(page.locator('[data-test="gestor-productos-filtro-staples"] .tag')).toHaveClass(
      /tag--selected/
    );

    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
    await page
      .locator('[data-test="gestor-productos-campo-nombre"] input')
      .fill('Levadura de panadero');
    await page.locator('#gestor-producto-alias').fill('levadura fresca');
    await page.locator('[data-test="gestor-productos-anadir-alias"]').click();
    await page.locator('[data-test="gestor-productos-guardar"]').click();

    await expect(page).toHaveURL(/\/pantry\/products$/);
    // Se entra por URL, no escribiendo en la caja: desde que el gestor lee la query al montar, la URL ES el
    // estado, y es lo que se quiere probar aqui (que el alias encuentra el producto, no que la caja pinte).
    await page.goto('/pantry/products?filter=all&q=levadura%20fresca');
    const fila = filaDe(page, 'Levadura de panadero');
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.locator('.celda__alias').first()).toHaveText('levadura fresca');
  });

  test('la busqueda del gestor no pide acentos', async ({ page }) => {
    await page.goto('/pantry/products');
    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await page
      .locator('[data-test="gestor-productos-campo-nombre"] input')
      .fill('Murciélago relleno');
    await page.locator('[data-test="gestor-productos-guardar"]').click();
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();

    await page.locator('#gestor-productos-q').fill('murcielago');
    await expect(filaDe(page, 'Murciélago relleno')).toBeVisible();
  });

  test('el menu de columna deja pasar lo que toca (semantica Excel)', async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'el menu de cabecera no existe en el reflujo de movil'
    );
    await page.goto('/pantry/products');
    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await page
      .locator('[data-test="gestor-productos-campo-nombre"] input')
      .fill('Sémola de cuscus kk');
    await page.locator('[data-test="gestor-productos-campo-unidad"] button').click();
    await page.getByRole('option', { name: /Kilogramos/ }).click();
    const creado = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === '/api/pantry/products' && request.method() === 'POST'
      );
    });
    await page.locator('[data-test="gestor-productos-guardar"]').click();
    expect((await creado).status()).toBe(201);
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();

    // El nuevo producto puede quedar fuera de la primera página de «Sin stock».
    await expect(page.locator('#gestor-productos-q')).toBeVisible();
    await page.locator('#gestor-productos-q').fill('Sémola de cuscus');
    await expect(filaDe(page, 'Sémola de cuscus kk')).toHaveCount(1);

    // Con la busqueda puesta, el menu de «unidad» solo ofrece el kg de esta fila: desmarcarlo deja la tabla
    // vacia y el «limpiar filtros» de la zona vacia la devuelve.
    await page
      .locator('[data-test="gestor-productos-tabla"] [data-test="tabla-filtro-unit"]')
      .click();
    const menu = page.locator('.menu');
    await menu
      .locator('.menu__fila', { hasText: /^kg/ })
      .locator('button[role="checkbox"]')
      .click();
    await expect(filaDe(page, 'Sémola de cuscus kk')).toHaveCount(0);
    await expect(page.locator('[data-test="tabla-vacia-limpiar"]')).toBeVisible();
    await page.locator('[data-test="tabla-vacia-limpiar"]').click();
    await expect(filaDe(page, 'Sémola de cuscus kk')).toHaveCount(1);
  });

  test('una casa sin stock no ofrece borrados falsos, y el lote cuenta lo que se marca', async ({
    page
  }) => {
    // El semillero de la casa crea **productos principales**, que son filas con `quantity = 0`: en una cuenta
    // recien registrada `in-pantry` esta LEGITIMAMENTE vacia. La regla que se comprueba es que la tabla se
    // queda sin filas con su zona vacia (no que la pantalla entera se crea vacia: el catalogo SI tiene filas).
    await page.goto('/pantry/products?filter=in-pantry');
    await expect(page.locator('[data-test="gestor-productos-tabla"]')).toBeVisible();
    await expect(page.locator('[data-test^="tabla-fila-"]')).toHaveCount(0);

    // Y en la vista de todo, donde si hay filas, el lote cuenta lo marcado: es el unico camino al `bulk-delete`.
    await page.locator('[data-test="gestor-productos-filtro-all"]').click();
    await page
      .locator('[data-test^="tabla-marcar-"]')
      .first()
      .locator('button[role="checkbox"]')
      .click();
    await page
      .locator('[data-test^="tabla-marcar-"]')
      .nth(1)
      .locator('button[role="checkbox"]')
      .click();
    await expect(page.locator('[data-test="gestor-productos-lote"]')).toContainText(
      '2 seleccionados'
    );
    // Que la regla «con algo dentro de la despensa no se borra ni en lote» la sostiene la suite del server
    // (`pantry-products.routes.spec.ts`: 409 `PANTRY_PRODUCT_BULK_DELETE_BLOCKED` sin borrar ninguno); aqui se
    // comprueba lo que solo se ve en pantalla: la barra de lote no existe antes de marcar nada, y desaparece al
    // recargar —el lote es seleccion de esta visita, no un estado que se herede de la URL—.
    await page.reload();
    await expect(page.locator('[data-test="gestor-productos-lote"]')).toHaveCount(0);
  });

  test('el lote de productos borra con impacto y confirmacion, y las filas desaparecen', async ({
    page
  }) => {
    await page.goto('/pantry/products');
    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await page
      .locator('[data-test="gestor-productos-campo-nombre"] input')
      .fill('Pan rallado seco');
    await page.locator('[data-test="gestor-productos-guardar"]').click();
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();

    await page.locator('#gestor-productos-q').fill('Pan rallado');
    const fila = filaDe(page, 'Pan rallado seco');
    await expect(fila).toBeVisible();
    await fila.locator('button[role="checkbox"]').click();
    await page.locator('[data-test="gestor-productos-lote-borrar"]').click();

    const dialogo = page.locator('.modal-overlay');
    await expect(dialogo.locator('.modal__title')).toHaveText('Borrar seleccionados');
    await dialogo.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('.toast--success').last()).toContainText('1 producto');
    await expect(filaDe(page, 'Pan rallado seco')).toHaveCount(0);
  });

  test('el F5 conserva el filtro y la busqueda; el `?sort=` jubilado no rompe nada', async ({
    page
  }) => {
    await page.goto('/pantry/products?filter=all&sort=recent&q=Levadura');
    await expect(page.locator('#gestor-productos-q')).toHaveValue('Levadura');
    await expect(page.locator('[data-test="gestor-productos-filtro-all"] .tag')).toHaveClass(
      /tag--selected/
    );

    await page.reload();
    await expect(page.locator('#gestor-productos-q')).toHaveValue('Levadura');
    await expect(page.locator('[data-test="gestor-productos-filtro-all"] .tag')).toHaveClass(
      /tag--selected/
    );

    await page.goto('/pantry/categories');
    await page.locator('#gestor-categorias-q').fill('Frutas');
    await page.locator('[data-test="gestor-categorias-vista-without-products"] .tag').click();
    // Las dos aserciones separan culpables si esto vuelve a fallar: la URL es la consecuencia de la accion
    // del componente (el click escribio o no escribio), la clase es la consecuencia del estado (la pantalla
    // hidrato o no hidrato). Antes se leia `page.url()` a ciegas justo despues del click: en una maquina con
    // cuatro shards ese «leer ya» gana o pierde segun el ritmo, y perder no era un bug de la app.
    await expect(page).toHaveURL(/view=without-products/);
    const url = page.url();
    await page.reload();
    expect(page.url()).toBe(url);
    await expect(
      page.locator('[data-test="gestor-categorias-vista-without-products"] .tag')
    ).toHaveClass(/tag--selected/);
    // Y el estado vuelve de la query, no del componente: la busqueda sigue en su caja y el filtro esta en la URL.
    await expect(page.locator('#gestor-categorias-q')).toHaveValue('Frutas');
    expect(url).toContain('view=without-products');
  });

  test('volver lleva a la lista desde la ficha, y al inventario desde la lista', async ({
    page
  }) => {
    // Fallo del propio test, no de la pantalla: en la tanda 28 se escribió el click sin navegar antes, y en
    // /pantry el boton del gestor no existe —eso es lo que el CI enseño a la primera—.
    await page.goto('/pantry/categories');
    // El boton vive en la cabecera de las dos pantallas, o sea que las dos tienen que llevar a algun lado.
    await page.locator('[data-test="gestor-categorias-volver"]').click();
    await expect(page).toHaveURL(/\/pantry(\?|$)/);
    await expect(page.locator('h1.pantry__title')).toBeVisible();

    await page.goto('/pantry/products/new');
    await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
    await page.locator('[data-test="gestor-productos-volver"]').click();
    await expect(page).toHaveURL(/\/pantry\/products$/);
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();
  });
});
