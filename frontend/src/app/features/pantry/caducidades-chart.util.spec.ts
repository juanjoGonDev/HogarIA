import { barrasDeCaducidad } from './caducidades-chart.util';
import { CaducidadRow } from '../../shared/models/caducidades.model';

/**
 * La grafica de caducidades (## 12ak): lo que se fija aqui es el ORDEN (la prisa manda), la
 * anchura proporcional con suelo del 4%, el color del semaforo y que lo estimado se vea como
 * estimado. Sin DOM: la barra es un numero y una clase, y pintarla es cosa de la plantilla.
 */

function fila(nombre: string, daysLeft: number | null, source: CaducidadRow['shelfSource'] = 'fecha'): CaducidadRow {
  return {
    id: nombre,
    name: nombre,
    category: 'other',
    quantity: 1,
    unit: 'ud',
    expirationDate: null,
    estimatedDays: null,
    shelfSource: source,
    vence: null,
    daysLeft,
    cadaDias: null,
    unidadesPorCompra: null,
    duraDias: null,
    lastBought: null
  };
}

describe('barrasDeCaducidad', () => {
  it('la prisa manda: caducado, luego 2 dias, luego 20, y sin fecha al final', () => {
    const { barras } = barrasDeCaducidad([fila('Arroz', 20), fila('Pescado', -1), fila('Sin saber', null), fila('Leche', 2)]);
    expect(barras.map((barra) => barra.nombre)).toEqual(['Pescado', 'Leche', 'Arroz', 'Sin saber']);
  });

  it('la anchura es proporcional al maximo, con suelo del 4% para lo que ya vencio', () => {
    const { barras } = barrasDeCaducidad([fila('Arroz', 20), fila('Pescado', -1), fila('Leche', 2)]);
    const porNombre = new Map(barras.map((barra) => [barra.nombre, barra]));
    expect(porNombre.get('Arroz')?.anchura).toBe(100);
    expect(porNombre.get('Leche')?.anchura).toBe(10);
    expect(porNombre.get('Pescado')?.anchura).toBe(4);
  });

  it('el color es el semaforo: caducado, critico, semana, quincena, lejos y sin fecha', () => {
    const { barras } = barrasDeCaducidad([
      fila('A', -2),
      fila('B', 2),
      fila('C', 6),
      fila('D', 12),
      fila('E', 40),
      fila('F', null)
    ]);
    const colores = barras.map((barra) => barra.urgencia);
    expect(colores).toEqual(['caducado', 'critico', 'semana', 'quincena', 'lejos', 'sin']);
  });

  it('lo estimado por IA o catalogo lleva su marca, la fecha registrada no', () => {
    const { barras } = barrasDeCaducidad([fila('Pan', 4, 'catalogo'), fila('Quinoa', 30, 'ia'), fila('Yogur', 3, 'fecha')]);
    const porNombre = new Map(barras.map((barra) => [barra.nombre, barra]));
    expect(porNombre.get('Pan')?.estimada).toBeTrue();
    expect(porNombre.get('Quinoa')?.estimada).toBeTrue();
    expect(porNombre.get('Yogur')?.estimada).toBeFalse();
  });

  it('con mas productos que huecos se corta y se cuentan los que sobran', () => {
    const muchas = Array.from({ length: 15 }, (_, i) => fila(`Producto ${i}`, i));
    const { barras, sobran } = barrasDeCaducidad(muchas, 12);
    expect(barras.length).toBe(12);
    expect(sobran).toBe(3);
  });
});
