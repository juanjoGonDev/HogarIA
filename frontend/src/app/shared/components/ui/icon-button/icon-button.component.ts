import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icon-paths';

export type IconButtonVariant = 'ghost' | 'soft' | 'primary' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

/**
 * Boton de solo icono (HOGARIA-SPEC §8f): «si un boton se puede simplificar a un icono,
 * mejor, y mas pequeno».
 *
 * El `label` no es opcional de verdad: es el `aria-label`, el `title` y el texto del
 * tooltip. Un boton de icono sin etiqueta es un punto que hace algo misterioso, y en
 * movil no hay raton que lo aclare — por eso el componente lo pide siempre y deja, ademas,
 * un halo visible cuando falta (se ve en desarrollo y no depende de acordarse de mirar).
 *
 * `size` controla el area util, no el glifo: en el movil se falla un toque de 24 px y no
 * se ve el error hasta que alguien intenta borrar una linea con el pulgar.
 */
@Component({
  selector: 'app-icon-button',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <button
      type="button"
      [class]="classes"
      [attr.aria-label]="label || null"
      [attr.title]="label || null"
      [disabled]="disabled"
      (click)="onClick.emit($event)"
    >
      <app-icon [name]="icon" [size]="glyph" [label]="null" [spin]="loading || spin" />
      @if (badge) {
        <span class="icon-btn__badge">{{ badge }}</span>
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .icon-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0;
        transition: var(--transition-fast);
        -webkit-tap-highlight-color: transparent;
      }
      .icon-btn--sm {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
      }
      .icon-btn--md {
        width: 40px;
        height: 40px;
      }
      .icon-btn--lg {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-lg);
      }
      .icon-btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .icon-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .icon-btn--ghost:hover:not(:disabled) {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .icon-btn--soft {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .icon-btn--soft:hover:not(:disabled) {
        background: var(--border-default);
      }
      .icon-btn--primary {
        background: var(--primary);
        color: var(--white);
      }
      .icon-btn--primary:hover:not(:disabled) {
        background: var(--primary-dark);
      }
      .icon-btn--danger {
        color: var(--error);
      }
      .icon-btn--danger:hover:not(:disabled) {
        background: var(--color-error-50, rgba(224, 90, 90, 0.12));
      }
      /* El toque en el movil no tiene hover: la confirmacion visual es el propio boton
         hundiendose, y se hace aqui en vez de en cada pantalla. */
      .icon-btn:active:not(:disabled) {
        transform: scale(0.92);
      }
      .icon-btn--no-label::after {
        content: '?';
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 10px;
        color: var(--error);
      }
      .icon-btn__badge {
        position: absolute;
        top: 1px;
        right: 1px;
        min-width: 15px;
        padding: 0 3px;
        border-radius: var(--radius-full);
        background: var(--primary);
        color: var(--white);
        font-size: 10px;
        font-weight: var(--font-semibold);
        line-height: 15px;
      }
    `
  ]
})
export class IconButtonComponent {
  @Input({ required: true }) icon!: IconName;
  @Input() label = '';
  @Input() variant: IconButtonVariant = 'ghost';
  @Input() size: IconButtonSize = 'md';
  @Input() badge: string | number | null = null;
  @Input() disabled = false;
  @Input() loading = false;
  /** El glifo que gira (actualizar, reintentar): mismo animacion, sin inventar CSS en cada pantalla. */
  @Input() spin = false;

  @Output() onClick = new EventEmitter<Event>();

  get glyph(): number {
    return this.size === 'sm' ? 18 : this.size === 'lg' ? 26 : 22;
  }

  get classes(): string {
    const list = ['icon-btn', `icon-btn--${this.size}`, `icon-btn--${this.variant}`];
    if (!this.label) list.push('icon-btn--no-label');
    return list.join(' ');
  }
}
