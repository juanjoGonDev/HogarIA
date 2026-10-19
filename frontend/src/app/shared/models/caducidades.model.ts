/**
 * Las caducidades de la casa (HOGARIA-SPEC ## 12ak): el espejo del `caducidades.ts` del server.
 *
 * `daysLeft` negativo es ya caducado; `null` es «no se sabe cuando vence» (ni fecha
 * registrada, ni estimacion de la IA, ni catalogo que lo cubra). Y el ritmo —cada cuanto se
 * repone y cuanto dura el stock— viene del historial de compras, calculado al pedirlo.
 */

export type OrigenDeVida = 'fecha' | 'ia' | 'catalogo';

export interface CaducidadRow {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string | null;
  /** 'YYYY-MM-DD' registrado por la casa. */
  expirationDate: string | null;
  /** Dias de vida cuando no hay fecha (IA o catalogo). */
  estimatedDays: number | null;
  shelfSource: OrigenDeVida | null;
  /** La fecha que sea (registrada o estimada). */
  vence: string | null;
  daysLeft: number | null;
  cadaDias: number | null;
  unidadesPorCompra: number | null;
  /** El stock actual, a este ritmo, dura ~N dias. */
  duraDias: number | null;
  lastBought: string | null;
}

export interface EstimacionDeVida {
  catalogo: number;
  ia: number;
  sinEstimar: number;
  sinFecha: number;
}

/** El color de la prisa: lo que decide el semaforo de la lista y de la grafica. */
export type Urgencia = 'caducado' | 'critico' | 'semana' | 'quincena' | 'lejos' | 'sin';

export function urgenciaDe(daysLeft: number | null): Urgencia {
  if (daysLeft === null) return 'sin';
  if (daysLeft < 0) return 'caducado';
  if (daysLeft <= 3) return 'critico';
  if (daysLeft <= 7) return 'semana';
  if (daysLeft <= 14) return 'quincena';
  return 'lejos';
}
