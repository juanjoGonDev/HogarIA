import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarDayView, CalendarMeal, HouseholdEvent } from '../../shared/models/calendar.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { CalendarEventComponent } from './calendar-event.component';
import { CalendarHouseholdEventsComponent } from './calendar-household-events.component';
import { CalendarHouseholdTasksComponent } from './calendar-household-tasks.component';
import { labels } from './calendar.util';

@Component({
  selector: 'app-calendar-agenda-view',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    CalendarEventComponent,
    CalendarHouseholdEventsComponent,
    CalendarHouseholdTasksComponent
  ],
  template: `
    <div class="agenda-list" [attr.aria-label]="'calendar.view.agenda' | t">
      @for (day of visibleDays(); track day.iso) {
        <section class="agenda-list__day">
          <button
            type="button"
            class="agenda-list__date"
            [class.is-today]="day.isToday"
            (click)="openDay.emit(day.iso)"
          >
            <span>{{ weekday(day) }}</span
            ><strong>{{ day.date.getDate() }}</strong>
          </button>
          <div class="agenda-list__items">
            @if (day.events.length) {
              <app-calendar-household-events
                [events]="day.events"
                appearance="agenda"
                (edit)="editEvent.emit($event)"
              />
            }
            <app-calendar-household-tasks [tasks]="day.tasks" />
            @for (meal of day.meals; track meal.id) {
              <app-calendar-event mode="row" [meal]="meal" (open)="openMeal.emit(meal)" />
            }
            @if (!day.events.length && !day.meals.length && !day.tasks.length) {
              <button type="button" class="agenda-list__add" (click)="addEvent.emit(day.iso)">
                {{ 'calendar.evento' | t }}
              </button>
            }
          </div>
        </section>
      } @empty {
        <p class="agenda-list__empty">{{ 'calendar.nada_en_agenda' | t }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .agenda-list {
        padding: 8px 20px 20px;
      }
      .agenda-list__day {
        display: grid;
        grid-template-columns: 84px minmax(0, 1fr);
        gap: 12px;
        min-height: 64px;
        padding: 12px 0;
        border-bottom: 1px solid var(--border-default);
      }
      .agenda-list__date {
        display: flex;
        align-items: center;
        gap: 8px;
        align-self: start;
        border: 0;
        background: none;
        color: var(--text-secondary);
        font: inherit;
        cursor: pointer;
        text-align: left;
      }
      .agenda-list__date span {
        font-size: 10px;
        text-transform: uppercase;
      }
      .agenda-list__date strong {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        color: var(--text-primary);
        font-size: var(--text-lg);
        font-weight: var(--font-normal);
      }
      .agenda-list__date.is-today strong {
        color: var(--text-inverse);
        background: var(--primary);
      }
      .agenda-list__items {
        display: grid;
        align-content: start;
        gap: 6px;
        min-width: 0;
      }
      .agenda-list__add {
        justify-self: start;
        min-height: 32px;
        padding: 0 10px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--text-xs);
        cursor: pointer;
      }
      .agenda-list__empty {
        margin: 0;
        padding: 36px 16px;
        color: var(--text-secondary);
        text-align: center;
      }
      .agenda-list__date:hover,
      .agenda-list__add:hover {
        background-color: var(--bg-tertiary);
      }
      .agenda-list__date:focus-visible,
      .agenda-list__add:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      @media (max-width: 480px) {
        .agenda-list {
          padding-inline: 12px;
        }
        .agenda-list__day {
          grid-template-columns: 68px minmax(0, 1fr);
          gap: 8px;
        }
      }
    `
  ]
})
export class CalendarAgendaViewComponent {
  @Input({ required: true }) days: CalendarDayView[] = [];
  @Output() openDay = new EventEmitter<string>();
  @Output() openMeal = new EventEmitter<CalendarMeal>();
  @Output() editEvent = new EventEmitter<HouseholdEvent>();
  @Output() addEvent = new EventEmitter<string>();

  visibleDays(): CalendarDayView[] {
    return this.days.filter((day) => day.events.length || day.meals.length || day.tasks.length);
  }
  weekday(day: CalendarDayView): string {
    return labels.dayOfWeekShort(day.date);
  }
}
