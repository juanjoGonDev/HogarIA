/**
 * El spec de la logica de la tabla (HOGARIA-SPEC ## 12ab). Mismo patrón que `pantry-gestor.util.spec.ts`:
 * describe/it globales, porque son funciones puras sin Angular — si un dia la casa levanta un runner de
 * frontend que no sea el navegador, esto ya esta escrito para el.
 */

import {
  SIN_VALOR,
  coincideEnMenu,
  cuboDe,
  claveDeDia,
  direccionDe,
  hoyLocal,
  ordenar,
  paginar,
  posicionDeOrden,
  recortarFiltro,
  rotarOrden,
  sumarDias,
  valorTipado,
  valoresUnicos,
  pasarFiltros,
  filtroActivo
} from './data-table.util';
import type { FiltroColumna, OrdenTabla, TipoColumna } from './data-table.types';
import { reanclarPagina, tramoDeIndices, tramoDePaginas } from './data-table.util';

type Fila = Record<string, unknown>;
const leer = (fila: unknown, clave: string): unknown => (fila as Fila)[clave];
const tipoTexto = (): TipoColumna => 'texto';

const filas: Fila[] = [
  { nombre: 'Tomate', cantidad: 5, cat: 'verduras', caducidad: '2026-10-02', veg: true },
  { nombre: 'Lechuga', cantidad: 12, cat: 'verduras', caducidad: '2026-10-01', veg: true },
  { nombre: 'Manzana', cantidad: null, cat: 'frutas', caducidad: null, veg: false },
  { nombre: 'aceite', cantidad: 3, cat: 'otros', caducidad: '2027-01-15', veg: false }
];

describe('rotarOrden (el ciclo del encabezado, ## 12ab)', () => {
  it('clic suelto: ausente sube a asc, asc a desc, desc a empezar de nuevo por esa columna', () => {
    expect(rotarOrden([], 'nombre', false)).toEqual([{ clave: 'nombre', dir: 'asc' }]);
    expect(rotarOrden([{ clave: 'nombre', dir: 'asc' }], 'nombre', false)).toEqual([
      { clave: 'nombre', dir: 'desc' }
    ]);
    // El desc no puede «apagar» la tabla a clic suelto: la deja sola en asc, que es lo que hace Excel al
    // volver a picar la misma columna tras quitarla. Quedar sin orden con un clic seria perder el trabajo.
    expect(rotarOrden([{ clave: 'nombre', dir: 'desc' }], 'nombre', false)).toEqual([
      { clave: 'nombre', dir: 'asc' }
    ]);
  });

  it('Shift deja la columna sola si estaba primera del multi…', () => {
    const multi: OrdenTabla = [
      { clave: 'cat', dir: 'asc' },
      { clave: 'nombre', dir: 'desc' }
    ];
    expect(rotarOrden(multi, 'nombre', true)).toEqual([{ clave: 'cat', dir: 'asc' }]);
  });

  it('…y se anade al final si no estaba', () => {
    expect(rotarOrden([{ clave: 'cat', dir: 'asc' }], 'nombre', true)).toEqual([
      { clave: 'cat', dir: 'asc' },
      { clave: 'nombre', dir: 'asc' }
    ]);
    // El hueco que queda al quitar la unica clave con Shift se va a «sin orden» real: vacio.
    expect(rotarOrden([{ clave: 'cat', dir: 'desc' }], 'cat', true)).toEqual([]);
  });

  it('el clic suelto reemplaza el multi por esa columna sola', () => {
    expect(
      rotarOrden(
        [
          { clave: 'cat', dir: 'asc' },
          { clave: 'nombre', dir: 'desc' }
        ],
        'cantidad',
        false
      )
    ).toEqual([{ clave: 'cantidad', dir: 'asc' }]);
  });

  it('el clic suelto sobre una clave activa tambien deja solo esa columna', () => {
    expect(
      rotarOrden(
        [
          { clave: 'nombre', dir: 'asc' },
          { clave: 'cantidad', dir: 'asc' }
        ],
        'nombre',
        false
      )
    ).toEqual([{ clave: 'nombre', dir: 'desc' }]);
  });

  it('direccion y posicion para pintar el encabezado', () => {
    const multi: OrdenTabla = [
      { clave: 'cat', dir: 'asc' },
      { clave: 'nombre', dir: 'desc' }
    ];
    expect(direccionDe(multi, 'nombre')).toBe('desc');
    expect(direccionDe(multi, 'cantidad')).toBeNull();
    expect(posicionDeOrden(multi, 'nombre')).toBe(2);
    expect(posicionDeOrden([{ clave: 'cat', dir: 'asc' }], 'cat')).toBeNull(); // sola: el numero sobra
  });
});

describe('ordenar (multi-clave, con huecos al final)', () => {
  it('una clave de texto, ascendente, sin mayusculas en el camino', () => {
    const salida = ordenar(filas, [{ clave: 'nombre', dir: 'asc' }], leer, tipoTexto);
    expect(salida.map((f) => f['nombre'])).toEqual(['aceite', 'Lechuga', 'Manzana', 'Tomate']);
  });

  it('el hueco va al final en los dos sentidos', () => {
    const asc = ordenar(filas, [{ clave: 'cantidad', dir: 'asc' }], leer, () => 'numero');
    expect(asc.map((f) => f['cantidad'])).toEqual([3, 5, 12, null]);
    const desc = ordenar(filas, [{ clave: 'cantidad', dir: 'desc' }], leer, () => 'numero');
    expect(desc.map((f) => f['cantidad'])).toEqual([12, 5, 3, null]);
  });

  it('dos claves: la segunda desempata a la primera', () => {
    const salida = ordenar(
      filas,
      [
        { clave: 'cat', dir: 'asc' },
        { clave: 'cantidad', dir: 'desc' }
      ],
      leer,
      (clave) => (clave === 'cantidad' ? 'numero' : 'texto')
    );
    expect(salida.map((f) => `${f['cat']}/${f['cantidad']}`)).toEqual([
      'frutas/null',
      'otros/3',
      'verduras/12',
      'verduras/5'
    ]);
  });

  it('fecha: el dia manda, no el instante', () => {
    const salida = ordenar(filas, [{ clave: 'caducidad', dir: 'asc' }], leer, () => 'fecha');
    expect(salida.map((f) => f['caducidad'])).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2027-01-15',
      null
    ]);
  });

  it('booleano: falso antes que verdadero en asc', () => {
    const salida = ordenar(filas, [{ clave: 'veg', dir: 'asc' }], leer, () => 'booleano');
    expect(salida.map((f) => f['veg'])).toEqual([false, false, true, true]);
  });
});

describe('valoresUnicos (el menu de casillas)', () => {
  it('cuenta por valor, colacion es, y el hueco al final', () => {
    expect(valoresUnicos(filas, 'cat', leer, 'texto')).toEqual([
      { valor: 'frutas', cuenta: 1 },
      { valor: 'otros', cuenta: 1 },
      { valor: 'verduras', cuenta: 2 }
    ]);
    expect(valoresUnicos(filas, 'cantidad', leer, 'numero')).toEqual([
      { valor: '3', cuenta: 1 },
      { valor: '5', cuenta: 1 },
      { valor: '12', cuenta: 1 },
      { valor: SIN_VALOR, cuenta: 1 }
    ]);
  });

  it('los numeros del menu salen ordenados por valor, no por cadena', () => {
    const filasNumeros: Fila[] = [{ n: 100 }, { n: 9 }, { n: null }, { n: 20 }];
    expect(valoresUnicos(filasNumeros, 'n', leer, 'numero').map((v) => v.valor)).toEqual([
      '9',
      '20',
      '100',
      SIN_VALOR
    ]);
  });
});

describe('pasarFiltros (la intersección de columnas)', () => {
  const val = (activos: string[] | null): FiltroColumna => ({ tipo: 'valores', activos });

  it('casillas de texto: solo las seleccionadas; vacio real = nada', () => {
    expect(
      pasarFiltros(filas, [{ columna: 'cat', tipo: 'texto', filtro: val(['verduras']) }], leer)
        .length
    ).toBe(2);
    expect(
      pasarFiltros(filas, [{ columna: 'cat', tipo: 'texto', filtro: val([]) }], leer).length
    ).toBe(0);
    expect(
      pasarFiltros(filas, [{ columna: 'cat', tipo: 'texto', filtro: val(null) }], leer).length
    ).toBe(4);
  });

  it('el cubo SIN_VALOR es filtrable como un valor mas', () => {
    const salida = pasarFiltros(
      filas,
      [{ columna: 'cantidad', tipo: 'numero', filtro: val([SIN_VALOR]) }],
      leer
    );
    expect(salida.map((f) => f['nombre'])).toEqual(['Manzana']);
  });

  it('numero: mayor/menor/entre con un extremo o con los dos, e igual exacto', () => {
    expect(
      pasarFiltros(
        filas,
        [
          {
            columna: 'cantidad',
            tipo: 'numero',
            filtro: { tipo: 'numero', modo: 'mayor', a: 4, b: null }
          }
        ],
        leer
      ).map((f) => f['cantidad'])
    ).toEqual([5, 12]);
    expect(
      pasarFiltros(
        filas,
        [
          {
            columna: 'cantidad',
            tipo: 'numero',
            filtro: { tipo: 'numero', modo: 'entre', a: 4, b: 6 }
          }
        ],
        leer
      ).map((f) => f['cantidad'])
    ).toEqual([5]);
    expect(
      pasarFiltros(
        filas,
        [
          {
            columna: 'cantidad',
            tipo: 'numero',
            filtro: { tipo: 'numero', modo: 'entre', a: 12, b: null }
          }
        ],
        leer
      ).map((f) => f['cantidad'])
    ).toEqual([12]);
    // Sin ningun extremo escrito, el filtro no esta: «entre vacio» no es «cero filas», es «todavia no he dicho»
    expect(filtroActivo({ tipo: 'numero', modo: 'entre', a: null, b: null })).toBe(false);
  });

  it('fecha: hoy, siete dias y vencidos contra el mismo «hoy»', () => {
    const hoy = '2026-10-01';
    const conFecha: Fila[] = [
      { d: hoy },
      { d: '2026-10-05' },
      { d: '2026-10-09' },
      { d: '2026-09-30' }
    ];
    expect(
      pasarFiltros(
        conFecha,
        [{ columna: 'd', tipo: 'fecha', filtro: { tipo: 'fecha', modo: 'hoy', a: null, b: null } }],
        leer,
        hoy
      ).length
    ).toBe(1);
    expect(
      pasarFiltros(
        conFecha,
        [
          {
            columna: 'd',
            tipo: 'fecha',
            filtro: { tipo: 'fecha', modo: 'siete', a: null, b: null }
          }
        ],
        leer,
        hoy
      ).length
    ).toBe(2);
    expect(
      pasarFiltros(
        conFecha,
        [
          {
            columna: 'd',
            tipo: 'fecha',
            filtro: { tipo: 'fecha', modo: 'vencidos', a: null, b: null }
          }
        ],
        leer,
        hoy
      ).length
    ).toBe(1);
    expect(
      pasarFiltros(
        conFecha,
        [
          {
            columna: 'd',
            tipo: 'fecha',
            filtro: { tipo: 'fecha', modo: 'entre', a: '2026-10-02', b: '2026-10-06' }
          }
        ],
        leer,
        hoy
      ).map((f) => f['d'])
    ).toEqual(['2026-10-05']);
  });

  it('varias columnas: interseccion, no union', () => {
    const salida = pasarFiltros(
      filas,
      [
        { columna: 'cat', tipo: 'texto', filtro: val(['verduras', 'frutas']) },
        { columna: 'nombre', tipo: 'texto', filtro: val(['Tomate', 'Manzana']) }
      ],
      leer
    );
    expect(salida.map((f) => f['nombre'])).toEqual(['Tomate', 'Manzana']);
    const vacia = pasarFiltros(
      filas,
      [
        { columna: 'cat', tipo: 'texto', filtro: val(['frutas']) },
        { columna: 'nombre', tipo: 'texto', filtro: val(['Tomate']) }
      ],
      leer
    );
    expect(vacia.length).toBe(0);
  });
});

describe('recortarFiltro, filtroActivo y companeros menores', () => {
  it('recortar deja lo elegido; null se convierte en «nada marcado», no en «sin filtro»', () => {
    expect(recortarFiltro({ tipo: 'valores', activos: ['a', 'b'] })).toEqual({
      tipo: 'valores',
      activos: ['a', 'b']
    });
    // El «Recortar» sobre un filtro sin activar deja la seleccion VACIA (0 filas), que es leer la intencion:
    // «que se quede lo que veo marcado ahora mismo» —y ahora mismo no hay nada marcado, que equivale a todo.
    // El menu de Excel marca implicitamente todo al desactivar el filtro, asi que el componente nunca llama
    // a esto con `activos: null`; el util, por si acaso, toma la lectura literal.
    expect(recortarFiltro({ tipo: 'valores', activos: null })).toEqual({
      tipo: 'valores',
      activos: []
    });
  });

  it('filtroActivo dice lo que el embudo pinta', () => {
    expect(filtroActivo(undefined)).toBe(false);
    expect(filtroActivo({ tipo: 'valores', activos: null })).toBe(false);
    expect(filtroActivo({ tipo: 'valores', activos: [] })).toBe(true);
    expect(filtroActivo({ tipo: 'fecha', modo: 'hoy', a: null, b: null })).toBe(true);
    expect(filtroActivo({ tipo: 'numero', modo: 'mayor', a: null, b: null })).toBe(false);
  });

  it('cuboDe y valorTipado con las formas del hueco', () => {
    expect(cuboDe(null)).toBe(SIN_VALOR);
    expect(cuboDe('')).toBe(SIN_VALOR);
    expect(cuboDe(undefined)).toBe(SIN_VALOR);
    expect(cuboDe(0)).toBe('0'); // el cero si es un valor: vaciar no es cero, es hueco
    expect(valorTipado('4,5', 'numero')).toBe(4.5);
    expect(valorTipado('no es fecha', 'fecha')).toBeNull();
    expect(valorTipado('2026-13-40', 'fecha')).toBeNull();
    expect(valorTipado('1', 'booleano')).toBe(true);
  });

  it('claveDeDia acepta las tres formas que circulan', () => {
    expect(claveDeDia('2026-12-31')).toBe('2026-12-31');
    expect(claveDeDia('2026/12/31')).toBe('2026-12-31');
    expect(claveDeDia('2026-12-31T22:00:00.000Z')).toBe('2026-12-31');
  });

  it('coincideEnMenu sin acentos y sin mayusculas', () => {
    expect(coincideEnMenu('Lechuga hoja de roble', 'ROBLE')).toBe(true);
    expect(coincideEnMenu('Verduras', 'verd')).toBe(true);
    expect(coincideEnMenu('Queso curado', 'curau')).toBe(false);
    expect(coincideEnMenu('Aguacate', '')).toBe(true);
  });

  it('hoyLocal y sumarDias: dias, no instantes', () => {
    expect(hoyLocal(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(sumarDias('2026-02-27', 3)).toBe('2026-03-02');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('paginar (el pie de la tabla)', () => {
  const muchas = Array.from({ length: 25 }, (_, i) => ({ n: i + 1 }));

  it('corta, cuenta y acota', () => {
    const primera = paginar(muchas, 1, 10);
    expect(primera.filas.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([primera.desde, primera.hasta, primera.total, primera.ultima]).toEqual([1, 10, 25, 3]);
    const ultima = paginar(muchas, 3, 10);
    expect(ultima.filas.map((f) => f.n)).toEqual([21, 22, 23, 24, 25]);
    expect(ultima.hasta).toBe(25);
  });

  it('fuera de rango se acota, y el vacio no divide por cero', () => {
    expect(paginar(muchas, 99, 10).ultima).toBe(3);
    expect(paginar(muchas, 99, 10).filas.map((f) => f.n)).toEqual([21, 22, 23, 24, 25]);
    const vacia = paginar([], 5, 10);
    expect([vacia.filas.length, vacia.desde, vacia.hasta, vacia.total, vacia.ultima]).toEqual([
      0, 0, 0, 0, 1
    ]);
    expect(paginar(muchas, 0, 10).desde).toBe(1);
  });
});

// ── tanda 32 (## 12ad): tramos de seleccion, re-anclado de pagina y paginador ──

describe('tramoDeIndices (## 12ad)', () => {
  it('es inclusivo y en orden ascendente, caiga como caiga el click', () => {
    expect(tramoDeIndices(4, 7)).toEqual([4, 5, 6, 7]);
    expect(tramoDeIndices(7, 4)).toEqual([4, 5, 6, 7]);
    expect(tramoDeIndices(5, 5)).toEqual([5]);
  });
});

describe('reanclarPagina (## 12ad)', () => {
  it('mantiene la primera fila visible al cambiar de tamano', () => {
    // Con 24 por pagina y la pagina 3 (filas 49-72), a 10 la fila 49 vive en la pagina 5.
    expect(reanclarPagina(3, 24, 10)).toBe(5);
    expect(reanclarPagina(1, 24, 50)).toBe(1);
    expect(reanclarPagina(2, 10, 50)).toBe(1);
  });
  it('nunca devuelve una pagina inferior a uno', () => {
    expect(reanclarPagina(0, 24, 10)).toBe(1);
  });
});

describe('tramoDePaginas (## 12ad, ## 12ah)', () => {
  it('con mas de siete paginas la hilera ocupa SIEMPRE siete casillas: no respira al navegar', () => {
    // El contrato de ancho (## 12ah): siete casillas en la primera pagina, en la ultima y en
    // todas las de medias. Si una sola combinacion devolviera seis u ocho, el pie de la tabla
    // cambiaria de tamano al pasar pagina —y el parte decia que eso no se hace.
    for (let ultima = 8; ultima <= 41; ultima++) {
      for (let centro = 1; centro <= ultima; centro++) {
        expect(tramoDePaginas(centro, ultima).length).toBe(7);
      }
    }
  });
  it('al principio se ven 1 2 3 4 5 y el salto a la ultima', () => {
    expect(tramoDePaginas(1, 10)).toEqual([1, 2, 3, 4, 5, 'fin', 10]);
    expect(tramoDePaginas(2, 10)).toEqual([1, 2, 3, 4, 5, 'fin', 10]);
    expect(tramoDePaginas(4, 20)).toEqual([1, 2, 3, 4, 5, 'fin', 20]);
  });
  it('en medio, primera y ultima fijas con la ventana de +-1', () => {
    expect(tramoDePaginas(5, 20)).toEqual([1, 'ini', 4, 5, 6, 'fin', 20]);
    expect(tramoDePaginas(6, 39)).toEqual([1, 'ini', 5, 6, 7, 'fin', 39]);
    expect(tramoDePaginas(16, 20)).toEqual([1, 'ini', 15, 16, 17, 'fin', 20]);
  });
  it('al final, espejo del principio: la ultima ventana pegada al extremo', () => {
    expect(tramoDePaginas(17, 20)).toEqual([1, 'ini', 16, 17, 18, 19, 20]);
    expect(tramoDePaginas(20, 20)).toEqual([1, 'ini', 16, 17, 18, 19, 20]);
    expect(tramoDePaginas(10, 10)).toEqual([1, 'ini', 6, 7, 8, 9, 10]);
    expect(tramoDePaginas(5, 8)).toEqual([1, 'ini', 4, 5, 6, 7, 8]);
  });
  it('la pagina pedida se recorta a la ultima viva antes de decidir el tramo', () => {
    expect(tramoDePaginas(99, 10)).toEqual([1, 'ini', 6, 7, 8, 9, 10]);
    expect(tramoDePaginas(0, 10)).toEqual([1, 2, 3, 4, 5, 'fin', 10]);
  });
  it('con poca distancia (<= 7 paginas) todas y sin marcas', () => {
    expect(tramoDePaginas(1, 1)).toEqual([1]);
    expect(tramoDePaginas(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(tramoDePaginas(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tramoDePaginas(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
