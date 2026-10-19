import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TAG_STYLES } from './tag.component';

@Component({
  selector: 'app-filter-tag',
  standalone: true,
  template: `
    <button
      type="button"
      [class]="getClasses()"
      [disabled]="disabled"
      [attr.aria-pressed]="selected"
      (click)="onClick.emit()"
    >
      <ng-content></ng-content>
    </button>
  `,
  styles: TAG_STYLES
})
export class FilterTagComponent {
  @Input() selected = false;
  @Input() disabled = false;
  @Input() touchTarget = false;

  @Output() onClick = new EventEmitter<void>();

  getClasses(): string {
    const classes = ['tag', 'tag--interactive'];
    if (this.selected) classes.push('tag--selected');
    if (this.disabled) classes.push('tag--disabled');
    if (this.touchTarget) classes.push('tag--touch-target');
    return classes.join(' ');
  }
}
