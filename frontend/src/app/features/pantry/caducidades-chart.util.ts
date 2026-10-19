import { CaducidadRow, Urgencia, urgenciaDe } from '../../shared/models/caducidades.model';

/**
 * La grafica de caducidades (## 12ak), en puro TS como la de precios de la 12ai: una barra
 * horizontal por producto, ordenada por prisa, con el color del semaforo y el «≈» de lo
 * estimado. La anchura es proporcion de vida restante frente al producto con mas dias de la
 * tanda; lo caducado se pinta entera y roja, que es lo unico que importa de el.
 */

export interface BarraDeCaducidad {
  nombre: string;
  dias: number | null;
  estimada: boolean;
  urgencia: Urgencia;
  /** 0..100, lista para un style width. */
  anchura: number;
}

export function barrasDeCaducidad(
  filas: CaducidadRow[],
  limite = 12
): { barras: BarraDeCaducidad[]; sobran: number } {
  const ordenadas = [...filas].sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.name.localeCompare(b.name, 'es');
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'es');
  });
  const visibles = ordenadas.slice(0, limite);
  const sobran = ordenadas.length - visibles.length;
  const maxDias = Math.max(1, ...visibles.map((fila) => (fila.daysLeft === null ? 0 : fila.daysLeft)));

  const barras = visibles.map((fila) => {
    const estimada = fila.shelfSource === 'ia' || fila.shelfSource === 'catalogo';
    let anchura = 0;
    if (fila.daysLeft !== null) {
      // Caducado (dias negativos) y el recien llegado al limite: minimo visible, nunca cero.
      anchura = Math.min(100, Math.max(4, Math.round((fila.daysLeft / maxDias) * 100)));
    }
    return {
      nombre: fila.name,
      dias: fila.daysLeft,
      estimada,
      urgencia: urgenciaDe(fila.daysLeft),
      anchura
    };
  });
  return { barras, sobran };
}
