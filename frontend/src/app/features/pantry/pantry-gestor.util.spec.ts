import { pantryCategoryLabel } from '../../core/i18n/labels';
import { pantryEn, pantryEs } from '../../core/i18n/dict/pantry';
import type { PantryCategory } from '../../shared/models/pantry.model';
import {
  aliasVisibles,
  clavesSubarbolDe,
  clavesNoElegiblesComoPadre,
  padreDeCategoriaDesdeQuery,
  colorDeCategoria,
  normalizarColorSeleccionado,
  normalizarAlias,
  offsetDeQuery,
  valorDeQuery,
  cargarTodasLasPaginas,
  claveDeProductoCasa,
  caducaEnTresDias,
  coincideGestor
} from './pantry-gestor.util';

// El `es` del diccionario es la fuente de la verdad para estas pruebas: el semillero del server escribe los
// nombres en castellano, y lo que se comprueba aqui es como se lee ese texto, no como suena en otro idioma.
const castellano = pantryEs as unknown as Record<string, string>;
const ingles = pantryEn as unknown as Record<string, string>;
const t = (clave: string): string => castellano[clave] ?? clave;
const tEn = (clave: string): string => ingles[clave] ?? clave;
const categoriasDeFabrica = [
  { key: 'alimentos', nombre: 'Alimentos', ingles: 'Food' },
  { key: 'vegetables', nombre: 'Verduras', ingles: 'Vegetables' },
  { key: 'fruits', nombre: 'Frutas', ingles: 'Fruits' },
  { key: 'meat', nombre: 'Carnes', ingles: 'Meat' },
  { key: 'fish', nombre: 'Pescados', ingles: 'Fish' },
  { key: 'dairy', nombre: 'Lácteos', ingles: 'Dairy' },
  { key: 'grains', nombre: 'Cereales', ingles: 'Grains' },
  { key: 'spices', nombre: 'Especias', ingles: 'Spices' },
  { key: 'condiments', nombre: 'Condimentos', ingles: 'Condiments' },
  { key: 'frozen', nombre: 'Congelados', ingles: 'Frozen' },
  { key: 'canned', nombre: 'Enlatados', ingles: 'Canned' },
  { key: 'beverages', nombre: 'Bebidas', ingles: 'Beverages' },
  { key: 'other', nombre: 'Otros', ingles: 'Other' }
] as const;

const fila = (parciales: Partial<PantryCategory>): PantryCategory => ({
  id: parciales.id ?? 'x',
  key: parciales.key ?? 'x',
  name: parciales.name ?? 'X',
  color: parciales.color ?? '#4CAF50',
  description: null,
  parentKey: parciales.parentKey ?? null,
  parentName: parciales.parentName ?? null,
  position: 0,
  counts: parciales.counts ?? { products: 0, children: 0, descendantProducts: 0 },
  protected: parciales.protected ?? false,
  canDelete: parciales.canDelete ?? true
});

describe('clavesNoElegiblesComoPadre (## 12x)', () => {
  const catalogo = [
    fila({ id: '1', key: 'alimentacion' }),
    fila({ id: '2', key: 'bebidas', parentKey: 'alimentacion' }),
    fila({ id: '3', key: 'de avena', parentKey: 'bebidas' }),
    fila({ id: '4', key: 'limpieza' })
  ];

  it('al crear no hay nada prohibido: la categoria todavia no tiene a nadie por debajo', () => {
    expect([...clavesNoElegiblesComoPadre(catalogo, null)]).toEqual([]);
  });

  it('la propia fila y lo que cuelga de ella, a cualquier profundidad —lo que tiene encima, no', () => {
    // Un antepasado SI se puede elegir como padre: subir un nivel es exactamente lo que alguien quiere decir
    // cuando abre este picker. Lo que cierra el arbol es elegir a un descendiente, y eso es lo que desaparece.
    const prohibidas = clavesNoElegiblesComoPadre(catalogo, '2');
    expect([...prohibidas].sort()).toEqual(['bebidas', 'de avena'].sort());
    expect(prohibidas.has('alimentacion')).toBe(false);
    expect(prohibidas.has('limpieza')).toBe(false);
  });

  it('una hoja solo se excluye a si misma: la unica colocacion que no puede hacer es debajo de si misma', () => {
    expect([...clavesNoElegiblesComoPadre(catalogo, '3')]).toEqual(['de avena']);
  });

  it('un id que ya no esta en el catalogo no convierte la lista entera en prohibida', () => {
    expect([...clavesNoElegiblesComoPadre(catalogo, 'no-existe')]).toEqual([]);
  });
});

describe('el padre que propone el enlace de alta', () => {
  const catalogo = [fila({ id: '1', key: 'alimentos' }), fila({ id: '2', key: 'fruits' })];

  it('acepta una clave existente y recorta espacios externos', () => {
    expect(padreDeCategoriaDesdeQuery(' alimentos ', catalogo)).toBe('alimentos');
  });

  it('ignora una consulta ausente, vacia o que no corresponde a una categoria', () => {
    expect(padreDeCategoriaDesdeQuery(null, catalogo)).toBeNull();
    expect(padreDeCategoriaDesdeQuery('  ', catalogo)).toBeNull();
    expect(padreDeCategoriaDesdeQuery('category_food', catalogo)).toBeNull();
  });
});

describe('colorDeCategoria', () => {
  it('lo que no es un color del todo se pinta con el gris de la reserva, no se queda en blanco', () => {
    expect(colorDeCategoria({ color: '#4caf50' } as PantryCategory)).toBe('#4CAF50');
    expect(colorDeCategoria({ color: 'rojo' } as PantryCategory)).toBe('#8A8F98');
    expect(colorDeCategoria({ color: '' } as PantryCategory)).toBe('#8A8F98');
    expect(colorDeCategoria(null)).toBe('#8A8F98');
  });
});

describe('normalizarColorSeleccionado', () => {
  it('recorta espacios y canoniza el color del control nativo a mayúsculas', () => {
    expect(normalizarColorSeleccionado(' #12ab34 ')).toBe('#12AB34');
  });

  it('conserva la ausencia de color sin sustituirla por el fallback visual', () => {
    expect(normalizarColorSeleccionado('')).toBeNull();
    expect(normalizarColorSeleccionado('   ')).toBeNull();
    expect(normalizarColorSeleccionado(null)).toBeNull();
    expect(normalizarColorSeleccionado(undefined)).toBeNull();
  });
});

describe('normalizarAlias', () => {
  it('el nombre del producto no es un alias de si mismo', () => {
    expect(normalizarAlias('Leche', 'Leche', [])).toEqual({ error: 'es-el-nombre' });
    expect(normalizarAlias('  leche ', 'Leche', [])).toEqual({ error: 'es-el-nombre' });
  });

  it('repetido es repetido sin importar las mayusculas, y los espacios se colapsan', () => {
    expect(normalizarAlias('del  dia', 'Leche', ['Del dia'])).toEqual({ error: 'repetido' });
    expect(normalizarAlias('Leche   del   dia', 'Leche', [])).toEqual({ valor: 'Leche del dia' });
  });

  it('veinte es el techo, y vacio no entra', () => {
    expect(normalizarAlias('   ', 'Leche', [])).toEqual({ error: 'vacio' });
    expect(
      normalizarAlias(
        'otra',
        'Leche',
        Array.from({ length: 20 }, (_, i) => `a-${i}`)
      )
    ).toBeNull();
  });
});

describe('aliasVisibles', () => {
  it('la fila no baile: tres y un «+n» con el resto', () => {
    expect(aliasVisibles(['a', 'b'])).toEqual({ visibles: ['a', 'b'], ocultos: 0 });
    expect(aliasVisibles(['a', 'b', 'c', 'd', 'e'])).toEqual({
      visibles: ['a', 'b', 'c'],
      ocultos: 2
    });
  });
});

describe('la etiqueta de una categoria (## 12x)', () => {
  it('traduce las 13 categorias de fabrica al espanol y al ingles', () => {
    expect(categoriasDeFabrica.length).toBe(13);

    for (const categoria of categoriasDeFabrica) {
      const fila = { key: categoria.key, name: categoria.nombre };
      expect(pantryCategoryLabel(fila, t)).withContext(categoria.key).toBe(categoria.nombre);
      expect(pantryCategoryLabel(fila, tEn)).withContext(categoria.key).toBe(categoria.ingles);
    }
  });

  it('en cuanto la casa le cambia el nombre, gana lo que ella escribio: el diccionario no corrige datos', () => {
    expect(pantryCategoryLabel({ key: 'vegetables', name: 'Verduras de la huerta' }, tEn)).toBe(
      'Verduras de la huerta'
    );
  });

  it('una categoria creada por la casa se pinta cruda en los dos idiomas', () => {
    expect(pantryCategoryLabel({ key: 'frutos secos', name: 'Frutos secos' }, tEn)).toBe(
      'Frutos secos'
    );
  });

  it('una clave sin fila (la borraron y el articulo se quedo) se pinta como lo que es: una clave', () => {
    expect(pantryCategoryLabel('despensa-vieja', t)).toBe('despensa-vieja');
    expect(pantryCategoryLabel({ key: 'despensa-vieja' }, t)).toBe('despensa-vieja');
  });
});

// El estado de la lista (filtro, vista, busqueda, pagina) viaja en la query para que un F5 conserve el sitio.
// Eso solo vale si al entrar se lee: escribir la URL y no mirarla es un adorno, y era exactamente el bug que
// encontro el CI en la tanda 25 (entrar por `/pantry/products?filter=in-pantry` ponia la primera pagina de
// `staples`, con la busqueda vacia). Se prueba aqui, que es donde se puede probar sin navegador.
const query = (pares: Record<string, string>): { get(campo: string): string | null } => ({
  get: (campo: string) => pares[campo] ?? null
});

describe('el estado de la lista vuelve de la query', () => {
  it('lo que la query dice manda, si es un valor conocido', () => {
    const filtros = ['all', 'staples', 'in-pantry', 'expiring'] as const;
    expect(valorDeQuery(query({ filter: 'in-pantry' }), 'filter', filtros, 'staples')).toBe(
      'in-pantry'
    );
    expect(valorDeQuery(query({}), 'filter', filtros, 'staples')).toBe('staples');
  });

  it('un valor que no esta en la lista cae al de fabrica, no se cuela', () => {
    const vistas = ['all', 'without-products', 'with-children'] as const;
    expect(valorDeQuery(query({ view: 'todo-y-mas' }), 'view', vistas, 'all')).toBe('all');
    // Un tipo de dato que la app no entiende tampoco: la query es texto libre, viene del navegador.
    expect(valorDeQuery(query({ view: '5' }), 'view', vistas, 'all')).toBe('all');
  });

  it('la busqueda se lee tal cual, y ausencia es cadena vacia', () => {
    expect(valorDeQuery(query({ q: 'Levadura' }), 'q', null, '')).toBe('Levadura');
    expect(valorDeQuery(query({}), 'q', null, '')).toBe('');
    // El espacio es un dato escrito por una persona: no se inventa un filtro con una cadena en blanco.
    expect(valorDeQuery(query({ q: '   ' }), 'q', null, '')).toBe('   ');
  });

  it('el desplazamiento solo cuenta hacia delante, y lo que no es numero no es pagina', () => {
    expect(offsetDeQuery(query({ offset: '20' }))).toBe(20);
    expect(offsetDeQuery(query({ offset: '0' }))).toBe(0);
    expect(offsetDeQuery(query({}))).toBe(0);
    expect(offsetDeQuery(query({ offset: 'abc' }))).toBe(0);
    // Negativo seria una pagina que no existe: la primera pagina siempre es la primera.
    expect(offsetDeQuery(query({ offset: '-10' }))).toBe(0);
    expect(offsetDeQuery(query({ offset: '12.9' }))).toBe(12);
  });
});

describe('clavesSubarbolDe (## 12ab)', () => {
  const arbol = [
    { key: 'alimentos', parentKey: null },
    { key: 'verduras', parentKey: 'alimentos' },
    { key: 'frutas', parentKey: 'alimentos' },
    { key: 'bocadillos', parentKey: 'verduras' },
    { key: 'other', parentKey: null }
  ];
  it('sube la raiz y baja por todos los nietos', () => {
    expect(clavesSubarbolDe(arbol, 'alimentos')).toEqual(
      new Set(['alimentos', 'verduras', 'frutas', 'bocadillos'])
    );
  });
  it('un callejon sin hijos es el mismo; y un ciclo no lo monta nadie (no hay padres repetidos)', () => {
    expect(clavesSubarbolDe(arbol, 'frutas')).toEqual(new Set(['frutas']));
    expect(clavesSubarbolDe(arbol, 'other')).toEqual(new Set(['other']));
  });
});

describe('cargarTodasLasPaginas (## 12ac: la carga completa de los gestores)', () => {
  it('recorre las paginas por orden hasta el total, sin pedir de mas', async () => {
    const pedidos: number[] = [];
    const paginas = new Map<number, { data: number[]; total: number }>([
      [0, { data: [1, 2, 3], total: 5 }],
      [3, { data: [4, 5], total: 5 }]
    ]);
    const salida = await cargarTodasLasPaginas(
      async (offset) => {
        pedidos.push(offset);
        const pagina = paginas.get(offset);
        if (!pagina) return null;
        return {
          data: pagina.data,
          meta: { total: pagina.total },
          hasMore: offset + pagina.data.length < pagina.total
        };
      },
      3,
      2000
    );
    expect(salida).toEqual([1, 2, 3, 4, 5]);
    expect(pedidos).toEqual([0, 3]);
  });

  it('corta en el tope y devuelve null si una pagina falla', async () => {
    const corta = await cargarTodasLasPaginas(
      async (offset) => ({ data: [offset], meta: { total: 100000 }, hasMore: true }),
      1,
      3
    );
    expect(corta).toEqual([0, 1, 2]);

    let llamadas = 0;
    const rota = await cargarTodasLasPaginas(
      async () => {
        llamadas += 1;
        return llamadas === 1 ? { data: [1], meta: { total: 9 }, hasMore: true } : null;
      },
      1,
      9
    );
    expect(rota).toBeNull();
  });

  it('una pagina vacia es la lista legalmente vacia, no un fallo', async () => {
    const salida = await cargarTodasLasPaginas(
      async () => ({ data: [], meta: { total: 0 }, hasMore: false }),
      10,
      2000
    );
    expect(salida).toEqual([]);
  });
});

describe('caducaEnTresDias (## 12ac: el chip «caducan» del gestor, en dias)', () => {
  it('cuenta por dia, no por instante, y el limite de los tres dias entra', () => {
    expect(caducaEnTresDias('2026-10-04T22:10:00', '2026-10-01')).toBe(true);
    expect(caducaEnTresDias('2026-10-04', '2026-10-01')).toBe(true);
    expect(caducaEnTresDias('2026-10-05', '2026-10-01')).toBe(false);
    expect(caducaEnTresDias('2026-09-30', '2026-10-01')).toBe(false);
    expect(caducaEnTresDias(null, '2026-10-01')).toBe(false);
    expect(caducaEnTresDias('2026/10/02', '2026-10-01')).toBe(true);
  });
});

describe('coincideGestor (## 12ac: la caja busca sin acentos como el visor)', () => {
  it('casa cualquier campo listado, con la consulta vacia lo deja todo pasar', () => {
    expect(coincideGestor(['Tomate', 'picadillo'], 'TOMA')).toBe(true);
    expect(coincideGestor(['Tomate', 'picadillo'], 'PICADI')).toBe(true);
    expect(coincideGestor(['Limon'], 'limÓN')).toBe(true);
    expect(coincideGestor(['A'], '')).toBe(true);
    expect(coincideGestor([null, undefined, ''], 'x')).toBe(false);
    expect(coincideGestor(['Levadura'], 'naranja')).toBe(false);
  });
});

// ── tanda 32 (## 12ad): la clave de producto del server, portada al cliente ──

describe('claveDeProductoCasa (## 12ad)', () => {
  it('normaliza acentos, mayusculas y puntuacion de sobra', () => {
    expect(claveDeProductoCasa('Levadura-Fresca.')).toBe('levadura-fresca');
    expect(claveDeProductoCasa('  Leche   SIN LACTOSA ')).toBe('leche sin lactosa');
  });
  it('quita la cantidad entre parentesis y el «x3» entero, como el server', () => {
    expect(claveDeProductoCasa('Leche Semi (1L)')).toBe('leche semi');
    expect(claveDeProductoCasa('Manzanas x3')).toBe('manzanas');
  });
  it('abrevia las unidades reconocidas', () => {
    expect(claveDeProductoCasa('Harina Kilos 2')).toBe('harina kg 2');
    expect(claveDeProductoCasa('Agua litros')).toBe('agua l');
  });
  it('conserva los modificadores que cambian el producto y quita los rellenos', () => {
    expect(claveDeProductoCasa('Leche de la vaca')).toBe('leche vaca');
    expect(claveDeProductoCasa('Leche sin lactosa')).toBe('leche sin lactosa');
    expect(claveDeProductoCasa('Leche con lactosa')).toBe('leche con lactosa');
  });
  it('la vacia es vacia', () => {
    expect(claveDeProductoCasa('')).toBe('');
    expect(claveDeProductoCasa(null as unknown as string)).toBe('');
  });
});
