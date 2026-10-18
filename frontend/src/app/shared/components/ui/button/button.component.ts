import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [class]="getClasses()"
      [disabled]="disabled || loading"
      [attr.aria-busy]="loading ? 'true' : null"
      [attr.aria-describedby]="describedBy || null"
      [type]="type"
      (click)="onClick.emit($event)"
    >
      <span *ngIf="loading" class="btn__spinner" aria-hidden="true"></span>
      <span class="btn__content" [class.btn__content--loading]="loading">
        <ng-content></ng-content>
      </span>
    </button>
  `,
  styles: [
    `
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-family: var(--font-sans);
        font-weight: var(--font-medium);
        line-height: var(--leading-none);
        border: 1px solid transparent;
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: var(--transition-fast);
        user-select: none;
        white-space: nowrap;
        position: relative;

        &:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }

      /* The sm, md, and lg values remain accepted for template compatibility. Text-button geometry
       is intentionally shared: importance is communicated by variant/color, not by size. */
      .btn--sm,
      .btn--md,
      .btn--lg {
        box-sizing: border-box;
        height: var(--button-control-height);
        padding: var(--button-control-padding-block) var(--button-control-padding-inline);
        font-size: var(--button-control-font-size);
        border-radius: var(--radius-lg);
        white-space: nowrap;
      }

      .btn--icon {
        padding: var(--space-2);
        aspect-ratio: 1;
      }

      .btn--touch-target {
        min-width: 44px;
        min-height: 44px;
      }

      .btn__content {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
      }

      .btn__content--loading {
        opacity: 0;
      }

      /* Variants */
      .btn--primary {
        background: var(--primary);
        color: var(--white);
        box-shadow: var(--shadow-sm);

        &:hover:not(:disabled) {
          background: var(--primary-dark);
          box-shadow: var(--shadow-md);
        }

        &:active:not(:disabled) {
          box-shadow: var(--shadow-sm);
        }
      }

      .btn--secondary {
        background: var(--secondary);
        color: var(--white);
        box-shadow: var(--shadow-sm);

        &:hover:not(:disabled) {
          background: var(--secondary-dark);
          box-shadow: var(--shadow-md);
        }
      }

      .btn--outline {
        background: transparent;
        color: var(--text-primary);
        border-color: var(--border-default);

        &:hover:not(:disabled) {
          background: var(--bg-tertiary);
          border-color: var(--border-strong);
        }
      }

      .btn--ghost {
        background: transparent;
        color: var(--text-secondary);

        &:hover:not(:disabled) {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
      }

      .btn--danger {
        background: var(--error);
        color: var(--white);

        &:hover:not(:disabled) {
          background: var(--color-error-700);
        }
      }

      /* Loading spinner */
      .btn__spinner {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 1em;
        height: 1em;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: var(--radius-full);
        animation: spin 0.6s linear infinite;
        pointer-events: none;
        transform: translate(-50%, -50%);
      }

      @keyframes spin {
        from {
          transform: translate(-50%, -50%) rotate(0deg);
        }
        to {
          transform: translate(-50%, -50%) rotate(360deg);
        }
      }
    `
  ]
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() fullWidth = false;
  @Input() touchTarget = false;
  @Input() describedBy: string | null = null;

  @Output() onClick = new EventEmitter<Event>();

  getClasses(): string {
    const classes = ['btn', `btn--${this.variant}`, `btn--${this.size}`];
    if (this.fullWidth) classes.push('btn--full-width');
    if (this.loading) classes.push('btn--loading');
    if (this.touchTarget) classes.push('btn--touch-target');
    return classes.join(' ');
  }
}
