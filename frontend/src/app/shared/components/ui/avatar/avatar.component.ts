import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { avatarInk, initialsOf as initialsFrom } from './avatar-palette';

// El calculo del color vive en `avatar-palette.ts` —puro, con su spec en node— y se reexporta
// aqui para que una vista pueda pedir el par de colores sin conocer ese modulo.
export { avatarInk, initialsOf, contrastRatio, readableInkOn, AVATAR_COLORS } from './avatar-palette';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      [class]="getClasses()"
      [class.avatar--photo]="!!src"
      [style.background-color]="ink.background"
      [style.color]="ink.foreground"
      [attr.title]="name || null"
    >
      <img
        *ngIf="src; else initialsTemplate"
        [src]="src"
        [alt]="name || ''"
        class="avatar__image"
        loading="lazy"
        (error)="broken.set(true); imageError.emit(src)"
      />
      <ng-template #initialsTemplate>
        <span class="avatar__initials">{{ getInitials() }}</span>
      </ng-template>
      @if (broken() && src) {
        <span class="avatar__initials avatar__initials--fallback" aria-hidden="true">{{ getInitials() }}</span>
      }
      <span *ngIf="status" [class]="'avatar__status avatar__status--' + status"></span>
    </div>
  `,
  styles: [`
    .avatar {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-full);
      overflow: hidden;
      flex-shrink: 0;
    }

    /* Sizes */
    .avatar--xs { width: 24px; height: 24px; }
    .avatar--sm { width: 32px; height: 32px; }
    .avatar--md { width: 40px; height: 40px; }
    .avatar--lg { width: 48px; height: 48px; }
    .avatar--xl { width: 64px; height: 64px; }

    .avatar__image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* La foto necesita un borde o deja de ser un circulo: sobre una tarjeta blanca el bitmap
       rectangular se come las esquinas redondeadas. Anillo interior (dentro del recorte) y
       uno exterior fino, para que se vea tambien sobre un fondo oscuro. */
    .avatar--photo {
      box-shadow:
        inset 0 0 0 1px var(--border-default),
        0 0 0 1px var(--border-strong);
    }

    .avatar__initials {
      font-family: var(--font-display);
      font-weight: var(--font-semibold);
      /* El color de la letra NO se fija aqui: sale del contraste con el fondo del disco, y lo
         decide avatarInk(). Fijarlo aqui —blanco de siempre— es como se dejo la inicial
         invisible sobre el fondo. Nada de backticks en este comentario: cierran el literal. */
      text-transform: uppercase;
      line-height: 1;
    }

    /* Rota la foto (404, archivo movido): se pinta la inicial encima del disco, no un hueco. */
    .avatar__initials--fallback {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: inherit;
    }

    .avatar--xs .avatar__initials { font-size: 10px; }
    .avatar--sm .avatar__initials { font-size: var(--text-xs); }
    .avatar--md .avatar__initials { font-size: var(--text-sm); }
    .avatar--lg .avatar__initials { font-size: var(--text-base); }
    .avatar--xl .avatar__initials { font-size: var(--text-lg); }

    .avatar__status {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 25%;
      height: 25%;
      min-width: 8px;
      min-height: 8px;
      border-radius: var(--radius-full);
      border: 2px solid var(--bg-secondary);
    }

    .avatar__status--online { background: var(--success); }
    .avatar__status--offline { background: var(--text-tertiary); }
    .avatar__status--away { background: var(--warning); }
    .avatar__status--busy { background: var(--error); }
  `]
})
export class AvatarComponent {
  /**
   * Cambiar de foto borra la sospecha de estar rota. Sin esto, una URL que fallo deja la inicial
   * pintada ENCIMA de la foto que llega despues (el `background: inherit` de la capa de reserva
   * tapaba el `img` recien cargado), que es la senal exacta de que la subida ha funcionado.
   */
  @Input()
  set src(value: string | undefined) {
    if (value !== this._src) this.broken.set(false);
    this._src = value;
  }
  get src(): string | undefined {
    return this._src;
  }
  private _src?: string;
  @Input() name?: string;
  @Input() size: AvatarSize = 'md';
  /** Color forzoso (el de una tienda, una categoria). Sin el, el disco sale del nombre. */
  @Input() color?: string;
  @Input() status?: 'online' | 'offline' | 'away' | 'busy';

  /** Si la foto no carga, se pinta la inicial: un hueco en blanco no dice «no hay foto». */
  readonly broken = signal(false);

  /**
   * Y ademas se dice, porque hay una pantalla que necesita saberlo: la de la cuenta, donde una URL
   * de foto que ya no esta en el servidor es un estado que se puede arreglar (subirla otra vez) y
   * no un avatar que simplemente sale asi.
   */
  @Output() imageError = new EventEmitter<string>();

  /**
   * Fondo y letra, en la misma decision: la letra se elige por contraste con ese fondo, que es
   * justo lo que faltaba cuando el disco ni siquiera se pintaba. Gettery no `computed`: con
   * `@Input()` de campos, un `computed` no se invalida al cambiar la entrada y el avatar se
   * quedaria con el color del vecino en una fila reutilizada.
   */
  get ink(): { background: string; foreground: string } {
    return avatarInk(this.name, this.color);
  }

  getInitials(): string {
    return initialsFrom(this.name);
  }

  getClasses(): string {
    return `avatar avatar--${this.size}`;
  }
}
