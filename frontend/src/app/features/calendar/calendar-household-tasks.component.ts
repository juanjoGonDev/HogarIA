import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { CalendarHouseholdTask } from '../../shared/models/calendar.model';

/** Read-only household task chips shared by the existing calendar views. */
@Component({
  selector: 'app-calendar-household-tasks',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="cal-tasks" role="list" [class.cal-tasks--dense]="dense">
      @for (task of visibleTasks(); track task.id) {
        <div
          class="cal-task"
          [class.is-done]="task.completed"
          role="listitem"
          [attr.aria-label]="description(task)"
          [attr.title]="description(task)"
          data-test="calendar-household-task"
        >
          <span class="cal-task__check" aria-hidden="true"></span>
          <span class="cal-task__content">
            <span class="cal-task__title">{{ task.title }}</span>
            <span class="cal-task__meta">
              @if (task.zoneName) {
                <span>{{ 'calendar.task_zone' | t: { name: task.zoneName } }}</span>
              }
              @if (task.assignedMemberName) {
                <span>{{ 'calendar.task_assignee' | t: { name: task.assignedMemberName } }}</span>
              } @else if (!dense) {
                <span>{{ 'calendar.task_unassigned' | t }}</span>
              }
              @if (!dense) {
                <span>{{
                  (task.completed ? 'calendar.task_completed' : 'calendar.task_pending') | t
                }}</span>
              }
            </span>
          </span>
        </div>
      }
      @if (hiddenCount() > 0) {
        <span class="cal-task__more">{{ 'calendar.task_more' | t: { count: hiddenCount() } }}</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .cal-tasks {
        display: grid;
        gap: var(--space-1);
        min-width: 0;
      }
      .cal-task {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        min-width: 0;
        padding: var(--space-2) var(--space-3);
        border-left: 3px solid var(--secondary);
        border-radius: var(--radius-sm);
        background: color-mix(in srgb, var(--secondary) 10%, var(--bg-secondary));
        color: var(--text-primary);
        font-size: var(--text-sm);
        line-height: 1.3;
      }
      .cal-task.is-done {
        border-left-color: var(--success);
        background: color-mix(in srgb, var(--success) 8%, var(--bg-secondary));
      }
      .cal-task__check {
        display: grid;
        place-items: center;
        flex: 0 0 14px;
        width: 14px;
        height: 14px;
        margin-top: 1px;
        border: 1.5px solid var(--secondary);
        border-radius: var(--radius-sm);
        color: var(--text-inverse);
        font-size: 10px;
        line-height: 1;
      }
      .is-done .cal-task__check {
        border-color: var(--success);
        background: var(--success);
      }
      .is-done .cal-task__check::after {
        width: 4px;
        height: 7px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        content: '';
        transform: translateY(-1px) rotate(45deg);
      }
      .cal-task__content {
        display: grid;
        min-width: 0;
        gap: 2px;
      }
      .cal-task__title {
        overflow: hidden;
        font-weight: var(--font-medium);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .is-done .cal-task__title {
        color: var(--text-secondary);
        text-decoration: line-through;
      }
      .cal-task__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }
      .cal-task__more {
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }
      .cal-tasks--dense {
        gap: 2px;
      }
      .cal-tasks--dense .cal-task {
        align-items: center;
        gap: 4px;
        padding: 1px 4px;
        border-left-width: 2px;
        border-radius: 3px;
        font-size: 10px;
        line-height: 1.25;
      }
      .cal-tasks--dense .cal-task__check {
        flex-basis: 10px;
        width: 10px;
        height: 10px;
        margin: 0;
        border-width: 1px;
        font-size: 8px;
      }
      .cal-tasks--dense .cal-task__content {
        display: block;
        min-width: 0;
      }
      .cal-tasks--dense .cal-task__meta {
        display: inline;
        margin-left: 4px;
        font-size: 9px;
        white-space: nowrap;
      }
      .cal-tasks--dense .cal-task__meta span + span::before {
        content: ' · ';
        white-space: pre;
      }
    `
  ]
})
export class CalendarHouseholdTasksComponent {
  private readonly i18n = inject(I18nService);

  @Input() tasks: CalendarHouseholdTask[] = [];
  @Input() dense = false;
  @Input() maxVisible = Number.MAX_SAFE_INTEGER;
  visibleTasks(): CalendarHouseholdTask[] {
    return this.tasks.slice(0, Math.max(0, this.maxVisible));
  }

  hiddenCount(): number {
    return Math.max(0, this.tasks.length - Math.max(0, this.maxVisible));
  }

  description(task: CalendarHouseholdTask): string {
    const status = this.i18n.t(
      task.completed ? 'calendar.task_completed' : 'calendar.task_pending'
    );
    const zone = task.zoneName ? this.i18n.t('calendar.task_zone', { name: task.zoneName }) : '';
    const assignee = task.assignedMemberName
      ? this.i18n.t('calendar.task_assignee', { name: task.assignedMemberName })
      : this.i18n.t('calendar.task_unassigned');
    return [task.title, zone, assignee, status].filter(Boolean).join(' · ');
  }
}
