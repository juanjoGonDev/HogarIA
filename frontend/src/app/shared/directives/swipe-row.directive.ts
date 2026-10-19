import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  inject
} from '@angular/core';

/** Desplazamiento minimo para que el riel asome (px). Por debajo, es un dedo dudando. */
export const REVEAL_PX = 56;
/** Fracction del ancho a la que el gesto deja de ser "mirar" y pasa a "hacer". */
export const COMMIT_RATIO = 0.6;
/** Pulsacion larga para entrar en seleccion multiple (ms). */
export const LONG_PRESS_MS = 350;

export interface SwipeState {
  /** Cuanto esta descubierto el riel, de 0 a 1. */
  reveal: number;
  /** El gesto ha cruzado el umbral: al soltar se ejecuta la accion. */
  armed: boolean;
}

/**
 * Traduccion horizontal -> estado del riel. Separa la geometria de los umbrales del
 * ciclo de vida del puntero, y permite probar ambos niveles de forma independiente.
 */
export function swipeState(deltaX: number, width: number): SwipeState {
  if (width <= 0) return { reveal: 0, armed: false };
  const left = Math.min(0, deltaX);
  const reveal = Math.min(1, Math.abs(left) / width);
  return {
    reveal: reveal < REVEAL_PX / width ? 0 : reveal,
    armed: Math.abs(left) >= width * COMMIT_RATIO
  };
}

/** Un deslizamiento a la derecha corto no es nada; uno decidido, una unidad mas. */
export function isQuickPlus(deltaX: number, width: number): boolean {
  return width > 0 && deltaX >= Math.max(REVEAL_PX, width * 0.35);
}

/**
 * Gestos de una fila de la lista.
 *
 * Swipe izquierda: descubre el riel (`Editar · Quitar`). Si se arrastra mas alla del
 * 60 % del ancho, al soltar se ejecuta la accion primaria (Quitar) con su barra de
 * deshacer. Swipe derecha: una unidad mas, que es lo que se hace con el pulgar
 * delante de la nevera.
 *
 * El gesto nunca es la unica via: el riel es visible al descubrirlo y cada accion
 * existe tambien en el menu de la fila y en el modo multi-seleccion.
 */
@Directive({
  selector: '[appSwipeRow]',
  standalone: true,
  host: {
    class: 'swipe-row',
    '[class.swipe-row--dragging]': 'dragging',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerEnd($event)',
    '(pointercancel)': 'onPointerEnd($event)'
  }
})
export class SwipeRowDirective implements OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);

  /** Desactiva el gesto (se usa en el modo multi-seleccion, donde tocar = marcar). */
  @Input('appSwipeRow') disabled = false;

  /** El usuario arrastro hasta el final: acción primaria (Quitar). */
  @Output() swipeRemove = new EventEmitter<void>();
  /** Swipe a la derecha: +1 unidad. */
  @Output() swipePlus = new EventEmitter<void>();
  /** El riel se ha quedado descubierto (para poder cerrarlo con un toque fuera). */
  @Output() railToggled = new EventEmitter<boolean>();
  /**
   * Termin un arrastre horizontal. El navegador dispara `click` despues de soltar
   * aunque el dedo haya cruzado la fila entera, y eso convierte un gesto de "mirar
   * el riel" en un marcado de casilla (o en una navegacion). Quien escucha esto
   * ignora ese click: `suppressTap` es la ventana corta que lo aplica sin fiarse
   * del orden de los listeners.
   */
  @Output() gestureEnded = new EventEmitter<void>();

  /** Ventana en ms durante la cual un click es residual del arrastre. */
  static readonly TAP_SUPPRESSION_MS = 200;

  dragging = false;

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private axis: 'none' | 'x' | 'y' = 'none';
  private state: SwipeState = { reveal: 0, armed: false };
  private railOpen = false;

  onPointerDown(event: PointerEvent): void {
    if (this.disabled || event.button !== 0 || this.pointerId !== null) return;
    // El gesto nace sobre la fila, y la fila puede ser un enlace: solo se cede ante
    // lo que escribe o pulsa por si mismo ([data-gesture-stop]).
    if ((event.target as HTMLElement).closest('input, select, textarea, [data-gesture-stop]'))
      return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.axis = 'none';
    this.dragging = true;
  }

  onPointerMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - this.startX;
    const deltaY = event.clientY - this.startY;

    if (this.axis === 'none') {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      // Vertical gana: es un scroll, no un gesto. Se deja pasar y se suelta el gesto.
      this.axis = Math.abs(deltaY) > Math.abs(deltaX) ? 'y' : 'x';
      if (this.axis === 'y') {
        this.pointerId = null;
        this.dragging = false;
        this.apply(0, false);
        return;
      }
    }

    const width = this.element.nativeElement.offsetWidth;
    this.state = swipeState(deltaX, width);
    // Hacia la derecha no hay riel: solo se pinta el amago del +1.
    const offset = deltaX > 0 ? Math.min(deltaX, width * 0.3) : deltaX;
    this.element.nativeElement.style.setProperty('--swipe-x', `${Math.round(offset)}px`);
    this.element.nativeElement.classList.toggle('swipe-row--armed', this.state.armed);
    if (Math.abs(deltaX) > REVEAL_PX) event.preventDefault();
  }

  onPointerEnd(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - this.startX;
    const width = this.element.nativeElement.offsetWidth;
    const moved = this.axis === 'x';
    this.pointerId = null;
    this.dragging = false;
    if (moved) this.gestureEnded.emit();

    if (this.axis === 'x' && width > 0) {
      if (this.state.armed) {
        this.apply(0, false);
        this.swipeRemove.emit();
        // El navegador dispara `click` sobre lo que habia debajo del dedo al soltar
        // (la papelera del riel, el ⋯, la propia fila). La accion ya se ejecuto: los
        // 250 ms siguientes la fila esta sorda al raton.
        this.busyUntil();
        return;
      }
      if (isQuickPlus(deltaX, width)) {
        this.apply(0, false);
        this.swipePlus.emit();
        return;
      }
      const reveal = Math.abs(deltaX) > REVEAL_PX && deltaX < 0;
      this.railOpen = reveal;
      this.apply(reveal ? -Math.min(width * 0.62, REVEAL_PX * 2.4) : 0, reveal);
      return;
    }
    this.apply(0, false);
  }

  private busyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Breve sordera a los clics residuales de un gesto que ya ejecuto algo. */
  private busyUntil(): void {
    const element = this.element.nativeElement;
    element.classList.add('swipe-row--busy');
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => {
      element.classList.remove('swipe-row--busy');
      this.busyTimer = null;
    }, 250);
  }

  /** Llamado desde el componente para cerrar el riel con un toque fuera. */
  closeRail(): void {
    this.railOpen = false;
    this.apply(0, false);
  }

  ngOnDestroy(): void {
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.element.nativeElement.style.removeProperty('--swipe-x');
  }

  private apply(offset: number, open: boolean): void {
    this.element.nativeElement.style.setProperty('--swipe-x', `${Math.round(offset)}px`);
    this.element.nativeElement.classList.toggle('swipe-row--armed', false);
    this.element.nativeElement.classList.toggle('swipe-row--open', open);
    if (!open) this.railOpen = false;
    this.railToggled.emit(open);
  }
}

/**
 * Pulsacion larga: entra en modo multi-seleccion. Se cancela si el dedo se mueve
 * (es un scroll) o si se suelta antes de tiempo (es un toque normal, que marca la
 * casilla). `clickSuppressed` evita el doble efecto despues de un long press.
 */
@Directive({
  selector: '[appLongPress]',
  standalone: true,
  host: {
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'stop()',
    '(pointercancel)': 'stop()',
    '(click)': 'onClick($event)'
  }
})
export class LongPressDirective {
  @Input() longPressDisabled = false;
  @Output() longPress = new EventEmitter<void>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private fired = false;

  start(event: PointerEvent): void {
    if (this.longPressDisabled || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('input, select, textarea, [data-gesture-stop]'))
      return;
    this.fired = false;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.timer = setTimeout(() => {
      this.fired = true;
      this.longPress.emit();
    }, LONG_PRESS_MS);
  }

  move(event: PointerEvent): void {
    if (this.timer === null) return;
    if (Math.abs(event.clientX - this.startX) > 12 || Math.abs(event.clientY - this.startY) > 12)
      this.stop();
  }

  stop(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  onClick(event: MouseEvent): void {
    // Un long press no debe dejar ademas un click suelto marcado en la fila.
    if (this.fired) {
      event.preventDefault();
      event.stopPropagation();
      this.fired = false;
    }
  }
}
