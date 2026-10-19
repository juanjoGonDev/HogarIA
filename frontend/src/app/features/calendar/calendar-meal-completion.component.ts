import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/translate.pipe';

@Component({
  selector: 'app-calendar-meal-completion',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <button
      type="button"
      class="cal-btn"
      data-test="meal-completion-toggle"
      [attr.aria-label]="(completed ? 'calendar.unmark_done' : 'calendar.mark_done') | t"
      [attr.aria-pressed]="completed"
      [title]="(completed ? 'calendar.unmark_done' : 'calendar.mark_done') | t"
      (click)="toggle.emit()"
    >
      {{ (completed ? 'calendar.unmark_done' : 'calendar.mark_done') | t }}
    </button>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cal-btn:hover:not(:disabled) {
        color: var(--text-primary);
        border-color: var(--border-strong);
      }

      .cal-btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    `
  ]
})
export class CalendarMealCompletionComponent {
  @Input() completed = false;
  @Output() toggle = new EventEmitter<void>();
}
