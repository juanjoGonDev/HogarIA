import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

/**
 * Casilla del sistema (HOGARIA-SPEC §8f).
 *
 * Nace porque en el calendario habia un `<input type="checkbox">` pelado al lado de un texto:
 * sin tamano de toque, sin foco visible y con el cuadradito del navegador, que en movil es un
 * area de 13 px donde nadie acierta. Un control que se usa tiene que tener el mismo cuidado que
 * el resto de la app, y eso incluye las casillas.
 *
 * Se apoya en un `button` con `role="checkbox"` en vez de en el input nativo porque el patron de
 * la app (marcar una linea de la compra) es un toque grande con el pulgar; el input real sigue
 * existiendo para los formularios que lo necesiten, pero aqui lo que manda es el area util.
 */
@Component({
  selector: 'app-checkbox',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <button
      type="button"
      role="checkbox"
      class="hg-check"
      [class.hg-check--on]="checked"
      [class.hg-check--disabled]="disabled"
      [attr.aria-checked]="checked"
      [attr.aria-label]="hideLabel ? label : null"
      [disabled]="disabled"
      (click)="toggle()"
    >
      <span class="hg-check__box" aria-hidden="true">
        @if (checked) {
          <app-icon name="check" [size]="14" [label]="null" />
        }
      </span>
      @if (!hideLabel) {
        <span class="hg-check__label">{{ label }}</span>
      }
      @if (hint) {
        <span class="hg-check__hint">{{ hint }}</span>
      }
    </button>
  `,
  styles: [
    `
      .hg-check {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        border: none;
        background: transparent;
        padding: var(--space-1) 0;
        min-width: 44px;
        min-height: 44px;
        font-family: inherit;
        font-size: var(--text-sm);
        color: var(--text-primary);
        cursor: pointer;
        text-align: left;
      }
      .hg-check__box {
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        border: 1.5px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--white);
        transition: var(--transition-fast);
      }
      .hg-check--on .hg-check__box {
        background: var(--primary);
        border-color: var(--primary);
      }
      .hg-check:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
        border-radius: var(--radius-sm);
      }
      .hg-check:active:not(:disabled) .hg-check__box {
        transform: scale(0.92);
      }
      .hg-check--disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .hg-check__hint {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
    `
  ]
})
export class CheckboxComponent {
  @Input() checked = false;
  @Input() label = '';
  @Input() hint: string | null = null;
  @Input() disabled = false;
  @Input() hideLabel = false;

  @Output() checkedChange = new EventEmitter<boolean>();
  @Output() onChange = new EventEmitter<boolean>();

  toggle(): void {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.checkedChange.emit(this.checked);
    this.onChange.emit(this.checked);
  }
}
