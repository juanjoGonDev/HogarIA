import { describe, expect, it } from 'vitest';
import { lineasNuevas } from './ticket-lines-stream.js';

/**
 * El extractor incremental (## 12aj) es lo que hace honesto el «poco a poco»: si esto se rompe,
 * las lineas llegan todas de golpe (o no llegan). Los casos que importan: una linea que se cierra
 * se entrega UNA vez; la que sigue a medias no; las llaves dentro de cadenas no enganan al
 * contador; y lo ya entregado no se vuelve a entregar.
 */
describe('lineasNuevas (## 12aj)', () => {
  it('una linea completa se entrega, y la que sigue a medias no', () => {
    const buffer = '{"store":"Mercadona","lines":[{"name":"Leche","priceMinor":195},{"name":"Pan';
    const primeras = lineasNuevas(buffer, 0);
    expect(primeras).toHaveLength(1);
    expect(JSON.parse(primeras[0].crudo)).toEqual({ name: 'Leche', priceMinor: 195 });
  });

  it('cuando llega el resto de la segunda, se entrega solo ella', () => {
    const antes = '{"store":"Mercadona","lines":[{"name":"Leche","priceMinor":195}';
    const despues =
      '{"store":"Mercadona","lines":[{"name":"Leche","priceMinor":195},{"name":"Pan","priceMinor":120}';
    expect(lineasNuevas(antes, 0)).toHaveLength(1);
    const segundas = lineasNuevas(despues, 1);
    expect(segundas).toHaveLength(1);
    expect(JSON.parse(segundas[0].crudo)).toEqual({ name: 'Pan', priceMinor: 120 });
  });

  it('una llave DENTRO de una cadena no cierra el objeto antes de tiempo', () => {
    const buffer = '{"lines":[{"name":"Queso","note":"el de la caja {roja}","priceMinor":340}';
    const extraidas = lineasNuevas(buffer, 0);
    expect(extraidas).toHaveLength(1);
    expect(JSON.parse(extraidas[0].crudo)).toEqual({
      name: 'Queso',
      note: 'el de la caja {roja}',
      priceMinor: 340
    });
  });

  it('un escape dentro de una cadena tampoco rompe el conteo', () => {
    const buffer = '{"lines":[{"name":"Yogur \\"griego\\"","priceMinor":150}';
    const extraidas = lineasNuevas(buffer, 0);
    expect(JSON.parse(extraidas[0].crudo)).toEqual({ name: 'Yogur "griego"', priceMinor: 150 });
  });

  it('sin el array de lines todavia no hay nada', () => {
    expect(lineasNuevas('{"store":"Mercadona","total', 0)).toEqual([]);
    expect(lineasNuevas('Estoy pensando...', 0)).toEqual([]);
  });

  it('el array cerrado no inventa lineas nuevas despues', () => {
    const buffer = '{"lines":[{"name":"Leche"}],"totalMinor":195,"warnings":["nada"]}';
    expect(lineasNuevas(buffer, 0)).toHaveLength(1);
    expect(lineasNuevas(buffer, 1)).toHaveLength(0);
  });

  it('muchas lineas seguidas se entregan en orden y sin repetirse', () => {
    const buffer = `{"lines":[${[1, 2, 3, 4, 5]
      .map((n) => `{"name":"Producto ${n}","priceMinor":${n * 100}}`)
      .join(',')}`;
    const todas = lineasNuevas(buffer, 0);
    expect(todas.map((linea) => JSON.parse(linea.crudo).name)).toEqual([
      'Producto 1',
      'Producto 2',
      'Producto 3',
      'Producto 4',
      'Producto 5'
    ]);
  });
});
