import { describe, expect, it } from 'vitest';
import type { CaducidadRow, Compra } from './caducidades.js';
import {
  HORIZONTE_DIAS,
  mejorTiendaDe,
  productosSugeribles,
  sugerenciasDeCompra,
  type NecesidadDelPlan,
  type ObservacionDePrecio
} from './lista-sugerida.js';

/**
 * La lista sugerida (## 12al) es estadistica, y la estadistica se fija con numeros escritos,
 * no con una base de datos de prueba: cada `it` es una casa con su historial y lo que deberia
 * decirle. Lo que se exige aqui es el REPARTO (que motivo gana y con que cantidad), no la
 * formula exacta: la formula se cambia, la promesa no.
 */

function dia(desplazado: number): string {
  return new Date(Date.parse('2026-09-29T00:00:00Z') + desplazado * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Una fila de caducidades como la que produce `caducidadesDe`, con lo que usa el motor. */
function fila(
  name: string,
  quantity: number,
  extra: Partial<CaducidadRow> = {}
): CaducidadRow {
  return {
    id: name,
    name,
    category: 'other',
    quantity,
    unit: 'ud',
    expirationDate: null,
    estimatedDays: null,
    shelfSource: null,
    vence: null,
    daysLeft: null,
    cadaDias: null,
    unidadesPorCompra: null,
    duraDias: null,
    lastBought: null,
    ...extra
  };
}

function compra(dia: string, cantidad: number): Compra {
  return { dia, cantidad };
}

function obs(
  store_name: string,
  price_minor: number,
  quantity: number,
  observed_at: string
): ObservacionDePrecio {
  return { store_name, price_minor, quantity, observed_at };
}

function sugerir(
  caducidades: CaducidadRow[],
  compras: Map<string, Compra[]> = new Map(),
  extra: {
    sinStock?: { name: string; category: string; unit: string | null }[];
    precios?: Map<string, ObservacionDePrecio[]>;
    plan?: NecesidadDelPlan[];
  } = {}
) {
  return sugerenciasDeCompra({
    caducidades,
    sinStock: extra.sinStock ?? [],
    compras,
    precios: extra.precios ?? new Map(),
    plan: extra.plan ?? []
  });
}

describe('sugerenciasDeCompra', () => {
  it('se acaba: lo que falta para cubrir la semana, redondeado al pack en que se compra', () => {
    // Leche cada 7 dias, de 6: con 1 en la nevera duran ~1 dia. Faltan 5 para la semana…
    // pero nadie compra 5 botellas: se sugiere el pack de 6.
    const filas = sugerir(
      [fila('Leche entera', 1, { cadaDias: 7, unidadesPorCompra: 6 })],
      new Map()
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ name: 'Leche entera', motivo: 'se_acaba', quantity: 6 });
  });

  it('sin stock con ritmo: la semana entera al ritmo de la casa, tambien a packs', () => {
    // Pan cada 5 dias, de 2 en 2: la semana pide 2.8 → 3, y el pack lo sube a 4.
    const filas = sugerir([], new Map([['pan barra', [compra(dia(-10), 2), compra(dia(-5), 2)]]]), {
      sinStock: [{ name: 'Pan de barra', category: 'bakery', unit: 'ud' }]
    });
    expect(filas[0]).toMatchObject({ name: 'Pan de barra', motivo: 'sin_stock', quantity: 4 });
  });

  it('sin stock sin ritmo: el tamano de la ultima compra es lo unico honesto', () => {
    const filas = sugerir([], new Map([['huevos', [compra(dia(-1), 12)]]]), {
      sinStock: [{ name: 'Huevos', category: 'dairy', unit: 'ud' }]
    });
    expect(filas[0]).toMatchObject({ motivo: 'sin_stock', quantity: 12 });
  });

  it('caduca: se repone lo que no se va a consumir a tiempo, aunque el ritmo pida menos', () => {
    // 6 yogures que caducan manana, a ritmo de 1 al dia: solo sobrevive 1, se tiran 5.
    // El ritmo a 7 dias pediria 3 (pack); lo que se pierde (5) manda en cantidad y motivo.
    const filas = sugerir([
      fila('Yogur natural', 6, { daysLeft: 1, cadaDias: 3, unidadesPorCompra: 3 })
    ]);
    expect(filas[0]).toMatchObject({ motivo: 'caduca', quantity: 5, daysLeft: 1 });
  });

  it('caducado sin ritmo: se repone lo que se perdio, sin inventar consumo', () => {
    const filas = sugerir([fila('Pescado fresco', 2, { daysLeft: -1 })]);
    expect(filas[0]).toMatchObject({ motivo: 'caduca', quantity: 2 });
  });

  it('lo que llega al horizonte no se sugiere: la lista no es un almacen', () => {
    // 5 kg de arroz que duran 150 dias: nada que decir.
    const filas = sugerir([fila('Arroz', 5, { cadaDias: 30, unidadesPorCompra: 1 })]);
    expect(filas).toHaveLength(0);
  });

  it('para el plan: lo que las recetas de la semana necesitan menos el stock de la misma unidad', () => {
    const filas = sugerir([fila('Tomate', 150, { unit: 'g' })], new Map(), {
      plan: [{ name: 'Tomate', quantity: 400, unit: 'g' }]
    });
    expect(filas[0]).toMatchObject({ motivo: 'para_el_plan', quantity: 250, unit: 'g' });
  });

  it('el plan en otra unidad no descuenta stock que no es comparable', () => {
    // 0,5 kg de limones en el frutero y la receta pide 2 ud: nadie sabe cuantos limones son
    // medio kilo, asi que se piden las 2 ud enteras.
    const filas = sugerir([fila('Limon', 0.5, { unit: 'kg' })], new Map(), {
      plan: [{ name: 'Limón', quantity: 2, unit: 'unit' }]
    });
    expect(filas[0]).toMatchObject({ motivo: 'para_el_plan', quantity: 2, unit: 'ud' });
  });

  it('el ingrediente del plan que nunca se compro se sugiere igualmente, sin tienda', () => {
    const filas = sugerir([], new Map(), { plan: [{ name: 'Lomo', quantity: 500, unit: 'g' }] });
    expect(filas[0]).toMatchObject({
      motivo: 'para_el_plan',
      quantity: 500,
      unit: 'g',
      mejorTienda: null
    });
  });

  it('el ingrediente opcional de la receta no se sugiere', () => {
    const filas = sugerir([], new Map(), {
      plan: [{ name: 'Cilantro', quantity: 1, unit: 'ud', isOptional: true }]
    });
    expect(filas).toHaveLength(0);
  });

  it('la mejor tienda es la mas barata por su ULTIMO precio, no por el de hace meses', () => {
    // Mercadona: 100 hace un mes, 120 ahora → cuenta 120. Lidl: 660 el pack de 6 → 110/u.
    const mejor = mejorTiendaDe([
      obs('Mercadona', 100, 1, dia(-30)),
      obs('Mercadona', 120, 1, dia(-1)),
      obs('Lidl', 660, 6, dia(-2))
    ]);
    expect(mejor).toEqual({ tienda: 'Lidl', precioUnitarioMinor: 110 });
  });

  it('la sugerencia lleva el precio estimado de su mejor tienda', () => {
    const filas = sugerir(
      [fila('Leche entera', 1, { cadaDias: 7, unidadesPorCompra: 6 })],
      new Map(),
      {
        precios: new Map([
          ['leche entera', [obs('Mercadona', 120, 1, dia(-1)), obs('Lidl', 110, 1, dia(-2))]]
        ])
      }
    );
    expect(filas[0]).toMatchObject({
      mejorTienda: 'Lidl',
      precioUnitarioMinor: 110,
      precioEstimadoMinor: 660
    });
  });

  it('el orden es por prisa: caduca, sin stock, se acaba y el plan; y hay tope', () => {
    const filas = sugerir(
      [
        fila('Arroz del plan', 0, { cadaDias: 7, unidadesPorCompra: 1 }), // sin stock, abajo
        fila('Yogur natural', 6, { daysLeft: 0, cadaDias: 3, unidadesPorCompra: 3 }) // caduca, arriba
      ],
      new Map(),
      { plan: [{ name: 'Ternera', quantity: 400, unit: 'g' }] }
    );
    expect(filas.map((f) => f.motivo)).toEqual(['caduca', 'sin_stock', 'para_el_plan']);
    expect(filas.map((f) => f.name)).toEqual(['Yogur natural', 'Arroz del plan', 'Ternera']);
  });

  it('dos filas de la misma clave son un producto: el stock se suma', () => {
    const porClave = productosSugeribles(
      [
        fila('Leche entera', 1, { cadaDias: 7, unidadesPorCompra: 6, daysLeft: 9 }),
        fila('Leche entera', 2, { daysLeft: 3 })
      ],
      [],
      new Map()
    );
    expect(porClave.get('leche entera')).toMatchObject({ quantity: 3, daysLeft: 3, cadaDias: 7 });
  });

  it(`el horizonte es ${HORIZONTE_DIAS} dias: lo que dura justo eso no se sugiere`, () => {
    // 1 unidad que dura exactamente 7 dias: llega justito, no hay sugerencia.
    const filas = sugerir([fila('Kefir', 1, { cadaDias: 7, unidadesPorCompra: 1 })]);
    expect(filas).toHaveLength(0);
  });
});
