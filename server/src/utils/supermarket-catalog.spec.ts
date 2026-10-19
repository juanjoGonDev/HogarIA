import { describe, expect, it } from 'vitest';

/**
 * El pre-registro de la ## 12aa: el catálogo de supermercado que la casa no tiene que escribir.
 *
 * Este test es la razón por la que el catálogo puede vivir en un módulo y no en una tabla: el dato es de
 * fábrica, así que lo que hay que vigilar no es la integridad referencial sino las INVARIANTES del fichero.
 * Si alguien añade una hoja sin padre, un producto colgado de un padre, una unidad fuera del vocabulario o
 * dos filas con el mismo id, esto falla antes de que nadie lo vea en pantalla. Y el «inmensa mayoría» del
 * usuario tiene que ser un número: si no, la próxima tanda lo baja a treinta en silencio.
 */

const UNIDADES_VALIDAS = new Set(['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'unit', 'bunch', 'slice', 'piece']);

describe('catalogo de supermercado (## 12aa)', () => {
  it('trae una inmensa mayoría de productos: 340 como minimo', async () => {
    const { CATALOGO_PRODUCTOS } = await import('./supermarket-catalog.js');
    expect(CATALOGO_PRODUCTOS.length).toBeGreaterThanOrEqual(340);
  });

  it('tiene seis padres, y cada hoja cuelga de un padre que existe', async () => {
    const { CATALOGO_CATEGORIAS, PARENT_KEYS } = await import('./supermarket-catalog.js');
    const padres = CATALOGO_CATEGORIAS.filter((cat) => !cat.parent);
    expect(padres.map((cat) => cat.key).sort()).toEqual(
      ['alimentos', 'bebe', 'hogar', 'higiene', 'limpieza', 'mascotas'].sort()
    );
    for (const cat of CATALOGO_CATEGORIAS) {
      if (cat.parent) expect(PARENT_KEYS.has(cat.parent), `${cat.key} cuelga de ${cat.parent}`).toBe(true);
    }
    // Los padres no son hojas, y las claves no se repiten: 'alimentos' padre no puede convivir con una hoja homonima.
    expect(new Set(CATALOGO_CATEGORIAS.map((cat) => cat.key)).size).toBe(CATALOGO_CATEGORIAS.length);
    const hojas = CATALOGO_CATEGORIAS.filter((cat) => cat.parent);
    expect(hojas.length).toBeGreaterThanOrEqual(32);
  });

  it('ningun producto cuelga de un padre, y ninguna hoja esta vacia (minimo 8)', async () => {
    const { CATALOGO_PRODUCTOS, CATALOGO_CATEGORIAS, esHoja, conteoPorHoja } = await import('./supermarket-catalog.js');
    for (const producto of CATALOGO_PRODUCTOS) {
      expect(CATALOGO_CATEGORIAS.some((cat) => cat.key === producto.category)).toBe(true);
      expect(esHoja(producto.category)).toBe(true);
    }
    const conteos = conteoPorHoja();
    for (const [hoja, n] of conteos) expect(n, `la hoja ${hoja} tiene ${n}`).toBeGreaterThanOrEqual(8);
  });

  it('las once claves de comida coinciden con las categorias de fabrica de la casa', async () => {
    const { CATALOGO_CATEGORIAS } = await import('./supermarket-catalog.js');
    const { DEFAULT_PANTRY_CATEGORIES } = await import('./pantry-categories.js');
    const claves = new Set(CATALOGO_CATEGORIAS.map((cat) => cat.key));
    for (const semilla of DEFAULT_PANTRY_CATEGORIES) {
      // 'other' es la reserva de la casa: el catalogo nunca la usa porque un producto del super siempre
      // tiene pasillo, y 'alimentos' es el padre que la casa SI conoce desde esta tanda.
      if (semilla.key === 'other') continue;
      expect(claves.has(semilla.key), `la clave ${semilla.key} debe existir en el catalogo`).toBe(true);
    }
  });

  it('unidades dentro del vocabulario, nombres limpios y unicos', async () => {
    const { CATALOGO_PRODUCTOS } = await import('./supermarket-catalog.js');
    const nombres = new Map<string, string>();
    for (const producto of CATALOGO_PRODUCTOS) {
      expect(UNIDADES_VALIDAS.has(producto.unit), `${producto.name} con unidad ${producto.unit}`).toBe(true);
      expect(producto.name.length).toBeGreaterThan(0);
      expect(producto.name.length).toBeLessThanOrEqual(100);
      expect(producto.name).toBe(producto.name.trim());
      expect(producto.name).not.toMatch(/\s{2,}/);
      const clave = producto.name.toLowerCase();
      expect(nombres.has(clave), `duplicado: ${producto.name} y ${nombres.get(clave)}`).toBe(false);
      nombres.set(clave, producto.name);
    }
  });

  it('los ids son `hoja:indice`, unicos y estables dentro de la hoja', async () => {
    const { CATALOGO_PRODUCTOS } = await import('./supermarket-catalog.js');
    const vistos = new Set<string>();
    const porHoja = new Map<string, number>();
    for (const producto of CATALOGO_PRODUCTOS) {
      expect(vistos.has(producto.id), `id duplicado ${producto.id}`).toBe(false);
      vistos.add(producto.id);
      const esperado = `${producto.category}:${porHoja.get(producto.category) ?? 0}`;
      expect(producto.id, `esperaba ${esperado}`).toBe(esperado);
      porHoja.set(producto.category, (porHoja.get(producto.category) ?? 0) + 1);
    }
  });

  it('los colores pasan el mismo filtro que los de la casa', async () => {
    const { CATALOGO_CATEGORIAS } = await import('./supermarket-catalog.js');
    for (const cat of CATALOGO_CATEGORIAS) expect(cat.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  describe('buscarProductos', () => {
    it('busca sin acentos y sin distinguir mayusculas', async () => {
      const { buscarProductos, normalizarBusqueda } = await import('./supermarket-catalog.js');
      const sinAcento = buscarProductos({ q: 'limon', limit: 50, offset: 0 });
      const conAcento = buscarProductos({ q: 'Limón', limit: 50, offset: 0 });
      expect(sinAcento.total).toBe(conAcento.total);
      expect(sinAcento.total).toBeGreaterThan(0);
      // La asercion tiene que estar normalizada como la busqueda: «Limón».toLowerCase() no contiene 'limon'.
      expect(sinAcento.productos.every((p: any) => normalizarBusqueda(p.name).includes('limon'))).toBe(true);
    });

    it('filtrar por padre devuelve todo el subarbol; por hoja, solo la hoja', async () => {
      const { buscarProductos, CATALOGO_PRODUCTOS } = await import('./supermarket-catalog.js');
      const alimentos = buscarProductos({ category: 'alimentos', limit: 1000, offset: 0 });
      const esperado = CATALOGO_PRODUCTOS.length - buscarProductos({ category: 'limpieza', limit: 1000, offset: 0 }).total
        - buscarProductos({ category: 'higiene', limit: 1000, offset: 0 }).total
        - buscarProductos({ category: 'hogar', limit: 1000, offset: 0 }).total
        - buscarProductos({ category: 'mascotas', limit: 1000, offset: 0 }).total
        - buscarProductos({ category: 'bebe', limit: 1000, offset: 0 }).total;
      expect(alimentos.total).toBe(esperado);
      const verduras = buscarProductos({ category: 'vegetables', limit: 1000, offset: 0 });
      expect(verduras.total).toBeLessThan(alimentos.total);
      expect(verduras.productos.every((p: any) => p.category === 'vegetables')).toBe(true);
    });

    it('ordena por hoja y nombre, y pagina con total/offset', async () => {
      const { buscarProductos } = await import('./supermarket-catalog.js');
      const primera = buscarProductos({ limit: 10, offset: 0 });
      expect(primera.productos.length).toBe(10);
      const nombres = primera.productos.map((p: any) => p.name);
      expect([...nombres].sort((a, b) => a.localeCompare(b, 'es'))).toEqual(nombres);
      const segunda = buscarProductos({ limit: 10, offset: 10 });
      expect(segunda.total).toBe(primera.total);
      expect(segunda.productos[0].id).not.toBe(primera.productos[0].id);
    });

    it('una busqueda sin resultados no es un error: es total 0', async () => {
      const { buscarProductos } = await import('./supermarket-catalog.js');
      const vacia = buscarProductos({ q: 'croquetavoladora-9000', limit: 24, offset: 0 });
      expect(vacia.total).toBe(0);
      expect(vacia.productos).toEqual([]);
    });

    it('una categoria inexistente devuelve vacio, no el catalogo entero', async () => {
      const { buscarProductos } = await import('./supermarket-catalog.js');
      expect(buscarProductos({ category: 'no-existe', limit: 24, offset: 0 }).total).toBe(0);
    });
  });

  it('productoPorId responde por id y ignora basura', async () => {
    const { productoPorId, CATALOGO_PRODUCTOS } = await import('./supermarket-catalog.js');
    const primero = CATALOGO_PRODUCTOS[0];
    expect(productoPorId(primero.id)).toBe(primero);
    expect(productoPorId('vegetables:99999')).toBeUndefined();
    expect(productoPorId('')).toBeUndefined();
  });
});
