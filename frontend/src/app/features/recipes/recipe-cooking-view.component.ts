import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { Recipe } from '../../shared/models/recipe.model';
import { RecipeInstructionStep } from '../../shared/models/recipe-instructions';
import { TimerComponent, type TimerState } from '../../shared/components/ui/timer/timer.component';
import { scaleRecipeQuantity } from './recipe-detail.util';
import { RecipeStepVideoPlayerComponent } from './recipe-step-video-player.component';

interface TimerSnapshot {
  state: TimerState;
  currentTime: number;
}

interface ActiveRecipeTimer {
  index: number;
  stepNumber: number;
  instruction: string;
  currentTime: number;
}

@Component({
  selector: 'app-recipe-cooking-view',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    ButtonComponent,
    IconComponent,
    TimerComponent,
    RecipeStepVideoPlayerComponent
  ],
  template: `
    <section class="recipe-cooking" data-test="recipe-cooking-view">
      <header class="recipe-cooking__header">
        <div class="recipe-cooking__heading">
          <h1 id="recipe-detail-title" tabindex="-1" data-test="recipe-cooking-title">
            {{ recipe.name }}
          </h1>
          <p class="recipe-cooking__time">
            <span>{{ 'recipes.total_time' | t }}</span>
            {{ 'recipes.min' | t: { n: recipe.totalTime } }}
          </p>
          <p
            class="recipe-cooking__step-progress"
            data-test="cooking-step-progress"
            aria-live="polite"
            aria-atomic="true"
          >
            {{
              'recipes.cooking.step_progress'
                | t: { current: focusedStepIndex() + 1, total: steps.length }
            }}
          </p>
          <div
            class="recipe-cooking__progress-track"
            role="progressbar"
            [attr.aria-label]="'recipes.cooking.completed_progress_label' | t"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="steps.length"
            [attr.aria-valuenow]="completedSteps().size"
            [attr.aria-valuetext]="
              'recipes.cooking.completed_progress'
                | t: { current: completedSteps().size, total: steps.length }
            "
          >
            <span [style.width.%]="completionPercent()"></span>
          </div>
        </div>

        <div class="recipe-cooking__servings" [attr.aria-label]="'recipes.cooking.servings' | t">
          <span class="recipe-cooking__servings-label">{{ 'recipes.cooking.servings' | t }}</span>
          <div class="recipe-cooking__servings-control">
            <app-button
              variant="outline"
              size="icon"
              [touchTarget]="true"
              [disabled]="servings <= 1"
              (onClick)="adjustServings(-1)"
            >
              <span aria-hidden="true">−</span>
              <span class="recipe-cooking__visually-hidden">{{
                'recipes.cooking.servings_decrease' | t
              }}</span>
            </app-button>
            <input
              type="number"
              min="1"
              step="1"
              [value]="servings"
              [attr.aria-label]="'recipes.cooking.servings' | t"
              (change)="setServingsFromInput($event)"
              data-test="cooking-serving-count"
            />
            <app-button
              variant="outline"
              size="icon"
              [touchTarget]="true"
              [disabled]="servings >= maxSafeInteger"
              (onClick)="adjustServings(1)"
            >
              <span aria-hidden="true">+</span>
              <span class="recipe-cooking__visually-hidden">{{
                'recipes.cooking.servings_increase' | t
              }}</span>
            </app-button>
          </div>
        </div>

        <app-button variant="ghost" (onClick)="exit.emit()">
          <app-icon name="close" [size]="16" [label]="null" />
          {{ 'recipes.cooking.exit' | t }}
        </app-button>
      </header>

      <p
        *ngIf="recipe.guidance?.batchCookingWarning"
        class="recipe-cooking__warning"
        data-test="cooking-batch-warning"
        role="note"
      >
        <app-icon name="error_outline" [size]="16" [label]="null" />
        <strong>{{ 'recipes.batch_cooking_warning_heading' | t }}:</strong>
        {{ recipe.guidance?.batchCookingWarning }}
      </p>

      <button
        type="button"
        class="recipe-cooking__ingredients-toggle"
        [attr.aria-expanded]="mobileIngredientsExpanded()"
        aria-controls="recipe-cooking-mobile-ingredients"
        (click)="toggleMobileIngredients()"
      >
        <span>{{
          (mobileIngredientsExpanded()
            ? 'recipes.cooking.ingredients_hide'
            : 'recipes.cooking.ingredients_show'
          ) | t
        }}</span>
        <app-icon
          [name]="mobileIngredientsExpanded() ? 'expand_less' : 'expand_more'"
          [size]="18"
          [label]="null"
        />
      </button>
      <section
        *ngIf="mobileIngredientsExpanded()"
        id="recipe-cooking-mobile-ingredients"
        class="recipe-cooking__mobile-ingredients"
        [attr.aria-label]="'dashboard.ingredients' | t"
      >
        <ul class="recipe-cooking__ingredient-list">
          <li *ngFor="let ingredient of recipe.ingredients" data-test="cooking-ingredient">
            <strong>
              {{ scaledQuantity(ingredient.quantity) | number: '1.0-2' }} {{ ingredient.unit }}
            </strong>
            <span>{{ ingredient.name }}</span>
            <span *ngIf="ingredient.isOptional" class="recipe-cooking__optional">{{
              'recipes.optional' | t
            }}</span>
          </li>
        </ul>
      </section>

      <div class="recipe-cooking__layout">
        <aside class="recipe-cooking__ingredients" [attr.aria-label]="'dashboard.ingredients' | t">
          <h3>{{ 'dashboard.ingredients' | t }}</h3>
          <ul class="recipe-cooking__ingredient-list">
            <li *ngFor="let ingredient of recipe.ingredients" data-test="cooking-ingredient">
              <strong>
                {{ scaledQuantity(ingredient.quantity) | number: '1.0-2' }} {{ ingredient.unit }}
              </strong>
              <span>{{ ingredient.name }}</span>
              <span *ngIf="ingredient.isOptional" class="recipe-cooking__optional">{{
                'recipes.optional' | t
              }}</span>
              <span *ngIf="ingredient.preparation" class="recipe-cooking__ingredient-note">
                {{ ingredient.preparation }}
              </span>
            </li>
          </ul>
        </aside>

        <section
          class="recipe-cooking__steps"
          [attr.aria-label]="'recipes.cooking.steps_label' | t"
        >
          <ol class="recipe-cooking__timeline" data-test="cooking-step-list">
            <li
              *ngFor="let step of steps; let index = index"
              class="recipe-cooking__step"
              [class.recipe-cooking__step--focused]="focusedStepIndex() === index"
              [class.recipe-cooking__step--complete]="isStepComplete(index)"
              [attr.data-step-number]="step.stepNumber"
              data-test="recipe-cooking-step"
            >
              <div class="recipe-cooking__marker" aria-hidden="true">
                <span>{{ step.stepNumber }}</span>
              </div>

              <div class="recipe-cooking__step-content">
                <header class="recipe-cooking__step-heading">
                  <button
                    type="button"
                    class="recipe-cooking__step-focus"
                    [attr.aria-current]="focusedStepIndex() === index ? 'step' : null"
                    (click)="focusStep(index)"
                  >
                    <span>{{ 'recipes.paso_n' | t: { n: step.stepNumber } }}</span>
                    <span class="recipe-cooking__visually-hidden">{{
                      'recipes.cooking.focus_step' | t: { n: step.stepNumber }
                    }}</span>
                  </button>
                  <span *ngIf="step.duration" class="recipe-cooking__duration">
                    {{ 'recipes.min' | t: { n: step.duration } }}
                  </span>
                  <label
                    class="recipe-cooking__step-check"
                    [attr.data-test]="'cooking-step-check-' + step.stepNumber"
                  >
                    <input
                      type="checkbox"
                      [checked]="isStepComplete(index)"
                      [attr.aria-label]="'recipes.cooking.check_step' | t: { n: step.stepNumber }"
                      (change)="setStepComplete(index, $event)"
                    />
                    <span aria-hidden="true"></span>
                  </label>
                </header>

                <p class="recipe-cooking__instruction">{{ step.instruction }}</p>
                <p *ngIf="step.temperature" class="recipe-cooking__temperature">
                  {{
                    'recipes.step_temperature_value'
                      | t: { value: step.temperature.value, unit: step.temperature.unit }
                  }}
                </p>
                <app-recipe-step-video-player
                  *ngIf="focusedStepIndex() === index && step.videoId"
                  [recipeId]="recipe.id"
                  [videoId]="step.videoId"
                  [video]="step.video ?? null"
                />
                <p *ngIf="step.tips" class="recipe-cooking__tip">
                  <app-icon name="help_outline" [size]="16" [label]="null" /> {{ step.tips }}
                </p>
                <p *ngIf="step.warning" class="recipe-cooking__warning">
                  <app-icon name="error_outline" [size]="16" [label]="null" /> {{ step.warning }}
                </p>
              </div>

              <aside
                *ngIf="step.timerRequired && step.timerDuration"
                class="recipe-cooking__timer"
                [attr.aria-label]="'recipes.timer_paso' | t: { n: step.stepNumber }"
              >
                <app-timer
                  [duration]="timerDurationSeconds(step)"
                  [label]="'recipes.timer_paso' | t: { n: step.stepNumber }"
                  [compact]="true"
                  (timerStart)="onTimerStart(index, step)"
                  (timerPause)="onTimerPause(index)"
                  (timerReset)="onTimerReset(index, step)"
                  (timerTick)="onTimerTick(index, $event)"
                  (timerComplete)="onTimerComplete(index, step)"
                />
              </aside>
            </li>
          </ol>

          <section
            *ngIf="activeRecipeTimers().length > 0"
            class="recipe-cooking__active-timers"
            data-test="cooking-active-timers"
            [attr.aria-label]="'recipes.cooking.active_timers' | t"
          >
            <h3>{{ 'recipes.cooking.active_timers' | t }}</h3>
            <ul>
              <li *ngFor="let timer of activeRecipeTimers()">
                <button type="button" (click)="focusStep(timer.index)">
                  <span>{{ 'recipes.paso_n' | t: { n: timer.stepNumber } }}</span>
                  <span>{{ timer.instruction }}</span>
                  <strong>{{ formatTime(timer.currentTime) }}</strong>
                  <span class="recipe-cooking__visually-hidden">{{
                    'recipes.cooking.focus_timer' | t: { n: timer.stepNumber }
                  }}</span>
                </button>
              </li>
            </ul>
          </section>

          <nav
            class="recipe-cooking__mobile-navigation"
            [attr.aria-label]="'recipes.cooking.step_navigation' | t"
          >
            <app-button
              variant="outline"
              [disabled]="focusedStepIndex() === 0"
              (onClick)="focusStep(focusedStepIndex() - 1)"
            >
              {{ 'recipes.cooking.previous_step' | t }}
            </app-button>
            <app-button
              variant="outline"
              [disabled]="focusedStepIndex() >= steps.length - 1"
              (onClick)="focusStep(focusedStepIndex() + 1)"
            >
              {{ 'recipes.cooking.next_step' | t }}
            </app-button>
          </nav>
        </section>
      </div>

      <p
        class="recipe-cooking__timer-notice"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-test="cooking-timer-notice"
      >
        <ng-container *ngIf="completedTimerStep() as stepNumber">
          {{ 'recipes.cooking.timer_finished' | t: { n: stepNumber } }}
        </ng-container>
      </p>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .recipe-cooking {
        --recipe-cooking-focus: var(--color-primary-700);
        color: var(--text-primary);
      }

      :host-context([data-theme='dark']) .recipe-cooking {
        --recipe-cooking-focus: var(--color-primary-300);
      }

      .recipe-cooking__header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: start;
        gap: var(--space-4);
        padding-bottom: var(--space-4);
        border-bottom: 1px solid var(--border-default);
      }

      .recipe-cooking__heading h1,
      .recipe-cooking__ingredients h3,
      .recipe-cooking__active-timers h3 {
        margin: 0;
        font-size: var(--text-lg);
        line-height: var(--leading-tight);
      }

      .recipe-cooking__time,
      .recipe-cooking__step-progress {
        margin: var(--space-1) 0 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .recipe-cooking__time span {
        font-weight: var(--font-medium);
      }

      .recipe-cooking__progress-track {
        height: 6px;
        margin-top: var(--space-3);
        overflow: hidden;
        border-radius: var(--radius-full);
        background: var(--bg-tertiary);
      }

      .recipe-cooking__progress-track span {
        display: block;
        height: 100%;
        background: var(--recipe-cooking-focus);
        transition: width var(--transition-fast);
      }

      .recipe-cooking__servings {
        display: grid;
        justify-items: center;
        gap: var(--space-1);
      }

      .recipe-cooking__servings-label {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .recipe-cooking__servings-control {
        display: grid;
        grid-template-columns: 44px minmax(52px, 5.5rem) 44px;
        align-items: center;
        gap: var(--space-2);
      }

      .recipe-cooking__servings-control input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        height: var(--button-control-height);
        padding: var(--space-2);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
        text-align: center;
      }

      .recipe-cooking__servings-control input:focus-visible,
      .recipe-cooking__ingredients-toggle:focus-visible,
      .recipe-cooking__step-focus:focus-visible,
      .recipe-cooking__active-timers button:focus-visible {
        outline: 2px solid var(--recipe-cooking-focus);
        outline-offset: 2px;
      }

      .recipe-cooking__step-check input:focus-visible + span {
        outline: 2px solid var(--recipe-cooking-focus);
        outline-offset: 2px;
      }

      .recipe-cooking__layout {
        display: grid;
        grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
        gap: var(--space-6);
        padding-top: var(--space-5);
      }

      .recipe-cooking__ingredients {
        min-width: 0;
        padding-right: var(--space-5);
        border-right: 1px solid var(--border-default);
      }

      .recipe-cooking__ingredient-list {
        display: grid;
        gap: var(--space-3);
        margin: var(--space-4) 0 0;
        padding: 0;
        list-style: none;
      }

      .recipe-cooking__ingredient-list li {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: var(--space-1) var(--space-2);
        align-items: baseline;
        padding-bottom: var(--space-2);
        border-bottom: 1px solid var(--border-default);
        overflow-wrap: anywhere;
      }

      .recipe-cooking__ingredient-list li strong {
        white-space: nowrap;
      }

      .recipe-cooking__optional,
      .recipe-cooking__ingredient-note {
        grid-column: 1 / -1;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .recipe-cooking__steps {
        min-width: 0;
      }

      .recipe-cooking__timeline {
        display: grid;
        gap: var(--space-3);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .recipe-cooking__step {
        position: relative;
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) minmax(216px, 260px);
        gap: var(--space-3);
        align-items: center;
        min-width: 0;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }

      .recipe-cooking__step--focused {
        border-color: var(--recipe-cooking-focus);
        background: var(--bg-secondary);
      }

      .recipe-cooking__step--complete .recipe-cooking__marker span {
        border-color: var(--color-success-700);
        background: var(--color-success-700);
        color: var(--white);
      }

      .recipe-cooking__marker {
        align-self: stretch;
        display: flex;
        justify-content: center;
        padding-top: var(--space-1);
      }

      .recipe-cooking__marker span {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-full);
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }

      .recipe-cooking__step-content {
        min-width: 0;
      }

      .recipe-cooking__step-heading {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: 44px;
      }

      .recipe-cooking__step-focus {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        min-height: 44px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-weight: var(--font-semibold);
        text-align: left;
        cursor: pointer;
      }

      .recipe-cooking__duration {
        color: var(--text-secondary);
        font-size: var(--text-sm);
        white-space: nowrap;
      }

      .recipe-cooking__step-check {
        display: grid;
        place-items: center;
        width: 44px;
        min-width: 44px;
        height: 44px;
        margin-left: auto;
        cursor: pointer;
      }

      .recipe-cooking__step-check input {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        clip-path: inset(50%);
      }

      .recipe-cooking__step-check span {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-full);
        background: var(--bg-primary);
      }

      .recipe-cooking__step-check input:checked + span {
        border-color: var(--color-success-700);
        background: var(--color-success-700);
      }

      .recipe-cooking__step-check input:checked + span::after {
        width: 6px;
        height: 10px;
        border: solid var(--white);
        border-width: 0 2px 2px 0;
        content: '';
        transform: rotate(45deg) translate(-1px, -1px);
      }

      .recipe-cooking__instruction {
        margin: var(--space-1) 0 0;
        line-height: var(--leading-relaxed);
        overflow-wrap: anywhere;
      }

      .recipe-cooking__temperature {
        margin: var(--space-1) 0 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
      }

      .recipe-cooking__tip,
      .recipe-cooking__warning {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        margin: var(--space-3) 0 0;
        font-size: var(--text-sm);
      }

      .recipe-cooking__tip {
        color: var(--text-secondary);
      }

      .recipe-cooking__warning {
        color: var(--color-error-700);
      }

      :host-context([data-theme='dark']) .recipe-cooking__warning {
        color: var(--color-error-100);
      }

      .recipe-cooking__timer {
        min-width: 0;
      }

      .recipe-cooking__active-timers,
      .recipe-cooking__mobile-navigation,
      .recipe-cooking__ingredients-toggle,
      .recipe-cooking__mobile-ingredients {
        display: none;
      }

      .recipe-cooking__timer-notice:not(:empty) {
        margin: var(--space-4) 0 0;
        padding: var(--space-3) var(--space-4);
        border-left: 3px solid var(--color-success-700);
        background: var(--bg-secondary);
      }

      :host-context([data-theme='dark']) .recipe-cooking__timer-notice:not(:empty) {
        border-left-color: var(--color-success-100);
      }

      .recipe-cooking__timer-notice:empty {
        display: none;
      }

      .recipe-cooking__visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (max-width: 760px) {
        .recipe-cooking__header {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: var(--space-3);
        }

        .recipe-cooking__heading {
          grid-column: 1 / -1;
        }

        .recipe-cooking__servings {
          grid-column: 1;
          grid-row: 2;
          justify-items: start;
        }

        .recipe-cooking__header > app-button {
          grid-column: 2;
          grid-row: 2;
          justify-self: end;
        }

        .recipe-cooking__ingredients-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-height: var(--button-control-height);
          margin-top: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          color: var(--text-primary);
          font: inherit;
          text-align: left;
          cursor: pointer;
        }

        .recipe-cooking__mobile-ingredients {
          display: block;
          padding: 0 var(--space-3) var(--space-3);
          border: 1px solid var(--border-default);
          border-top: 0;
          border-radius: 0 0 var(--radius-md) var(--radius-md);
        }

        .recipe-cooking__layout {
          display: block;
          padding-top: var(--space-4);
        }

        .recipe-cooking__ingredients {
          display: none;
        }

        .recipe-cooking__step {
          display: none;
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: start;
          gap: var(--space-3);
          padding: var(--space-3);
        }

        .recipe-cooking__step--focused {
          display: grid;
        }

        .recipe-cooking__step-content {
          grid-column: 2;
        }

        .recipe-cooking__timer {
          grid-column: 2;
          margin-top: var(--space-2);
        }

        .recipe-cooking__active-timers {
          display: block;
          margin-top: var(--space-4);
          padding-top: var(--space-3);
          border-top: 1px solid var(--border-default);
        }

        .recipe-cooking__active-timers h3 {
          margin: 0 0 var(--space-2);
          font-size: var(--text-base);
        }

        .recipe-cooking__active-timers ul {
          display: grid;
          gap: var(--space-2);
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .recipe-cooking__active-timers button {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr) max-content;
          align-items: center;
          width: 100%;
          min-height: var(--button-control-height);
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          color: var(--text-primary);
          font: inherit;
          text-align: left;
        }

        .recipe-cooking__mobile-navigation {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
          margin-top: var(--space-4);
          padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
        }

        .recipe-cooking__mobile-navigation app-button {
          flex: 1 1 0;
        }
      }

      @media (max-width: 360px) {
        .recipe-cooking__header {
          grid-template-columns: minmax(0, 1fr);
        }

        .recipe-cooking__servings {
          grid-column: 1;
          grid-row: auto;
        }

        .recipe-cooking__header > app-button {
          grid-column: 1;
          grid-row: auto;
          justify-self: start;
        }

        .recipe-cooking__servings-control {
          grid-template-columns: 44px minmax(48px, 5rem) 44px;
        }

        .recipe-cooking__active-timers button {
          grid-template-columns: minmax(0, 1fr) max-content;
        }

        .recipe-cooking__active-timers button span:nth-child(2) {
          grid-column: 1 / -1;
          grid-row: 2;
        }
      }
    `
  ]
})
export class RecipeCookingViewComponent {
  @Input({ required: true }) recipe!: Recipe;
  @Input() steps: RecipeInstructionStep[] = [];
  @Input() servings = 2;

  @Output() servingsChange = new EventEmitter<number>();
  @Output() exit = new EventEmitter<void>();

  readonly maxSafeInteger = Number.MAX_SAFE_INTEGER;
  readonly focusedStepIndex = signal(0);
  readonly completedSteps = signal<ReadonlySet<number>>(new Set<number>());
  readonly mobileIngredientsExpanded = signal(false);
  readonly timerProgress = signal<Readonly<Record<number, TimerSnapshot>>>({});
  readonly completedTimerStep = signal<number | null>(null);

  completionPercent(): number {
    return this.steps.length ? (this.completedSteps().size / this.steps.length) * 100 : 0;
  }

  isStepComplete(index: number): boolean {
    return this.completedSteps().has(index);
  }

  setStepComplete(index: number, event: Event): void {
    const isComplete = (event.target as HTMLInputElement).checked;
    const nextCompleted = new Set(this.completedSteps());
    if (isComplete) nextCompleted.add(index);
    else nextCompleted.delete(index);
    this.completedSteps.set(nextCompleted);
  }

  focusStep(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.steps.length) return;
    this.focusedStepIndex.set(index);
  }

  toggleMobileIngredients(): void {
    this.mobileIngredientsExpanded.update((expanded) => !expanded);
  }

  scaledQuantity(quantity: number): number {
    return scaleRecipeQuantity(quantity, this.recipe.servings || 2, this.servings);
  }

  adjustServings(delta: -1 | 1): void {
    const servings = this.servings + delta;
    if (Number.isSafeInteger(servings) && servings >= 1) this.servingsChange.emit(servings);
  }

  setServingsFromInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isSafeInteger(value) && value >= 1) {
      this.servingsChange.emit(value);
      return;
    }
    input.value = String(this.servings);
  }

  timerDurationSeconds(step: RecipeInstructionStep): number {
    return Math.max(0, Math.round((step.timerDuration ?? 0) * 60));
  }

  activeRecipeTimers(): ActiveRecipeTimer[] {
    const progress = this.timerProgress();
    return this.steps.flatMap((step, index) => {
      const timer = progress[index];
      if (timer?.state !== 'running' && timer?.state !== 'paused') return [];
      return [
        {
          index,
          stepNumber: step.stepNumber,
          instruction: step.instruction,
          currentTime: timer.currentTime
        }
      ];
    });
  }

  formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  onTimerStart(index: number, step: RecipeInstructionStep): void {
    this.completedTimerStep.set(null);
    const previous = this.timerProgress()[index];
    this.updateTimer(index, {
      state: 'running',
      currentTime:
        previous?.state === 'paused' ? previous.currentTime : this.timerDurationSeconds(step)
    });
  }

  onTimerPause(index: number): void {
    this.updateTimer(index, { state: 'paused' });
  }

  onTimerReset(index: number, step: RecipeInstructionStep): void {
    this.updateTimer(index, {
      state: 'idle',
      currentTime: this.timerDurationSeconds(step)
    });
  }

  onTimerTick(index: number, currentTime: number): void {
    this.updateTimer(index, { currentTime });
  }

  onTimerComplete(index: number, step: RecipeInstructionStep): void {
    this.updateTimer(index, { state: 'finished', currentTime: 0 });
    this.completedTimerStep.set(step.stepNumber);
  }

  private updateTimer(index: number, update: Partial<TimerSnapshot>): void {
    const step = this.steps[index];
    const current =
      this.timerProgress()[index] ??
      ({ state: 'idle', currentTime: this.timerDurationSeconds(step) } satisfies TimerSnapshot);
    this.timerProgress.update((progress) => ({
      ...progress,
      [index]: { ...current, ...update }
    }));
  }
}
