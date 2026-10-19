import { HttpErrorResponse } from '@angular/common/http';

/** El interceptor comun conserva la respuesta HTTP original en el error que vuelve a lanzar. */
export function originalHttpError(error: unknown): HttpErrorResponse {
  const original = (error as { original?: HttpErrorResponse } | null)?.original;
  return original ?? (error as HttpErrorResponse);
}
