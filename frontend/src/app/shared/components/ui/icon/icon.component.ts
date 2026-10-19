import { Component, Input } from '@angular/core';
import { ICON_SHAPES, hasIcon, type IconName } from './icon-paths';

/**
 * Icono del sistema (HOGARIA-SPEC §8f).
 *
 * `label` hace dos cosas a la vez y es deliberado: es el `aria-label` para quien usa
 * lector de pantalla y el `<title>` nativo para quien pasa el raton. Un boton solo con
 * icono sin `label` es un misterio, y el componente no lo prohibe (hay iconos
 * decorativos), pero la hoja de estilos del boton avisa si falta.
 *
 * Con `size = 0` el icono vale `1em`: se alinea con el texto sin contar pixeles, que es
 * lo que quieren los iconos dentro de una etiqueta o de un boton.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      [attr.viewBox]="shape?.viewBox ?? '0 0 24 24'"
      [attr.width]="size > 0 ? size : null"
      [attr.height]="size > 0 ? size : null"
      [attr.role]="label ? 'img' : 'presentation'"
      [attr.aria-label]="label || null"
      [attr.aria-hidden]="label ? null : 'true'"
      [class.icon--spin]="spin"
      [class.icon--em]="size <= 0"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      @if (label) {
        <title>{{ label }}</title>
      }
      @for (d of shape?.d; track d) {
        <path [attr.d]="d"></path>
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        line-height: 0;
      }
      svg {
        display: block;
        fill: currentColor;
      }
      .icon--em svg {
        width: 1em;
        height: 1em;
      }
      .icon--spin svg {
        animation: hg-icon-spin 1s linear infinite;
      }
      @keyframes hg-icon-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `
  ]
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size = 24;
  @Input() label: string | null = null;
  @Input() spin = false;

  get shape() {
    // Un nombre que no existe (typo, o icono anadido a mano en un template viejo) no
    // debe reventar la pantalla: se ve el hueco, y `hasIcon` es la prueba unitaria.
    return hasIcon(this.name) ? ICON_SHAPES[this.name] : null;
  }
}
