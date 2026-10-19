import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tooltip-wrapper">
      <ng-content></ng-content>
      <span *ngIf="text" [class]="'tooltip tooltip--' + position">
        {{ text }}
      </span>
    </div>
  `,
  styles: [
    `
      .tooltip-wrapper {
        position: relative;
        display: inline-flex;
      }

      .tooltip {
        position: absolute;
        z-index: 50;
        padding: var(--space-1) var(--space-2);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
        color: var(--text-inverse);
        background: var(--color-neutral-800);
        border-radius: var(--radius-md);
        /* Ancho natural con techo: las pistas largas (el catalogo detras de un chip) se partirian contra el
         borde de la tarjeta si se dejaran en una sola linea. */
        width: max-content;
        max-width: min(280px, 70vw);
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--duration-150) var(--ease-out);
      }

      /* La pista sale AL INSTANTE: por eso es un popover propio y no el title nativo, que tarda un segundo en
       aparecer. Tambien con el foco por teclado, que el title no cubria (## 12af). */
      .tooltip-wrapper:hover .tooltip,
      .tooltip-wrapper:focus-within .tooltip {
        opacity: 1;
      }

      /* Positions */
      .tooltip--top {
        bottom: calc(100% + var(--space-1));
        left: 50%;
        transform: translateX(-50%);
      }

      .tooltip--bottom {
        top: calc(100% + var(--space-1));
        left: 50%;
        transform: translateX(-50%);
      }

      .tooltip--left {
        right: calc(100% + var(--space-1));
        top: 50%;
        transform: translateY(-50%);
      }

      .tooltip--right {
        left: calc(100% + var(--space-1));
        top: 50%;
        transform: translateY(-50%);
      }
    `
  ]
})
export class TooltipComponent {
  @Input() text = '';
  @Input() position: TooltipPosition = 'top';
}
