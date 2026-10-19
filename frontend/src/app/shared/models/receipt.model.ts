/**
 * Los tickets leidos por IA (HOGARIA-SPEC ## 12aj), la hermana de `shopping.model.ts`.
 *
 * A diferencia de la foto de la estanteria, aqui no hay OCR: el modelo mira la imagen o el
 * PDF del ticket y devuelve la estructura JSON directamente. Lo que viaja por el cable es el
 * pipeline —queued → analyzing → review → confirmed | failed | stopped— y las lineas van
 * llegando poco a poco mientras el modelo las suelta, para que la pantalla ensene lo que va
 * analizando en vez de un circulo de carga mudo.
 */

export type ReceiptStatus = 'queued' | 'analyzing' | 'review' | 'confirmed' | 'failed' | 'stopped';

export type ReceiptFileKind = 'png' | 'jpeg' | 'webp' | 'pdf';

export interface ReceiptOffer {
  buy: number;
  take: number;
}

/** Una linea del ticket: TODO editable durante la revision (## 12aj). */
export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  /** Clave del catalogo de la despensa (pantry_categories), no la seccion del carrito. */
  category: string;
  priceMinor: number | null;
  offer: ReceiptOffer | null;
  note: string | null;
  confidence: number;
}

export interface Receipt {
  id: string;
  status: ReceiptStatus;
  store: string | null;
  purchaseDate: string | null;
  currency: string | null;
  totalMinor: number | null;
  notes: string | null;
  fileUrl: string;
  fileKind: ReceiptFileKind;
  fileName: string | null;
  error: string | null;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  items: number;
}

export interface ReceiptHistoryPage {
  data: Receipt[];
  pagination: { offset: number; limit: number; hasMore: boolean };
}

export interface ReceiptDetail extends Receipt {
  lines: ReceiptItem[];
  job: ReceiptJob | null;
}

export type ReceiptJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

/** Un trabajo de la cola local de IA: lo que el icono de la cabecera ensena. */
export interface ReceiptJob {
  id: string;
  status: ReceiptJobStatus;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  created_at: string;
  receipt_id: string | null;
  store: string | null;
  file_name: string | null;
  receipt_status: ReceiptStatus | null;
  items: number;
}

export interface ReceiptQueueSnapshot {
  jobs: ReceiptJob[];
  counts: { queued: number; running: number; failed: number };
}

export interface ReceiptConfirmResult {
  pricesRecorded: number;
  pantryMoved: number;
  pantryMerged: number;
  store: string | null;
}

/** Estados en los que la revision puede tocar lineas y confirmar. */
export function revisable(status: ReceiptStatus): boolean {
  return status === 'review' || status === 'failed' || status === 'stopped';
}

/** La suma de las lineas, en centimos: para ensenar si cuadra con el total del ticket. */
export function sumaDeLineas(lines: ReceiptItem[]): number {
  return lines.reduce((suma, linea) => suma + (linea.priceMinor ?? 0), 0);
}
