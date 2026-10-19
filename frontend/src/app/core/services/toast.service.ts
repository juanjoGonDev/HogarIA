import { Injectable, signal } from '@angular/core';

/** Accion dentro del aviso: el boton de «Deshacer» de la barra de resultados. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
  dismissible: boolean;
  /** Boton de accion (por ejemplo `Deshacer`) y lo que ejecuta al tocarlo. */
  action?: ToastAction;
  /** `bottom` es para el pulgar: los avisos que admiten deshacer se actian abajo. */
  position?: 'top' | 'bottom';
  /** Pinta la barra que se vacia, para que el plazo de 6 s se vea y no se adivine. */
  countdown?: boolean;
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** Opciones que un llamador puede fijar en el aviso, sin repetir lo ya dicho. */
type ToastExtras = Partial<Omit<Toast, 'id' | 'type' | 'title' | 'message'>>;

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastsSignal = signal<Toast[]>([]);
  readonly toasts = this.toastsSignal.asReadonly();

  private defaultDurations: Record<ToastType, number> = {
    success: 3000,
    error: 5000,
    warning: 4000,
    info: 3000
  };

  show(options: Partial<Omit<Toast, 'id'>>): string {
    const id = this.generateId();
    const type = options.type || 'info';
    const toast: Toast = {
      id,
      type,
      title: options.title || '',
      message: options.message,
      duration: options.duration || this.defaultDurations[type],
      dismissible: options.dismissible !== false,
      action: options.action,
      position: options.position ?? 'top',
      countdown: options.countdown ?? false
    };

    this.toastsSignal.update(toasts => [...toasts, toast]);

    if (toast.duration > 0) {
      // La barra del countdown usa exactamente esta duracion: si el timer y la
      // animacion divergieran, el boton desapareceria antes o despues del plazo.
      setTimeout(() => this.dismiss(id), toast.duration);
    }

    return id;
  }

  success(title: string, message?: string, extras?: ToastExtras): string {
    return this.show({ type: 'success', title, message, ...extras });
  }

  error(title: string, message?: string, extras?: ToastExtras): string {
    return this.show({ type: 'error', title, message, duration: 5000, ...extras });
  }

  warning(title: string, message?: string, extras?: ToastExtras): string {
    return this.show({ type: 'warning', title, message, ...extras });
  }

  info(title: string, message?: string, extras?: ToastExtras): string {
    return this.show({ type: 'info', title, message, ...extras });
  }

  /** El aviso se quita en cuanto se actua: deshacer y seguir mirando la lista. */
  runAction(toast: Toast): void {
    toast.action?.run();
    this.dismiss(toast.id);
  }

  dismiss(id: string): void {
    this.toastsSignal.update(toasts => toasts.filter(t => t.id !== id));
  }

  clear(): void {
    this.toastsSignal.set([]);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-3);
  }
}
