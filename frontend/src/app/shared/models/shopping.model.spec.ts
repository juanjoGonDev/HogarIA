import {
  auditFace,
  formatMoney,
  productKeyOf,
  formatQuantity,
  groupItemsByCategory,
  orderShoppingItems,
  lineDiscountOfItem,
  describeLineDiscount,
  offerOfItem,
  describeOffer,
  parseMoneyToMinor,
  discountDraftFromSaved,
  discountInputFromSaved,
  ListDiscount,
  ShoppingListItem
} from './shopping.model';
import { dateLocale, setDateLocale } from '../../core/time';

function isolateSpanishLocale(): void {
  let previousLocale: string;
  beforeEach(() => {
    previousLocale = dateLocale();
    setDateLocale('es-ES');
  });
  afterEach(() => setDateLocale(previousLocale));
}

/**
 * Las dos unicas funciones de dinero de la pantalla. Se prueban aqui y no en el
 * backend porque el backend solo sabe sumar centimts: quien traduce lo que teclea
 * una persona con coma decimal es la app, y ahi es donde se pierden los centimos.
 */
describe('shopping.model — dinero', () => {
  isolateSpanishLocale();

  it('lee la coma como separador decimal, como un teclado español', () => {
    expect(parseMoneyToMinor('12,40')).toBe(1240);
    expect(parseMoneyToMinor('1,20')).toBe(120);
    expect(parseMoneyToMinor('0,01')).toBe(1);
  });

  it('respeta el punto de miles cuando la cantidad viene larga', () => {
    expect(parseMoneyToMinor('1.290')).toBe(129000);
    expect(parseMoneyToMinor('1.290,50')).toBe(129050);
  });

  it('un punto suelto con uno o dos decimales es decimal, no miles', () => {
    expect(parseMoneyToMinor('1.5')).toBe(150);
    expect(parseMoneyToMinor('1.20')).toBe(120);
    expect(parseMoneyToMinor('.5')).toBe(50);
  });

  it('acepta basura de portapapeles: moneda, espacios y prefijos', () => {
    expect(parseMoneyToMinor('1 234,50 €')).toBe(123450);
    expect(parseMoneyToMinor('2')).toBe(200);
    expect(parseMoneyToMinor('0')).toBe(0);
  });

  it('redondea el tercer decimal en lugar de perderlo', () => {
    expect(parseMoneyToMinor('3,999')).toBe(400);
    expect(parseMoneyToMinor('1,290')).toBe(129);
  });

  it('devuelve null en vez de adivinar: ni texto, ni negativos, ni importes de dedo resbalado', () => {
    expect(parseMoneyToMinor('')).toBeNull();
    expect(parseMoneyToMinor(null)).toBeNull();
    expect(parseMoneyToMinor('abc')).toBeNull();
    expect(parseMoneyToMinor('-3')).toBeNull();
    expect(parseMoneyToMinor('1,2,3')).toBeNull();
    expect(parseMoneyToMinor('1000000')).toBeNull();
  });

  it('pinta la raya donde no hay dato, y el cero donde si lo hay', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(0)).toBe('0,00 €');
    expect(formatMoney(85)).toBe('0,85 €');
    expect(formatMoney(129050)).toBe('1290,50 €');
  });
});

describe('shopping.model — DTO de descuento de lista', () => {
  it('restaura las propiedades camelCase del API en la hoja y al deshacer', () => {
    const saved: ListDiscount = {
      kind: 'percent',
      valueMinor: null,
      percentBps: 1250,
      scope: 'firstUnits',
      firstUnits: 3,
      target: null,
      targets: null,
      label: 'Fidelidad',
      description: '12,5 % en 3 unidades'
    };

    expect(discountDraftFromSaved(saved)).toEqual({
      kind: 'percent',
      scope: 'firstUnits',
      firstUnits: 3,
      targets: [],
      label: 'Fidelidad',
      amount: '',
      percent: '12.5'
    });
    expect(discountInputFromSaved(saved)).toEqual({
      kind: 'percent',
      valueMinor: null,
      percentBps: 1250,
      scope: 'firstUnits',
      firstUnits: 3,
      target: null,
      targets: null,
      label: 'Fidelidad'
    });
  });

  it('deduplica objetivos y mantiene el importe visible; sin descuento empieza limpio', () => {
    const saved: ListDiscount = {
      kind: 'amount',
      valueMinor: 150,
      percentBps: null,
      scope: 'product',
      firstUnits: null,
      target: 'Avena',
      targets: ['Avena', 'Zumo'],
      label: null
    };
    expect(discountDraftFromSaved(saved)).toEqual(
      jasmine.objectContaining({
        targets: ['Avena', 'Zumo'],
        amount: '1,50',
        percent: null
      })
    );
    expect(discountDraftFromSaved(null)).toEqual({
      kind: 'amount',
      scope: 'all',
      firstUnits: null,
      targets: [],
      label: null,
      amount: '',
      percent: null
    });
  });
});

describe('shopping.model — cantidades y secciones', () => {
  isolateSpanishLocale();

  it('una unidad suelta no se pinta: el 1 de «1 Leche» es ruido', () => {
    const previousLocale = dateLocale();
    try {
      setDateLocale('es-ES');
      expect(formatQuantity(1, null)).toBe('');
      expect(formatQuantity(2, null)).toBe('2×');
      expect(formatQuantity(2, 'kg')).toBe('2 kg');
      expect(formatQuantity(0.5, 'kg')).toBe('0,5 kg');
    } finally {
      setDateLocale(previousLocale);
    }
  });

  function item(name: string, category: string | null, position = 0): ShoppingListItem {
    return { id: name, name, category, position } as ShoppingListItem;
  }

  it('agrupa por seccion de tienda y manda lo suelto al final', () => {
    const groups = groupItemsByCategory([
      item('Leche', 'Lacteos'),
      item('Tomate', 'Frutas y verduras'),
      item('Velas', null),
      item('Pan', 'Panaderia')
    ]);

    expect(groups.map((group) => group.category)).toEqual([
      'Frutas y verduras',
      'Panaderia',
      'Lacteos',
      'Otros'
    ]);
  });

  it('una seccion inventada se queda con las demas, no se pierde', () => {
    const groups = groupItemsByCategory([item('X', 'Charcuteria'), item('Y', 'Otros')]);

    expect(groups.map((group) => group.category)).toEqual(['Charcuteria', 'Otros']);
  });

  it('no crea grupo fantasma cuando la lista esta vacia', () => {
    expect(groupItemsByCategory([])).toEqual([]);
  });

  it('ordena primero el peso comparable y deja las unidades desconocidas en orden estable', () => {
    const original = [
      { ...item('Sin unidad', null, 0), quantity: 4, unit: null },
      { ...item('Medio kilo', 'Despensa', 1), quantity: 500, unit: 'g' },
      { ...item('Otro medio kilo', 'Despensa', 2), quantity: 0.5, unit: 'kg' },
      { ...item('Volumen desconocido', 'Bebidas', 3), quantity: 2, unit: 'ml' },
      { ...item('Dos kilos', 'Despensa', 4), quantity: 2, unit: 'kg' }
    ] as ShoppingListItem[];

    const ordered = orderShoppingItems(original, { weightFirst: true, frozenLast: false });

    expect(ordered.map((row) => row.name)).toEqual([
      'Dos kilos',
      'Medio kilo',
      'Otro medio kilo',
      'Sin unidad',
      'Volumen desconocido'
    ]);
    expect(original.map((row) => row.name)).toEqual([
      'Sin unidad',
      'Medio kilo',
      'Otro medio kilo',
      'Volumen desconocido',
      'Dos kilos'
    ]);
  });

  it('mantiene las filas congeladas al final y desempata sin alterar el orden manual', () => {
    const original = [
      { ...item('Helado', 'Congelados', 0), quantity: 1, unit: 'kg' },
      { ...item('Pan', 'Panaderia', 1), quantity: 2, unit: 'kg' },
      { ...item('Verdura congelada', 'Congelados', 2), quantity: 1, unit: 'kg' },
      { ...item('Leche', 'Lacteos', 3), quantity: 1, unit: 'l' }
    ] as ShoppingListItem[];

    const ordered = orderShoppingItems(original, { weightFirst: false, frozenLast: true });

    expect(ordered.map((row) => row.name)).toEqual(['Pan', 'Leche', 'Helado', 'Verdura congelada']);
  });

  it('mueve la categoría Congelados completa al final sin reordenar las demás categorías', () => {
    const groups = groupItemsByCategory(
      [item('Helado', 'Congelados', 0), item('Leche', 'Lacteos', 1), item('Pan', 'Panaderia', 2)],
      { frozenLast: true }
    );

    expect(groups.map((group) => group.category)).toEqual(['Panaderia', 'Lacteos', 'Congelados']);
  });
});

describe('shopping.model — descuentos de línea y ofertas', () => {
  isolateSpanishLocale();

  const labels = { unidad: 'unidad', unidades: 'unidades' };

  it('normaliza campos ausentes y conserva los ceros de descuentos reconocidos', () => {
    expect(
      lineDiscountOfItem({
        disc_kind: null,
        disc_value_minor: null,
        disc_percent_bps: null,
        disc_units: null
      })
    ).toBeNull();

    expect(
      lineDiscountOfItem({
        disc_kind: 'amount',
        disc_value_minor: 0,
        disc_percent_bps: null,
        disc_units: null
      })
    ).toEqual({ kind: 'amount', valueMinor: 0, percentBps: null, units: null });

    expect(
      lineDiscountOfItem({
        disc_kind: 'percent',
        disc_value_minor: undefined as unknown as number | null,
        disc_percent_bps: 1250,
        disc_units: 2
      })
    ).toEqual({ kind: 'percent', valueMinor: null, percentBps: 1250, units: 2 });
  });

  it('describe descuentos ausentes, porcentajes/importes y límites singular/plural', () => {
    expect(describeLineDiscount(null, labels)).toBeNull();
    expect(describeLineDiscount(undefined, labels)).toBeNull();
    expect(describeLineDiscount({ kind: 'amount', valueMinor: 250 }, labels)).toBe('2,50 €');
    expect(describeLineDiscount({ kind: 'amount' }, labels)).toBe('0,00 €');
    expect(describeLineDiscount({ kind: 'percent', percentBps: 1250, units: 1 }, labels)).toBe(
      '12,5 % en 1 unidad'
    );
    expect(describeLineDiscount({ kind: 'percent', percentBps: 0, units: 2 }, labels)).toBe(
      '0 % en 2 unidades'
    );
    expect(describeLineDiscount({ kind: 'percent' }, labels)).toBe('0 %');
    expect(describeLineDiscount({ kind: 'amount', valueMinor: 1, units: -1 }, labels)).toBe(
      '0,01 €'
    );
  });

  it('solo expone ofertas válidas con unidades pagadas positivas', () => {
    const invalid = [
      { promo_buy: null, promo_take: null },
      { promo_buy: 0, promo_take: 1 },
      { promo_buy: 1, promo_take: 1 },
      { promo_buy: 3, promo_take: 0 },
      { promo_buy: 3, promo_take: -1 },
      { promo_buy: 3, promo_take: 3 }
    ];
    for (const item of invalid) expect(offerOfItem(item)).toBeNull();

    expect(offerOfItem({ promo_buy: 3, promo_take: 2 })).toEqual({ buy: 3, take: 2 });
  });

  it('describe la compra por unidades pagadas (3x2), no por las gratuitas (3x1)', () => {
    expect(describeOffer(null)).toBeNull();
    expect(describeOffer(undefined)).toBeNull();
    expect(describeOffer({ buy: 0, take: 1 })).toBeNull();
    expect(describeOffer({ buy: 3, take: 0 })).toBeNull();
    expect(describeOffer({ buy: 3, take: 3 })).toBeNull();
    expect(describeOffer({ buy: 3, take: 2 })).toBe('3x2');
    expect(describeOffer({ buy: 2, take: 1 })).toBe('2x1');
  });
});

describe('productKeyOf (la clave con la que se enlaza un producto)', () => {
  it('quita acentos y mayusculas, que es lo que hace que «Jamón» sea «jamon»', () => {
    expect(productKeyOf('Jamón Serrano')).toBe('jamon serrano');
    expect(productKeyOf('  JAMON  SERRANO ')).toBe('jamon serrano');
  });

  it('los simbolos se convierten en espacios, no en basura: «1/2 pieza» sigue siendo legible', () => {
    expect(productKeyOf('Leche 1L')).toBe('leche 1l');
    expect(productKeyOf('Pan de molde (grande)')).toBe('pan de molde grande');
  });

  it('lo vacio es clave vacia: «sin enlace» tiene que ser distinguishle de «el nombre raro»', () => {
    expect(productKeyOf('')).toBe('');
    expect(productKeyOf(null)).toBe('');
    expect(productKeyOf(undefined)).toBe('');
  });

  it('dos nombres que son el mismo producto dan la misma clave, y «pan» y «pan de molde» no', () => {
    expect(productKeyOf('Jamón')).not.toBe(productKeyOf('Jamón Serrano'));
    expect(productKeyOf('Leche semidesnatada')).toBe(productKeyOf('leche  semidesnatada'));
  });

  describe('auditFace — la cara en el historial', () => {
    const base = {
      user_id: 'u-ana',
      user_name: 'Ana',
      user_avatar: '/api/uploads/avatars/ana-old.png',
      action: 'item.add',
      item_name: 'Leche',
      description: 'Ana ha añadido «Leche»'
    } as const;

    // La voz de la pantalla: el diccionario justo para no arrancar Angular. Sin acentos a proposito: la frase
    // coincide con la que escribe el server, y eso es lo que se esta probando aqui.
    const voz = (t: (key: string, params?: Record<string, string>) => string) => ({ t });
    const es = (key: string, params?: Record<string, string>): string => {
      const plantillas: Record<string, string> = {
        'list_event.item_anadido': '{who} ha añadido «{item}»',
        'list_event.alguien': 'Alguien'
      };
      let texto = plantillas[key] ?? key;
      for (const [nombre, valor] of Object.entries(params ?? {}))
        texto = texto.split(`{${nombre}}`).join(valor);
      return texto.replace(/\s{2,}/g, ' ').trim();
    };

    it('las filas de otra persona se dejan como las contesto el servidor', () => {
      const face = auditFace(base, { id: 'u-bea', name: 'Bea', avatar: null }, voz(es));
      expect(face.name).toBe('Ana');
      expect(face.avatar).toBe('/api/uploads/avatars/ana-old.png');
      expect(face.text).toBe('Ana ha añadido «Leche»');
    });

    it('una fila propia se pinta con el nombre y la foto de ahora', () => {
      const face = auditFace(
        base,
        { id: 'u-ana', name: 'Ana Belén', avatar: '/api/uploads/avatars/ana-new.png' },
        voz(es)
      );
      expect(face.name).toBe('Ana Belén');
      expect(face.avatar).toBe('/api/uploads/avatars/ana-new.png');
      // El sujeto es un parametro desde el principio: la frase ya no se recorta para cambiarle quien la empieza.
      expect(face.text).toBe('Ana Belén ha añadido «Leche»');
    });

    it('sin voz se pinta la frase del server, tal cual (cliente viejo, fila vieja)', () => {
      expect(auditFace(base, { id: 'u-ana', name: 'Ana Belén', avatar: null }).text).toBe(
        'Ana ha añadido «Leche»'
      );
    });

    it('sin foto nueva no se inventa: se conserva la que vino', () => {
      expect(auditFace(base, { id: 'u-ana', name: 'Ana' }, voz(es)).avatar).toBe(
        '/api/uploads/avatars/ana-old.png'
      );
      // Una cuenta sin nombre no borra el de la fila.
      expect(auditFace(base, { id: 'u-ana', name: '  ' }, voz(es)).name).toBe('Ana');
    });

    it('un suceso anonimo no se le asigna a quien lo mira', () => {
      const face = auditFace(
        { ...base, user_name: null, user_avatar: null },
        { id: 'u-ana', name: 'Ana' },
        voz(es)
      );
      expect(face.name).toBe('Ana');
      expect(face.text).toBe('Ana ha añadido «Leche»');
      // Y si no es tuyo y no hay nombre, «Alguien» —en el idioma activo, que es de donde salia el churro.
      expect(
        auditFace({ ...base, user_name: null }, { id: 'u-bea', name: 'Bea' }, voz(es)).name
      ).toBe('Alguien');
      expect(auditFace({ ...base, user_name: null }, { id: 'u-bea', name: 'Bea' }).name).toBe(
        'Alguien'
      );
    });
  });
});
