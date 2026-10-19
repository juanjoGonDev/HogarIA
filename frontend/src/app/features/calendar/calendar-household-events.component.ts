import { Component, EventEmitter, HostBinding, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../core/services/i18n.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import {
  HOUSEHOLD_EVENT_META,
  HOUSEHOLD_RECURRENCE_META,
  HouseholdEvent,
  eventTimeLabel
} from '../../shared/models/calendar.model';

/**
 * Los eventos de la casa dentro de una celda (HOGARIA-SPEC §8f).
 *
 * Componente aparte en vez de marcar el HTML en cada vista por el mismo motivo que
 * `app-calendar-event`: en mes son una linea de 11 px, en semana un bloque corto y en el
 * dia la linea entera, y eso es color, sangria y orden — no tres versiones de lo mismo que
 * divergen en cuanto alguien cambia una.
 *
 * Con `dense` (mes) no se pinta quien la escribio: en una celda de 90 px el nombre del autor
 * se come el titulo, que es lo que de verdad interesa ahi dentro.
 */
@Component({
  selector: 'app-calendar-household-events',
  standalone: true,
  imports: [CommonModule, IconComponent, AvatarComponent],
  template: `
    @for (event of events; track event.id) {
      <button
        type="button"
        class="cal-evt"
        [class.cal-evt--done]="dense && event.allDay"
        [style.--event-color]="event.color ?? metaOf(event).color"
        [attr.title]="tip(event)"
        [attr.data-test]="'household-event' + (dense ? '-dense' : '')"
        (click)="$event.stopPropagation(); edit.emit(event)"
      >
        <span class="cal-evt__dot" aria-hidden="true"></span>
        @if (!dense) {
          <app-icon [name]="metaOf(event).icon" [size]="12" [label]="null" />
        }
        @if (event.recurrence && event.recurrence !== 'none') {
          <!-- Marca de serie (12t-R): sin esto, «cada semana» y «el de la semana pasada» se pintan igual. -->
          <app-icon class="cal-evt__repeat" name="repeat" [size]="12" [label]="null" />
        }
        <span class="cal-evt__title">{{ event.title }}</span>
        @if (timeOf(event)) {
          <span class="cal-evt__when">{{ timeOf(event) }}</span>
        }
        @if (!dense && event.authorName) {
          <!-- «De quien es esta suelta» se respondia con dos letras sueltas; ahora es el mismo
               icono que en la lista de la compra y en la auditoria. -->
          <app-avatar class="cal-evt__who" [name]="event.authorName" [src]="event.authorAvatar ?? undefined" size="xs" />
        }
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      /* La variante agenda: fuera de la celda no hay 11 px que defender, y lo que se
         quiere es tocar la fila para editarla. Se ajusta desde :host con un atributo, en
         vez de duplicar el HTML: las dos vistas siguen teniendo el mismo template.
         (Sin backticks aqui dentro: cierran el literal de styles.) */
      :host([appearance='agenda']) .cal-evt {
        font-size: var(--text-sm);
        line-height: 1.35;
        padding: var(--space-2) var(--space-3);
        border-left-width: 4px;
        border-radius: var(--radius-md);
        gap: var(--space-2);
      }
      :host([appearance='agenda']) .cal-evt__title {
        white-space: normal;
        font-weight: 600;
      }
      :host([appearance='agenda']) .cal-evt__when {
        font-size: var(--text-xs);
      }
      /* Marca de serie: pequena y apagada a proposito, porque lo que se lee es el titulo. */
      .cal-evt__repeat {
        flex: none;
        opacity: 0.72;
      }
      .cal-evt {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        border: none;
        border-left: 3px solid var(--event-color, var(--primary));
        border-radius: 4px;
        background: color-mix(in srgb, var(--event-color, var(--primary)) 12%, transparent);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 11px;
        line-height: 1.25;
        text-align: left;
        padding: 2px 4px;
        margin-top: 2px;
        cursor: pointer;
        overflow: hidden;
        transition: var(--transition-fast);
      }
      .cal-evt:hover {
        background: color-mix(in srgb, var(--event-color, var(--primary)) 22%, transparent);
      }
      .cal-evt__dot {
        width: 6px;
        height: 6px;
        border-radius: var(--radius-full);
        background: var(--event-color, var(--primary));
        flex: 0 0 auto;
      }
      .cal-evt__title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cal-evt--done .cal-evt__title {
        text-decoration: line-through;
        color: var(--text-tertiary);
      }
      .cal-evt__when {
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
      }
      .cal-evt__who {
        margin-left: auto;
        font-size: 9px;
        color: var(--text-tertiary);
        text-transform: uppercase;
        flex: 0 0 auto;
      }
    `
  ]
})
export class CalendarHouseholdEventsComponent {
  private readonly i18n = inject(I18nService);


  @Input() events: HouseholdEvent[] = [];
  @Input() dense = false;
  /**
   * 'cell' (dentro de una celda del mes) o 'agenda' (la lista del dia, mas grande). Va como
   * atributo del host para que la hoja de estilos elija con :host([appearance=...]): dos
   * aspectos del mismo componente, un solo template —lo que se duplica es el CSS, que es lo
   * que puede cambiar sin que se olvide de hacerlo en el otro sitio.
   */
  @Input('appearance') @HostBinding('attr.appearance') appearance: 'cell' | 'agenda' = 'cell';
  @Output() edit = new EventEmitter<HouseholdEvent>();

  metaOf(event: HouseholdEvent) {
    return HOUSEHOLD_EVENT_META[event.kind] ?? HOUSEHOLD_EVENT_META.other;
  }

  timeOf(event: HouseholdEvent): string {
    return this.dense ? '' : eventTimeLabel(event);
  }

  /** Que es, cuando, cada cuanto, y de quien. Un `title` de verdad, no cuatro trozos pegados a mano. */
  tip(event: HouseholdEvent): string {
    const repetir =
      event.recurrence && event.recurrence !== 'none'
        ? this.i18n.t(HOUSEHOLD_RECURRENCE_META[event.recurrence].labelKey)
        : '';
    const quien = event.authorName ? this.i18n.t('calendar.de_persona', { name: event.authorName }) : '';
    return [event.title, eventTimeLabel(event), repetir, quien].filter(Boolean).join(' · ');
  }

}
