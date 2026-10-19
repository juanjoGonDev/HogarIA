import {
  caminoDe,
  geometria,
  seriesPorTienda,
  type PuntoPrecio,
  type SerieTienda
} from './precio-chart.util';
import type { PriceObservation } from '../../shared/models/shopping.model';

/**
 * La grafica de precios (## 12ai) tiene tres formas de mentir sin que nadie lo note: contar
 * tickets en vez de precios por unidad, aplastar el eje Y contra el cero, o colapsar el eje X
 * cuando la historia es de un solo dia. Las tres se prueban aqui, con datos sinteticos que
 * un e2e no sabria sembrar (el API siempre sella «ahora»).
 */

function observacion(
  tienda: string | null,
  minor: number,
  dias: number,
  cantidad = 1
): PriceObservation {
  return {
    id: `${tienda ?? 'sin'}-${dias}-${minor}`,
    product_name: 'Leche entera',
    product_key: 'leche entera',
    store_name: tienda,
    price_minor: minor,
    quantity: cantidad,
    observed_at: new Date(Date.UTC(2026, 0, 1 + dias, 10, 30)).toISOString(),
    observations: 1
  };
}

describe('seriesPorTienda (## 12ai)', () => {
  it('reparte por tienda y compara PRECIOS POR UNIDAD: un pack de 2 no es el doble de caro', () => {
    const series = seriesPorTienda([
      observacion('Mercadona', 170, 0, 1),
      observacion('Lidl', 340, 1, 2),
      observacion('Mercadona', 190, 20, 1)
    ]);
    expect(series.map((serie) => serie.tienda)).toEqual(['Lidl', 'Mercadona']);
    const mercadona = series[1];
    expect(mercadona.puntos.map((punto) => punto.minor)).toEqual([170, 190]);
    expect(mercadona.ultimo).toBe(190);
    expect(mercadona.media).toBe(180);
    expect(mercadona.observaciones).toBe(2);
    expect(series[0].puntos[0].minor).toBe(170); // 340 / 2 unidades
  });

  it('cada tienda lleva su color de la paleta, y «sin tienda» va al final con su hueco perdonado', () => {
    const series = seriesPorTienda([
      observacion(null, 100, 0),
      observacion('Mercadona', 100, 1),
      observacion('Lidl', 100, 2)
    ]);
    expect(series.map((serie) => serie.tienda)).toEqual(['Lidl', 'Mercadona', null]);
    const colores = new Set(series.map((serie) => serie.color));
    expect(colores.size).toBe(3);
  });

  it('dos observaciones del mismo instante: «el ultimo» es el que el API conto primero (llega DESC)', () => {
    // El caso del e2e: dos precios apuntados el mismo segundo. El API los trae de nuevo a
    // viejo, asi que el primero de la respuesta es el ultimo que paso —y un sort estable
    // sin desempate dejaba el «ultimo» exactamente al reves.
    const series = seriesPorTienda([
      observacion('Mercadona', 180, 0),
      observacion('Mercadona', 175, 0)
    ]);
    expect(series[0].ultimo).toBe(180);
    expect(series[0].puntos.map((punto) => punto.minor)).toEqual([175, 180]);
  });

  it('una fila rota (fecha o precio que no son nada) no tira la serie entera', () => {
    const rota = { ...observacion('Mercadona', 100, 0), observed_at: 'eso no era una fecha' };
    const series = seriesPorTienda([rota, observacion('Mercadona', 120, 5)]);
    expect(series.length).toBe(1);
    expect(series[0].observaciones).toBe(1);
  });

  it('sin observaciones no hay series: el vacio lo pone la pantalla, no la grafica', () => {
    expect(seriesPorTienda([])).toEqual([]);
  });
});

describe('geometria (## 12ai)', () => {
  const serie = (puntos: PuntoPrecio[], tienda = 'Mercadona'): SerieTienda => ({
    tienda,
    color: '#000',
    puntos,
    ultimo: puntos.at(-1)?.minor ?? 0,
    media: puntos.length
      ? Math.round(puntos.reduce((suma, punto) => suma + punto.minor, 0) / puntos.length)
      : 0,
    observaciones: puntos.length
  });
  const DIA = 24 * 3600 * 1000;
  const base = Date.UTC(2026, 0, 1);

  it('el eje Y respira un 8% por los dos lados y no empieza en cero cuando vive lejos', () => {
    const g = geometria([
      serie([
        { ms: base, minor: 180 },
        { ms: base + 10 * DIA, minor: 220 }
      ])
    ])!;
    expect(g.minorMin).toBeGreaterThan(170);
    expect(g.minorMin).toBeLessThan(180);
    expect(g.minorMax).toBeGreaterThan(220);
    // Y las cuatro marcas caben entre los margenes.
    for (const marca of g.marcasY) expect(marca.pos).toBeGreaterThanOrEqual(g.arriba);
  });

  it('un solo precio no colapsa el eje: ±10 centimos de aire', () => {
    const g = geometria([serie([{ ms: base, minor: 150 }])])!;
    expect(g.minorMin).toBe(140);
    expect(g.minorMax).toBe(160);
  });

  it('un solo dia no colapsa el eje X: un dia de aire a cada lado', () => {
    const g = geometria([
      serie([
        { ms: base, minor: 100 },
        { ms: base, minor: 120 }
      ])
    ])!;
    expect(g.msMax - g.msMin).toBeGreaterThanOrEqual(DIA);
  });

  it('x e y son cres: mas fecha mas a la derecha, mas precio mas arriba', () => {
    const g = geometria([
      serie([
        { ms: base, minor: 100 },
        { ms: base + 10 * DIA, minor: 300 }
      ])
    ])!;
    expect(g.x(base + 10 * DIA)).toBeGreaterThan(g.x(base));
    expect(g.y(300)).toBeLessThan(g.y(100));
    expect(g.x(base)).toBe(g.izq);
  });

  it('sin puntos no hay geometria', () => {
    expect(geometria([])).toBeNull();
    expect(geometria([serie([])])).toBeNull();
  });
});

describe('caminoDe (## 12ai)', () => {
  it('empieza en M y sigue en L, con las coordenadas ya resueltas', () => {
    const puntos: PuntoPrecio[] = [
      { ms: Date.UTC(2026, 0, 1), minor: 100 },
      { ms: Date.UTC(2026, 0, 2), minor: 120 },
      { ms: Date.UTC(2026, 0, 3), minor: 110 }
    ];
    const serie: SerieTienda = {
      tienda: 'Lidl',
      color: '#000',
      puntos,
      ultimo: 110,
      media: 110,
      observaciones: 3
    };
    const g = geometria([serie])!;
    const camino = caminoDe(serie, g);
    const pasos = camino.split(' ');
    expect(pasos[0].startsWith('M')).toBeTrue();
    expect(pasos[1].startsWith('L')).toBeTrue();
    expect(pasos[2].startsWith('L')).toBeTrue();
  });
});
