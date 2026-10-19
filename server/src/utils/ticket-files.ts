/**
 * Leer el fichero de un ticket del disco (HOGARIA-SPEC ## 12aj): el mismo recorrido validado
 * que el avatar (`utils/uploads.ts`), sin parsear nada —los bytes que se le pasan al modelo son
 * los que hay en el disco, ni un byte mas.
 */
import { readUpload } from './uploads.js';

export function leerTicket(url: string): Buffer | null {
  const leido = readUpload(url);
  return leido?.body ?? null;
}
