import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icon-paths';

@Component({
  selector: 'app-rating',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <div class="rating" [class.rating--disabled]="disabled">
      <button
        *ngFor="let star of stars; let i = index"
        type="button"
        [class]="getStarClasses(i)"
        [disabled]="disabled"
        (click)="onStarClick(i)"
        (mouseenter)="onStarHover(i)"
        (mouseleave)="onStarLeave()"
        [attr.aria-label]="
          i + 1 === 1 ? ('common.rating_uno' | t) : ('common.rating_varios' | t: { n: i + 1 })
        "
      >
        <app-icon [name]="getStarIcon(i)" [size]="20" [label]="null" />
      </button>
      <span *ngIf="showValue" class="rating__value">{{ value.toFixed(1) }}</span>
    </div>
  `,
  styles: [
    `
      .rating {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }

      .rating--disabled {
        pointer-events: none;
        opacity: 0.7;
      }

      .rating__star {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--border-default);
        transition:
          color var(--duration-100) var(--ease-out),
          transform var(--duration-100) var(--ease-out);
        padding: 0;
      }

      .rating__star:hover:not(:disabled) {
        transform: scale(1.2);
      }

      .rating__star--filled {
        color: var(--color-warning-500);
      }

      /* 400 no existe en la escala (va 50, 100, 500, 600, 700), y como una declaracion con un color
       inexistente se descarta en silencio, aqui no pasaba nada: la estrella a punto de elegirse se
       quedaba en el gris del borde. Un tono por debajo del relleno, para que «voy a pulsar aqui» se vea
       como eso. */
      .rating__star--hovered {
        color: var(--color-warning-600);
      }

      .rating__value {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        margin-left: var(--space-1);
      }
    `
  ]
})
export class RatingComponent {
  @Input() value = 0;
  @Input() maxStars = 5;
  @Input() disabled = false;
  @Input() showValue = false;
  @Input() allowHalf = false;

  @Output() valueChange = new EventEmitter<number>();
  @Output() ratingChange = new EventEmitter<number>();

  stars: number[] = [];
  hoveredIndex = -1;

  ngOnInit(): void {
    this.stars = Array(this.maxStars).fill(0);
  }

  onStarClick(index: number): void {
    if (this.disabled) return;
    this.value = index + 1;
    this.valueChange.emit(this.value);
    this.ratingChange.emit(this.value);
  }

  onStarHover(index: number): void {
    if (!this.disabled) {
      this.hoveredIndex = index;
    }
  }

  onStarLeave(): void {
    this.hoveredIndex = -1;
  }

  getStarClasses(index: number): string {
    const classes = ['rating__star'];
    if (index < this.value) classes.push('rating__star--filled');
    if (index <= this.hoveredIndex) classes.push('rating__star--hovered');
    return classes.join(' ');
  }

  getStarIcon(index: number): IconName {
    if (index < this.value) return 'star';
    if (index <= this.hoveredIndex) return 'star';
    return 'star_outline';
  }
}
