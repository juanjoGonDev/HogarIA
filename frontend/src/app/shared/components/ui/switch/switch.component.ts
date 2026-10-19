import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-switch',
  standalone: true,
  template: `
    <span class="hg-switch__track" data-switch-track aria-hidden="true">
      <span class="hg-switch__thumb" data-switch-thumb></span>
    </span>
    <ng-content></ng-content>
  `,
  styles: [
    `
      :host {
        box-sizing: border-box;
        display: inline-grid;
        flex: none;
        width: 44px;
        height: 44px;
        place-items: center;
        border-radius: var(--radius-sm);
        color: inherit;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
      }

      :host([data-visible-label='true']) {
        width: max-content;
        grid-template-columns: 44px max-content;
        column-gap: var(--space-2);
        justify-items: center;
      }

      .hg-switch__track {
        position: relative;
        display: block;
        box-sizing: border-box;
        width: 38px;
        height: 22px;
        border-radius: 999px;
        background: var(--border-strong);
        transition: background-color var(--duration-150) var(--ease-out);
      }

      .hg-switch__thumb {
        position: absolute;
        top: 50%;
        left: 3px;
        display: block;
        box-sizing: border-box;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--bg-primary);
        box-shadow: 0 1px 2px rgb(15 23 42 / 24%);
        transform: translateY(-50%);
        transition: transform var(--duration-150) var(--ease-out);
      }

      :host([data-checked='true']) .hg-switch__track {
        background: var(--color-primary-600);
      }

      :host([data-checked='true']) .hg-switch__thumb {
        transform: translate(16px, -50%);
      }

      :host(:focus-visible) {
        outline: 2px solid var(--primary-dark);
        outline-offset: 2px;
      }

      :host([aria-disabled='true']) {
        opacity: 0.58;
      }

      :host([aria-disabled='true']) .hg-switch__track,
      :host([aria-disabled='true']) .hg-switch__thumb {
        transition: none;
      }

      :host([data-busy='true']) {
        cursor: progress;
      }

      :host([data-disabled='true']) {
        cursor: not-allowed;
      }

      @media (prefers-reduced-motion: reduce) {
        .hg-switch__track,
        .hg-switch__thumb {
          transition: none;
        }
      }
    `
  ],
  host: {
    role: 'switch',
    '[attr.aria-checked]': 'checked',
    '[attr.aria-label]': 'labelledBy ? null : ariaLabel || null',
    '[attr.aria-labelledby]': 'labelledBy || null',
    '[attr.aria-describedby]': 'describedBy || null',
    '[attr.aria-disabled]': 'disabled || busy',
    '[attr.tabindex]': 'disabled ? -1 : 0',
    '[attr.data-checked]': 'checked',
    '[attr.data-disabled]': 'disabled',
    '[attr.data-busy]': 'busy',
    '[attr.data-visible-label]': 'visibleLabel',
    '(click)': 'activate($event)',
    '(keydown)': 'handleKeydown($event)'
  },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SwitchComponent {
  @Input() checked = false;
  @Input() disabled = false;
  @Input() busy = false;
  @Input() ariaLabel = '';
  @Input() labelledBy = '';
  @Input() describedBy = '';
  @Input() visibleLabel = false;

  @Output() readonly checkedChange = new EventEmitter<boolean>();

  activate(event: MouseEvent): void {
    if (!this.canChange()) {
      event.preventDefault();
      return;
    }
    this.checkedChange.emit(!this.checked);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat && this.canChange()) this.checkedChange.emit(!this.checked);
  }

  private canChange(): boolean {
    return !this.disabled && !this.busy;
  }
}
