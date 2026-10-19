import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';

export const TAG_STYLES: string[] = [
  `
    .tag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-sm);
      font-weight: var(--font-normal);
      color: var(--text-primary);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      cursor: default;
      transition: var(--transition-fast);
      user-select: none;
    }

    .tag--interactive {
      appearance: none;
      cursor: pointer;
      font-family: inherit;
      line-height: inherit;
      text-align: inherit;
      margin: 0;

      &:hover:not(:disabled) {
        background: var(--border-default);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    }

    @media (max-width: 760px) {
      .tag--touch-target {
        min-height: 44px;
        padding-inline: var(--space-2);
      }
    }

    .tag--selected {
      background: var(--primary-subtle);
      border-color: var(--primary);
      color: var(--primary-dark);
    }

    .tag--disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
  `
];

@Component({
  selector: 'app-tag',
  standalone: true,
  imports: [TranslatePipe, CommonModule],
  template: `
    <span [class]="getClasses()" [class.tag--removable]="removable">
      <ng-content></ng-content>
      <button
        *ngIf="removable"
        type="button"
        class="tag__remove"
        [disabled]="disabled"
        (click)="onRemove.emit($event); $event.stopPropagation()"
        [attr.aria-label]="'ui.remove_tag' | t"
      >
        ×
      </button>
    </span>
  `,
  styles: [
    ...TAG_STYLES,
    `
      .tag__remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: var(--radius-full);
        background: var(--border-default);
        color: var(--text-tertiary);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        transition: var(--transition-fast);
        border: none;
        padding: 0;
        appearance: none;
      }

      .tag__remove:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .tag__remove:hover:not(:disabled) {
        background: var(--error-subtle);
        color: var(--error);
      }
    `
  ]
})
export class TagComponent {
  @Input() removable = false;
  @Input() disabled = false;

  @Output() onRemove = new EventEmitter<Event>();

  getClasses(): string {
    const classes = ['tag'];
    if (this.disabled) classes.push('tag--disabled');
    return classes.join(' ');
  }
}
