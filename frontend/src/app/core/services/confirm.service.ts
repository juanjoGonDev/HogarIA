import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  /** Título del diálogo. */
  title: string;
  /** Explicación que se muestra bajo el título. */
  message?: string;
  /** Texto del botón de aceptar (por defecto "Confirmar"). */
  confirmText?: string;
  /** Texto del botón de cancelar (por defecto "Cancelar"). */
  cancelText?: string;
  /** Aspecto del botón de aceptar: rojo para acciones destructivas. */
  variant?: 'danger' | 'primary';
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
}

/**
 * Confirmaciones de la aplicación.
 *
 * Sustituye al `confirm()` del navegador: la app no usa diálogos nativos
 * (quedan fuera del diseño y no se pueden ni traducir ni personalizar).
 * `app-confirm-dialog` se monta en los layouts y pinta la petición activa.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private pendingRequest = signal<ConfirmRequest | null>(null);
  readonly request = this.pendingRequest.asReadonly();

  /** Abre el diálogo y resuelve `true` si el usuario acepta. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      // Si ya había uno abierto se cancela para no dejar promesas colgadas.
      this.pendingRequest()?.resolve(false);
      this.pendingRequest.set({ ...options, resolve });
    });
  }

  accept(): void {
    const request = this.pendingRequest();
    this.pendingRequest.set(null);
    request?.resolve(true);
  }

  cancel(): void {
    const request = this.pendingRequest();
    this.pendingRequest.set(null);
    request?.resolve(false);
  }
}
