import { describe, expect, it } from 'vitest';
import type { Offer } from './list-discount.js';
import {basketMoney, describeDiscount, describeLineDiscount, normalizeOffer, paidUnits, shareDiscount,
  isEligibleForDiscount,
  type MoneyLine
} from './list-discount.js';

/**
 * El unico modulo del proyecto donde se puede perder un centavo. Las tablas de aqui
 * son las que sostienen los numeros que alguien va a contrastar con un ticket, asi
 * que cada caso escribe tambien POR QUE existe (que es lo que falta cuando alguien
 * «simplifica» la formula dentro de seis meses).
 */

describe('paidUnits', () => {
  it('sin oferta se paga lo que se lleva', () => {
    expect(paidUnits(3, null)).toBe(3);
    expect(paidUnits(3, undefined)).toBe(3);
  });

  it('3×2: cada tres, se pagan dos', () => {
    expect(paidUnits(6, { buy: 3, take: 2 })).toBe(4);
    // La cola que no llena un pack se paga suelta, pero nunca mas de lo que cuesta
    // dentro de un pack: dos sueltas de un 3×2 valen dos, no tres.
    expect(paidUnits(5, { buy: 3, take: 2 })).toBe(4);
    expect(paidUnits(8, { buy: 3, take: 2 })).toBe(6);
    expect(paidUnits(2, { buy: 3, take: 2 })).toBe(2);
    expect(paidUnits(1, { buy: 3, take: 2 })).toBe(1);
  });

  it('2×1: la mitad, redondeando hacia arriba', () => {
    expect(paidUnits(4, { buy: 2, take: 1 })).toBe(2);
    expect(paidUnits(5, { buy: 2, take: 1 })).toBe(3);
    expect(paidUnits(1, { buy: 2, take: 1 })).toBe(1);
  });

  it('funciona con cantidades fraccionales (el kilo no es entero)', () => {
    // Un 3×2 sobre 1,5 kg: no hay pack completo, se paga lo que hay. Nadie deberia
    // poner una oferta por peso, pero el numero no puede salir negativo ni raro.
    expect(paidUnits(1.5, { buy: 3, take: 2 })).toBe(1.5);
    expect(paidUnits(4.5, { buy: 3, take: 2 })).toBe(3.5);
  });

  it('una oferta que no ahorra nada no es una oferta', () => {
    expect(paidUnits(4, { buy: 4, take: 4 })).toBe(4);
    expect(paidUnits(4, { buy: 2, take: 0 })).toBe(4);
    expect(paidUnits(0, { buy: 3, take: 2 })).toBe(0);
  });
});

describe('normalizeOffer', () => {
  it('lo que no ahorra se convierte en «sin oferta»', () => {
    expect(normalizeOffer({ buy: 3, take: 3 })).toBeNull();
    expect(normalizeOffer({ buy: 1, take: 1 })).toBeNull();
    expect(normalizeOffer(null)).toBeNull();
    expect(normalizeOffer({ buy: 3, take: 2 })).toEqual({ buy: 3, take: 2 });
  });

  it('redondea hacia abajo: 2,7 unidades de un pack no existen', () => {
    expect(normalizeOffer({ buy: 3.9, take: 2.9 })).toEqual({ buy: 3, take: 2 });
  });
});

describe('basketMoney', () => {
  const line = (itemId: string, quantity: number, unitMinor: number | null, offer: Offer | null = null) => ({
    itemId,
    quantity,
    unitMinor,
    offer
  });

  it('sin oferta ni descuento es lo de siempre: precio por unidad por cantidad', () => {
    const money = basketMoney({ lines: [line('a', 3, 100), line('b', 1, 250)] });
    expect(money.subtotalMinor).toBe(550);
    expect(money.totalMinor).toBe(550);
    expect(money.discount).toBeNull();
    expect(money.discountMinor).toBe(0);
  });

  it('la oferta baja lo que se paga ANTES de sumar', () => {
    const money = basketMoney({ lines: [line('a', 6, 100, { buy: 3, take: 2 })] });
    expect(money.lines[0]).toMatchObject({ grossMinor: 400, offerSavingsMinor: 200, paidUnits: 4 });
    expect(money.subtotalMinor).toBe(400);
    expect(money.offerSavingsMinor).toBe(200);
  });

  it('un porcentaje en puntos porcentuales no comete errores de float', () => {
    // 12,5 % de 800 son 100 exactos; con floats «0.125 * 800» tambien, pero
    // 12,34 % de 12 345 no, y esa es la forma en la que se rompe una cesta.
    const money = basketMoney({
      lines: [line('a', 8, 100)],
      discount: { kind: 'percent', percentBps: 1250, valueMinor: null, scope: 'all', firstUnits: null }
    });
    expect(money.subtotalMinor).toBe(800);
    expect(money.discountMinor).toBe(100);
    expect(money.totalMinor).toBe(700);
  });

  it('un importe se aplica y no deja el total en negativo', () => {
    const money = basketMoney({
      lines: [line('a', 3, 100)],
      discount: { kind: 'amount', valueMinor: 200, percentBps: null, scope: 'all', firstUnits: null }
    });
    expect(money.totalMinor).toBe(100);

    const over = basketMoney({
      lines: [line('a', 3, 100)],
      discount: { kind: 'amount', valueMinor: 10_000, percentBps: null, scope: 'all', firstUnits: null }
    });
    expect(over.discountMinor).toBe(300);
    expect(over.totalMinor).toBe(0);
    // Y se dice, en vez de pintar «-97,00 €» o de callar el recorte.
    expect(over.discount?.reason).toBe('clampedToZero');
  });

  it('un descuento sin valor no es un descuento, es ruido en la pantalla', () => {
    // La API no deja guardar un 0, pero la funcion es publica y alguien la llamara con
    // datos viejos o con una hoja de calculo: mejor decir «noValue» que pintar «-0,00 €».
    const emptyPercent = basketMoney({
      lines: [line('a', 2, 100)],
      discount: { kind: 'percent', percentBps: 0, valueMinor: null, scope: 'all', firstUnits: null }
    });
    expect(emptyPercent.discountMinor).toBe(0);
    expect(emptyPercent.discount?.reason).toBe('noValue');

    const emptyAmount = basketMoney({
      lines: [line('a', 2, 100)],
      discount: { kind: 'amount', valueMinor: 0, percentBps: null, scope: 'all', firstUnits: null }
    });
    expect(emptyAmount.discountMinor).toBe(0);
    expect(emptyAmount.discount?.reason).toBe('noValue');
  });

  it('«descuento en las primeras N unidades» solo recorta el porcentaje de esas N', () => {
    const money = basketMoney({
      lines: [line('a', 5, 100)],
      discount: {
        kind: 'percent',
        percentBps: 1000,
        valueMinor: null,
        scope: 'firstUnits',
        firstUnits: 2
      }
    });
    // 10 % de los 200 centimos de las dos primeras unidades, no de los 500.
    expect(money.discount?.applicableMinor).toBe(200);
    expect(money.discountMinor).toBe(20);
  });

  it('un importe minimo por unidades no alcanzado no descuenta, y lo explica', () => {
    const money = basketMoney({
      lines: [line('a', 2, 100)],
      discount: { kind: 'amount', valueMinor: 200, percentBps: null, scope: 'firstUnits', firstUnits: 3 }
    });
    expect(money.discountMinor).toBe(0);
    expect(money.totalMinor).toBe(200);
    expect(money.discount?.reason).toBe('thresholdNotReached');
  });

  it('la linea sin precio cuenta como unidad pero no como importe', () => {
    const money = basketMoney({
      lines: [line('a', 3, 100), line('b', 2, null)],
      discount: { kind: 'percent', percentBps: 5000, valueMinor: null, scope: 'firstUnits', firstUnits: 4 }
    });
    // Las 2 unidades sin precio no aportan importe y tampoco comen tope: «el 50 % de
    // las 4 primeras unidades» sobre 3 con precio sale de 300, no de repartir el
    // descuento por cartones que nadie ha valorado.
    expect(money.discount?.applicableUnits).toBe(3);
    expect(money.discount?.applicableMinor).toBe(300);
    expect(money.discountMinor).toBe(150);
  });

  it('una cesta vacia no divide por cero', () => {
    const money = basketMoney({
      lines: [],
      discount: { kind: 'percent', percentBps: 1000, valueMinor: null, scope: 'all', firstUnits: null }
    });
    expect(money.totalMinor).toBe(0);
    expect(money.discount?.reason).toBe('emptyBasket');
  });
});

describe('shareDiscount', () => {
  it('los trozos suman EXACTAMENTE el descuento, ni un centimo suelto', () => {
    const lines = [
      { itemId: 'a', netMinor: 100 },
      { itemId: 'b', netMinor: 100 },
      { itemId: 'c', netMinor: 100 }
    ];
    const shares = shareDiscount(lines, 100);
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    expect([...shares.values()].sort()).toEqual([33, 33, 34]);
  });

  it('una cesta sin importe reparte ceros', () => {
    const shares = shareDiscount([{ itemId: 'a', netMinor: 0 }], 100);
    expect(shares.get('a')).toBe(0);
  });
});

describe('describeDiscount', () => {
  it('un porcentaje se lee como se escribe en el cartel', () => {
    expect(
      describeDiscount({ kind: 'percent', percentBps: 1250, valueMinor: null, scope: 'all', firstUnits: null })
    ).toBe('12,5 %');
  });

  it('un importe lleva sus decimales y la capa de unidades si la hay', () => {
    expect(
      describeDiscount({ kind: 'amount', valueMinor: 200, percentBps: null, scope: 'firstUnits', firstUnits: 3 })
    ).toBe('2,00 € en 3 unidades');
  });

  it('la etiqueta que puso la persona va delante', () => {
    expect(
      describeDiscount({
        kind: 'amount',
        valueMinor: 300,
        percentBps: null,
        scope: 'all',
        firstUnits: null,
        label: 'Fidelidad'
      })
    ).toBe('Fidelidad · 3,00 €');
  });

  it('sin descuento, nada que decir', () => {
    expect(describeDiscount(null)).toBeNull();
  });
});

describe('descuentos por producto y por seccion', () => {
  const line = (over: Partial<MoneyLine> = {}): MoneyLine => ({
    itemId: 'a',
    quantity: 2,
    unitMinor: 500,
    offer: null,
    productKey: 'jamon serrano',
    category: 'Carne y pescado',
    ...over
  });

  it('el importe se calcula solo sobre la linea que encaja', () => {
    const money = basketMoney({
      lines: [line(), line({ itemId: 'b', productKey: 'leche semidesnatada', category: 'Lacteos' })],
      discount: { kind: 'amount', valueMinor: 200, percentBps: null, scope: 'product', firstUnits: null, target: 'Jamón Serrano' }
    });
    expect(money.discountMinor).toBe(200);
    expect(money.discount?.applicableMinor).toBe(1000);
    // El reparto tampoco salpica a la leche: si salpicara, «descuento en X» baratearia Y.
    const jamon = money.lines.find(l => l.itemId === 'a')!;
    const leche = money.lines.find(l => l.itemId === 'b')!;
    expect(jamon.netMinor).toBe(800);
    expect(leche.netMinor).toBe(1000);
  });

  it('compara por clave normalizada, no por el texto exacto', () => {
    const money = basketMoney({
      lines: [line({ productKey: 'jamon  serrano' })],
      discount: { kind: 'percent', valueMinor: null, percentBps: 1000, scope: 'product', firstUnits: null, target: 'JAMÓN  Serrano!' }
    });
    expect(money.discount?.applied).toBe(true);
    expect(money.discountMinor).toBe(100);
  });

  it('por seccion entra todo el pasillo y nada mas', () => {
    const money = basketMoney({
      lines: [line(), line({ itemId: 'b', category: 'Lacteos', productKey: 'leche' })],
      discount: { kind: 'percent', valueMinor: null, percentBps: 1000, scope: 'category', firstUnits: null, target: 'carne y pescado' }
    });
    expect(money.discount?.applicableMinor).toBe(1000);
    expect(money.lines.find(l => l.itemId === 'b')!.netMinor).toBe(1000);
  });

  it('sin ninguna linea que encaja, lo dice: no es un descuento de cero', () => {
    const money = basketMoney({
      lines: [line({ productKey: 'leche', category: 'Lacteos' })],
      discount: { kind: 'amount', valueMinor: 200, percentBps: null, scope: 'product', firstUnits: null, target: 'jamon' }
    });
    expect(money.discountMinor).toBe(0);
    expect(money.discount?.reason).toBe('noMatchingLine');
  });

  it('el importe no puede superar lo que cubre, y se sigue diciendo', () => {
    const money = basketMoney({
      lines: [line(), line({ itemId: 'b', productKey: 'otro', category: 'Lacteos' })],
      discount: { kind: 'amount', valueMinor: 5000, percentBps: null, scope: 'product', firstUnits: null, target: 'jamon serrano' }
    });
    expect(money.discountMinor).toBe(1000);
    expect(money.discount?.reason).toBe('clampedToZero');
  });

  it('la frase del descuento nombra el producto', () => {
    expect(describeDiscount({ kind: 'amount', valueMinor: 200, percentBps: null, scope: 'product', firstUnits: null, target: 'Jamón Serrano' })).toContain('en Jamón Serrano');
    expect(describeDiscount({ kind: 'percent', valueMinor: null, percentBps: 1500, scope: 'category', firstUnits: null, target: 'Frutas y verduras' })).toContain('en Frutas y verduras');
  });

  it('isEligibleForDiscount: los alcances sin objetivo sirven para todas las lineas', () => {
    for (const scope of ['all', 'firstUnits'] as const) {
      expect(isEligibleForDiscount(line(), { kind: 'amount', valueMinor: 100, percentBps: null, scope, firstUnits: 1, target: null })).toBe(true);
    }
    expect(isEligibleForDiscount(line(), { kind: 'amount', valueMinor: 100, percentBps: null, scope: 'product', firstUnits: null, target: null })).toBe(false);
  });
});

describe('varias dianas en un mismo descuento', () => {
  const row = (over: Partial<MoneyLine> = {}): MoneyLine => ({
    itemId: 'a',
    quantity: 1,
    unitMinor: 1000,
    offer: null,
    productKey: 'jamon serrano',
    category: 'Charcuteria',
    ...over
  });

  const money = (discount: Parameters<typeof basketMoney>[0]['discount'], lines: MoneyLine[]) =>
    basketMoney({ lines, discount });

  it('«2,50 € en jamon y queso» baja esas dos lineas y no la tercera', () => {
    const result = money(
      {
        kind: 'amount',
        valueMinor: 250,
        percentBps: null,
        scope: 'product',
        firstUnits: null,
        target: null,
        targets: ['jamon serrano', 'queso curado']
      },
      [
        row({ itemId: 'a' }),
        row({ itemId: 'b', productKey: 'queso curado', category: 'Lacteos', unitMinor: 600 }),
        row({ itemId: 'c', productKey: 'leche', category: 'Lacteos', unitMinor: 100 })
      ]
    );
    // La base del descuento son SOLO las dos lineas con nombre (1600), y el total paga
    // la cesta entera menos el recorte: ni la leche se entera, ni el recorte se pierde.
    expect(result.discount?.applicableMinor).toBe(1600);
    expect(result.discountMinor).toBe(250);
    expect(result.totalMinor).toBe(1700 - 250);
    expect(result.lines.find((l) => l.itemId === 'c')!.netMinor).toBe(100);
    expect(result.lines.find((l) => l.itemId === 'a')!.discounted).toBe(true);
    expect(result.lines.find((l) => l.itemId === 'c')!.discounted).toBe(false);
  });

  it('el porcentaje sobre x productos sale del subtotal de esos x, no de la cesta', () => {
    const result = money(
      {
        kind: 'percent',
        valueMinor: null,
        percentBps: 1000,
        scope: 'product',
        firstUnits: null,
        targets: ['jamon serrano', 'queso curado']
      },
      [row(), row({ itemId: 'b', productKey: 'queso curado', unitMinor: 600 }), row({ itemId: 'c', productKey: 'leche', unitMinor: 4000 })]
    );
    // 10 % de 1600 son 160, no 560. El cartel del pasillo habla de dos productos.
    expect(result.discountMinor).toBe(160);
  });

  it('la diana normaliza acentos y mayusculas, pero no adivina: «Jamón» no es «Jamón Serrano»', () => {
    const discount = {
      kind: 'amount' as const,
      valueMinor: 100,
      percentBps: null,
      scope: 'product' as const,
      firstUnits: null,
      target: null,
      targets: ['  JAMÓN SERRANO ']
    };
    expect(isEligibleForDiscount({ productKey: 'jamon serrano', name: 'Jamón Serrano' }, discount)).toBe(true);
    // Comparar por prefijo haria que «pan» se comiera tambien «pan rallado» y «pan de
    // hamburguesa»: un descuento aplicado a lineas que nadie eligió. El picker de la hoja
    // existe para esto; si aun asi se escribe a mano, la otra asercion es el contrato.
    expect(isEligibleForDiscount({ productKey: 'pan de molde', name: 'Pan de molde' }, { ...discount, targets: ['pan'] })).toBe(false);
  });

  it('ninguna diana de la cesta: lo dice, no un descuento de 0 €', () => {
    const result = money({ kind: 'amount', valueMinor: 200, percentBps: null, scope: 'product', firstUnits: null, targets: ['pan', 'huevos'] }, [row()]);
    expect(result.discountMinor).toBe(0);
    expect(result.discount?.reason).toBe('noMatchingLine');
  });

  it('el alcance por seccion admite varias secciones a la vez', () => {
    const result = money(
      { kind: 'percent', valueMinor: null, percentBps: 500, scope: 'category', firstUnits: null, targets: ['Frutas', 'Verduras'] },
      [
        row({ itemId: 'a', category: 'Frutas', productKey: 'manzana' }),
        row({ itemId: 'b', category: 'Verduras', productKey: 'tomate' }),
        row({ itemId: 'c', category: 'Lacteos', productKey: 'leche' })
      ]
    );
    expect(result.discount?.applicableMinor).toBe(2000);
    expect(result.discountMinor).toBe(100);
  });

  it('una sola diana sigue valiendo: la forma antigua de la fila no se retira', () => {
    const result = money({ kind: 'amount', valueMinor: 200, percentBps: null, scope: 'product', firstUnits: null, target: 'jamon serrano' }, [
      row(),
      row({ itemId: 'b', productKey: 'leche' })
    ]);
    expect(result.discountMinor).toBe(200);
  });

  it('la frase del descuento enumera las dianas y dice cuantas faltan', () => {
    const one = describeDiscount({ kind: 'amount', valueMinor: 250, percentBps: null, scope: 'product', firstUnits: null, targets: ['Jamon Serrano'] });
    const two = describeDiscount({ kind: 'amount', valueMinor: 250, percentBps: null, scope: 'product', firstUnits: null, targets: ['Jamon Serrano', 'Queso curado'] });
    const many = describeDiscount({
      kind: 'percent',
      valueMinor: null,
      percentBps: 1000,
      scope: 'product',
      firstUnits: null,
      targets: ['Jamon', 'Queso', 'Pan', 'Leche']
    });
    expect(one).toBe('2,50 € en Jamon Serrano');
    expect(two).toBe('2,50 € en Jamon Serrano y Queso curado');
    expect(many).toBe('10 % en Jamon, Queso y +2 mas');
  });
});

describe('descuento propio de una linea (§12h)', () => {
  const row = (over: Partial<MoneyLine> = {}): MoneyLine => ({
    itemId: 'a',
    quantity: 3,
    unitMinor: 100,
    offer: null,
    ...over
  });

  it('el porcentaje se aplica a la linea, no a la cesta', () => {
    const money = basketMoney({
      lines: [row({ discount: { kind: 'percent', valueMinor: null, percentBps: 1000, units: null } }), row({ itemId: 'b' })]
    });
    // 10 % de 300 (tres unidades a 1,00) = 30; la otra linea sigue a 300.
    expect(money.lines[0].lineDiscountMinor).toBe(30);
    expect(money.lines[0].netMinor).toBe(270);
    expect(money.lines[1].netMinor).toBe(300);
    expect(money.subtotalMinor).toBe(570);
    expect(money.lineDiscountMinor).toBe(30);
  });

  it('el importe baja la linea y no la deja en negativo', () => {
    const money = basketMoney({ lines: [row({ unitMinor: 95, quantity: 1, discount: { kind: 'amount', valueMinor: 200, percentBps: null, units: null } })] });
    expect(money.lines[0].lineDiscountMinor).toBe(95);
    expect(money.lines[0].netMinor).toBe(0);
    // Se recorta y se dice: «-2 €» en una linea de 0,95 no devuelve 1,05 al resto de la cesta.
    expect(money.lines[0].lineDiscount?.reason).toBe('clamped');
  });

  it('primero la oferta, despues el descuento de la linea', () => {
    const money = basketMoney({
      lines: [row({ quantity: 6, unitMinor: 100, offer: { buy: 3, take: 2 }, discount: { kind: 'percent', valueMinor: null, percentBps: 500, units: null } })]
    });
    // 6 llevadas, 4 pagadas (3x2) = 400; 5 % de lo que se PAGA = 20. Al reves (5 % de 600)
    // la misma cesta daria otro numero y nadie sabria cual es el del ticket.
    expect(money.lines[0].offerSavingsMinor).toBe(200);
    expect(money.lines[0].lineDiscountMinor).toBe(20);
    expect(money.lines[0].netMinor).toBe(380);
  });

  it('«solo sobre las primeras N unidades» recorta esa fraccion y nada mas', () => {
    const money = basketMoney({
      lines: [row({ quantity: 4, unitMinor: 250, discount: { kind: 'amount', valueMinor: 300, percentBps: null, units: 2 } })]
    });
    // 3,00 € de descuento a las 2 primeras (500): la linea de 10,00 acaba en 7,00.
    expect(money.lines[0].lineDiscountMinor).toBe(300);
    expect(money.lines[0].lineDiscount?.appliedUnits).toBe(2);
    expect(money.lines[0].netMinor).toBe(700);
  });

  it('no llegan las unidades pedidas: se aplica a lo que hay, y consta por que', () => {
    const money = basketMoney({
      lines: [row({ quantity: 1, unitMinor: 250, discount: { kind: 'amount', valueMinor: 300, percentBps: null, units: 3 } })]
    });
    expect(money.lines[0].lineDiscount?.appliedUnits).toBe(1);
    expect(money.lines[0].lineDiscount?.reason).toBe('fewerUnits');
    expect(money.lines[0].lineDiscountMinor).toBe(250);
  });

  it('el descuento de la linea es la base sobre la que actua el cupon de la cesta', () => {
    const money = basketMoney({
      lines: [
        row({ quantity: 1, unitMinor: 1000, discount: { kind: 'amount', valueMinor: 200, percentBps: null, units: null } }),
        row({ itemId: 'b', quantity: 1, unitMinor: 500 })
      ],
      discount: { kind: 'percent', valueMinor: null, percentBps: 1000, scope: 'all', firstUnits: null }
    });
    // 8,00 + 5,00 = 13,00; el 10 % de la cesta es 1,30, no 1,50. El descuento del jamon ya
    // estaba puesto antes de pasar el cupon, que es el orden de la caja.
    expect(money.subtotalMinor).toBe(1300);
    expect(money.discountMinor).toBe(130);
    expect(money.totalMinor).toBe(1170);
  });

  it('sin valor no hay descuento, y la frase lo cuenta', () => {
    const empty = basketMoney({ lines: [row({ discount: { kind: 'percent', valueMinor: null, percentBps: 0, units: null } })] });
    expect(empty.lines[0].lineDiscountMinor).toBe(0);
    expect(empty.lines[0].lineDiscount?.reason).toBe('noValue');
    expect(describeLineDiscount({ kind: 'percent', valueMinor: null, percentBps: 1500, units: null })).toBe('15 %');
    expect(describeLineDiscount({ kind: 'amount', valueMinor: 250, percentBps: null, units: 2 })).toBe('2,50 € en 2 unidades');
    expect(describeLineDiscount(null)).toBeNull();
  });
});
