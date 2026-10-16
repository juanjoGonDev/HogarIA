import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Recipe } from '../../shared/models/recipe.model';
import type { RecipeInstructionStep } from '../../shared/models/recipe-instructions';
import type { DetailLevel } from '../../shared/models/ai-config.model';
import { recipeDetailLevelLabelKey, scaleRecipeQuantity } from './recipe-detail.util';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import {
  BadgeComponent,
  type BadgeVariant
} from '../../shared/components/ui/badge/badge.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { RecipeCookingViewComponent } from './recipe-cooking-view.component';
import type { TranslationKey } from '../../core/i18n';

export type RecipeDetailSection = 'preparation' | 'ingredients' | 'guidance' | 'storage';

@Component({
  selector: 'app-recipe-detail-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    TranslatePipe,
    RecipeCookingViewComponent
  ],
  template: `
    <section
      class="recipe-detail-page"
      [class.recipe-detail-page--cooking]="isCookingMode"
      data-test="recipe-detail-page"
      [attr.aria-labelledby]="isCookingMode ? 'recipe-cooking-title' : 'recipe-detail-title'"
    >
      <header class="recipe-detail-page__header">
        <app-button
          class="recipe-detail-page__back"
          variant="ghost"
          (onClick)="closeRequested.emit()"
        >
          <app-icon name="chevron_left" [size]="18" [label]="null" />
          <span class="recipe-detail-page__back-label">{{ 'recipes.return_to_list' | t }}</span>
        </app-button>
        <h1
          *ngIf="!isCookingMode"
          id="recipe-detail-title"
          data-test="recipe-detail-title"
          tabindex="-1"
        >
          {{ recipe.name }}
        </h1>
        <div *ngIf="!isCookingMode" class="recipe-detail-page__actions">
          <app-button
            class="recipe-detail-page__favorite"
            variant="ghost"
            size="icon"
            [touchTarget]="true"
            data-test="recipe-favorite-toggle"
            (onClick)="favoriteToggled.emit()"
          >
            <app-icon
              [name]="recipe.isFavorite ? 'favorite' : 'star_outline'"
              [size]="18"
              [label]="null"
            />
            <span class="visually-hidden">{{
              (recipe.isFavorite ? 'recipes.remove_from_favorites' : 'recipes.add_to_favorites') | t
            }}</span>
          </app-button>
          <app-button
            *ngIf="canEdit"
            class="recipe-detail-page__edit"
            variant="outline"
            data-test="recipe-edit-action"
            (onClick)="editRequested.emit()"
          >
            <app-icon name="edit" [size]="16" [label]="null" />
            {{ 'recipes.edit_recipe' | t }}
          </app-button>
        </div>
      </header>
      <article
        class="recipe-detail"
        [class.recipe-detail--preparation]="detailSection === 'preparation'"
        [class.recipe-detail--no-cover]="!imageUrl"
        [class.recipe-detail--has-batch-warning]="
          !isCookingMode && !!recipe.guidance?.batchCookingWarning
        "
        data-test="recipe-full-detail"
      >
        <app-recipe-cooking-view
          *ngIf="hasCookingSession"
          [hidden]="!isCookingMode"
          [cookingModeActive]="isCookingMode"
          [recipe]="recipe"
          [steps]="steps"
          [servings]="servings"
          (servingsChange)="servingsChanged.emit($event)"
          (exit)="cookingModeExited.emit()"
        />
        <header
          *ngIf="!isCookingMode"
          class="recipe-detail__hero"
          [class.recipe-detail__hero--no-cover]="!imageUrl"
        >
          <div *ngIf="imageUrl as resolvedImageUrl" class="recipe-detail__cover">
            <img
              [src]="resolvedImageUrl"
              [alt]="
                recipe.imageAttribution?.altText ||
                ('recipes.book.cover_alt' | t: { name: recipe.name })
              "
            />
            <p *ngIf="recipe.imageAttribution as credit" class="recipe-detail__image-credit">
              <span>{{ 'recipes.step_photo_credit' | t: { author: credit.author } }}</span>
              <a [href]="credit.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                credit.licenseName
              }}</a>
              <a [href]="credit.sourceUrl" target="_blank" rel="noopener noreferrer">{{
                'recipes.step_photo_source' | t
              }}</a>
            </p>
          </div>
          <div class="recipe-detail__header">
            <div class="recipe-detail__meta">
              <span *ngIf="recipe.countryCode">{{ countryLabel }}</span>
              <span *ngIf="recipe.cuisine">{{ recipe.cuisine }}</span>
              <app-badge [variant]="difficultyVariant">
                {{ difficultyLabel }}
              </app-badge>
            </div>
            <p class="recipe-detail__description">{{ recipe.description }}</p>
            <div class="recipe-detail__timings" [attr.aria-label]="'recipes.total_time' | t">
              <span
                ><strong
                  ><span class="recipe-detail__timing-label--full">{{
                    'recipes.total_time' | t
                  }}</span
                  ><span class="recipe-detail__timing-label--compact">{{
                    'recipes.total_time_compact' | t
                  }}</span></strong
                >
                {{ 'recipes.min' | t: { n: recipe.totalTime } }}</span
              >
              <span *ngIf="recipe.prepTime"
                ><strong
                  ><span class="recipe-detail__timing-label--full">{{
                    'recipes.prep_time' | t
                  }}</span
                  ><span class="recipe-detail__timing-label--compact">{{
                    'recipes.prep_time_compact' | t
                  }}</span></strong
                >
                {{ 'recipes.min' | t: { n: recipe.prepTime } }}</span
              >
              <span *ngIf="recipe.cookTime"
                ><strong
                  ><span class="recipe-detail__timing-label--full">{{
                    'recipes.cook_time' | t
                  }}</span
                  ><span class="recipe-detail__timing-label--compact">{{
                    'recipes.cook_time_compact' | t
                  }}</span></strong
                >
                {{ 'recipes.min' | t: { n: recipe.cookTime } }}</span
              >
              <span *ngIf="recipe.restTime"
                ><strong
                  ><span class="recipe-detail__timing-label--full">{{
                    'recipes.rest_time' | t
                  }}</span
                  ><span class="recipe-detail__timing-label--compact">{{
                    'recipes.rest_time_compact' | t
                  }}</span></strong
                >
                {{ 'recipes.min' | t: { n: recipe.restTime } }}</span
              >
            </div>
          </div>
        </header>

        <section
          *ngIf="!isCookingMode && recipe.guidance?.batchCookingWarning"
          class="recipe-detail__section recipe-detail__panel recipe-detail__batch-warning"
          data-test="recipe-batch-warning"
          role="note"
        >
          <h3>{{ 'recipes.batch_cooking_warning_heading' | t }}</h3>
          <p>{{ recipe.guidance?.batchCookingWarning }}</p>
        </section>

        <div *ngIf="!isCookingMode" class="recipe-detail__workspace">
          <nav
            class="recipe-detail__tabs"
            role="tablist"
            [attr.aria-label]="'recipes.detail.tabs_label' | t"
            data-test="recipe-detail-tabs"
          >
            <button
              type="button"
              role="tab"
              id="recipe-detail-tab-preparation"
              aria-controls="recipe-detail-panel-preparation"
              data-test="recipe-detail-tab-preparation"
              [attr.aria-selected]="detailSection === 'preparation'"
              [attr.tabindex]="detailSection === 'preparation' ? 0 : -1"
              [class.is-active]="detailSection === 'preparation'"
              (click)="detailSectionChanged.emit('preparation')"
              (keydown)="handleDetailTabKeydown($event, 0)"
            >
              <span class="recipe-detail__tab-label--full">{{ 'recipes.preparacion' | t }}</span>
              <span class="recipe-detail__tab-label--compact">{{
                'recipes.detail.mobile_preparation' | t
              }}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="recipe-detail-tab-ingredients"
              aria-controls="recipe-detail-panel-ingredients"
              data-test="recipe-detail-tab-ingredients"
              [attr.aria-selected]="detailSection === 'ingredients'"
              [attr.tabindex]="detailSection === 'ingredients' ? 0 : -1"
              [class.is-active]="detailSection === 'ingredients'"
              (click)="detailSectionChanged.emit('ingredients')"
              (keydown)="handleDetailTabKeydown($event, 1)"
            >
              {{ 'dashboard.ingredients' | t }}
            </button>
            <button
              type="button"
              role="tab"
              id="recipe-detail-tab-guidance"
              aria-controls="recipe-detail-panel-guidance"
              data-test="recipe-detail-tab-guidance"
              [attr.aria-selected]="detailSection === 'guidance'"
              [attr.tabindex]="detailSection === 'guidance' ? 0 : -1"
              [class.is-active]="detailSection === 'guidance'"
              (click)="detailSectionChanged.emit('guidance')"
              (keydown)="handleDetailTabKeydown($event, 2)"
            >
              <span class="recipe-detail__tab-label--full">{{
                'recipes.detail.guidance' | t
              }}</span>
              <span class="recipe-detail__tab-label--compact">{{
                'recipes.detail.mobile_guidance' | t
              }}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="recipe-detail-tab-storage"
              aria-controls="recipe-detail-panel-storage"
              data-test="recipe-detail-tab-storage"
              [attr.aria-selected]="detailSection === 'storage'"
              [attr.tabindex]="detailSection === 'storage' ? 0 : -1"
              [class.is-active]="detailSection === 'storage'"
              (click)="detailSectionChanged.emit('storage')"
              (keydown)="handleDetailTabKeydown($event, 3)"
            >
              <span class="recipe-detail__tab-label--full">{{ 'recipes.conservacion' | t }}</span>
              <span class="recipe-detail__tab-label--compact">{{
                'recipes.detail.mobile_storage' | t
              }}</span>
            </button>
          </nav>

          <div
            class="recipe-detail__tab-layout"
            [class.recipe-detail__tab-layout--preparation]="detailSection === 'preparation'"
          >
            <section
              [hidden]="detailSection !== 'preparation'"
              id="recipe-detail-panel-preparation"
              role="tabpanel"
              tabindex="0"
              aria-labelledby="recipe-detail-tab-preparation"
              class="recipe-detail__tab-panel recipe-detail__section"
              data-test="recipe-preparation"
            >
              <div class="recipe-detail__section-header">
                <h3>{{ 'recipes.preparacion' | t }}</h3>
                <div
                  *ngIf="recipe.instructionsByLevel"
                  class="recipe-detail__detail-level"
                  role="group"
                  [attr.aria-label]="'recipes.detalle' | t"
                  data-test="recipe-detail-level"
                >
                  <button
                    type="button"
                    data-test="recipe-detail-level-basic"
                    [attr.aria-pressed]="detailLevel === 'basic'"
                    [class.is-active]="detailLevel === 'basic'"
                    (click)="selectDetailLevel('basic')"
                  >
                    {{ detailLevelLabel('basic') | t }}
                  </button>
                  <button
                    type="button"
                    data-test="recipe-detail-level-intermediate"
                    [attr.aria-pressed]="detailLevel === 'intermediate'"
                    [class.is-active]="detailLevel === 'intermediate'"
                    (click)="selectDetailLevel('intermediate')"
                  >
                    {{ detailLevelLabel('intermediate') | t }}
                  </button>
                  <button
                    type="button"
                    data-test="recipe-detail-level-expert"
                    [attr.aria-pressed]="detailLevel === 'expert'"
                    [class.is-active]="detailLevel === 'expert'"
                    (click)="selectDetailLevel('expert')"
                  >
                    {{ detailLevelLabel('expert') | t }}
                  </button>
                </div>
              </div>
              <div
                id="recipe-detail-steps"
                class="recipe-detail__steps"
                [class.is-expanded]="showAllPreparationSteps"
              >
                <article
                  *ngFor="let step of steps; let index = index"
                  class="step-card"
                  [class.recipe-detail__step--mobile-preview-extra]="index > 0"
                  [class.recipe-detail__step--desktop-preview-extra]="index > 2"
                  [attr.data-step-number]="step.stepNumber"
                >
                  <div class="step-card__header">
                    <span class="step-card__number">{{
                      'recipes.paso_n' | t: { n: step.stepNumber }
                    }}</span>
                    <div class="step-card__metrics">
                      <span *ngIf="step.duration" class="step-card__time">{{
                        'recipes.min' | t: { n: step.duration }
                      }}</span>
                      <span *ngIf="step.temperature" class="step-card__temperature">
                        {{
                          'recipes.step_temperature_value'
                            | t: { value: step.temperature.value, unit: step.temperature.unit }
                        }}
                      </span>
                    </div>
                  </div>
                  <p class="step-card__instruction">{{ step.instruction }}</p>
                  <div *ngIf="step.tips" class="step-card__tip">
                    <app-icon name="help_outline" [size]="16" [label]="null" /> {{ step.tips }}
                  </div>
                  <div *ngIf="step.warning" class="step-card__warning">
                    <app-icon name="error_outline" [size]="16" [label]="null" />
                    {{ step.warning }}
                  </div>
                </article>
              </div>
              <button
                *ngIf="steps.length > 1"
                type="button"
                class="recipe-detail__show-steps recipe-detail__show-steps--mobile"
                data-test="recipe-expand-steps-mobile"
                aria-controls="recipe-detail-steps"
                [attr.aria-expanded]="showAllPreparationSteps"
                (click)="showAllPreparationSteps = !showAllPreparationSteps"
              >
                {{
                  (showAllPreparationSteps
                    ? 'recipes.detail.show_fewer_steps'
                    : 'recipes.detail.show_all_steps'
                  ) | t
                }}
                <app-icon
                  [name]="showAllPreparationSteps ? 'expand_less' : 'expand_more'"
                  [size]="18"
                  [label]="null"
                />
              </button>
              <button
                *ngIf="steps.length > 3"
                type="button"
                class="recipe-detail__show-steps recipe-detail__show-steps--desktop"
                data-test="recipe-expand-steps-desktop"
                aria-controls="recipe-detail-steps"
                [attr.aria-expanded]="showAllPreparationSteps"
                (click)="showAllPreparationSteps = !showAllPreparationSteps"
              >
                {{
                  (showAllPreparationSteps
                    ? 'recipes.detail.show_fewer_steps'
                    : 'recipes.detail.show_all_steps'
                  ) | t
                }}
                <app-icon
                  [name]="showAllPreparationSteps ? 'expand_less' : 'expand_more'"
                  [size]="18"
                  [label]="null"
                />
              </button>
            </section>

            <section
              [hidden]="detailSection !== 'preparation' && detailSection !== 'ingredients'"
              id="recipe-detail-panel-ingredients"
              role="tabpanel"
              tabindex="0"
              aria-labelledby="recipe-detail-tab-ingredients"
              class="recipe-detail__tab-panel recipe-detail__section recipe-detail__tab-panel--ingredients recipe-detail__panel"
              data-test="recipe-ingredients"
            >
              <div class="recipe-detail__ingredients-heading">
                <h3>{{ 'dashboard.ingredients' | t }}</h3>
                <div class="recipe-detail__servings">
                  <label for="saved-recipe-servings">{{ 'recipes.porciones' | t }}</label>
                  <input
                    id="saved-recipe-servings"
                    class="form-input"
                    type="number"
                    min="1"
                    [ngModel]="servings"
                    (ngModelChange)="servingsChanged.emit($event)"
                    data-test="recipe-serving-count"
                  />
                </div>
              </div>
              <span class="recipe-detail__hint">{{ 'recipes.scaled_only' | t }}</span>
              <ul class="recipe-detail__ingredients">
                <li *ngFor="let ing of recipe.ingredients; let index = index">
                  <label class="recipe-detail__ingredient-check">
                    <input
                      type="checkbox"
                      [checked]="checkedIngredients.has(index)"
                      [attr.aria-label]="ing.name"
                      data-test="recipe-ingredient-check"
                      (change)="ingredientChecked.emit({ index, event: $event })"
                    />
                    <span class="recipe-detail__ingredient-content">
                      <span class="recipe-detail__ingredient-line">
                        <strong
                          >{{ scaledIngredientQuantity(ing.quantity) | number: '1.0-2' }}
                          {{ ing.unit }}</strong
                        >
                        {{ ing.name }}
                        <span *ngIf="ing.isOptional" class="recipe-detail__optional">{{
                          'recipes.optional' | t
                        }}</span>
                      </span>
                      <span *ngIf="ing.preparation" class="recipe-detail__ingredient-note">{{
                        ing.preparation
                      }}</span>
                      <span *ngIf="ing.notes" class="recipe-detail__ingredient-note">{{
                        ing.notes
                      }}</span>
                      <span *ngIf="ing.substitutes?.length" class="recipe-detail__ingredient-note">
                        <strong>{{ 'recipes.substitutes' | t }}:</strong>
                        {{ ing.substitutes?.join(', ') }}
                      </span>
                    </span>
                  </label>
                </li>
              </ul>
              <div class="recipe-detail__ingredients-actions">
                <app-button
                  class="recipe-detail__ingredients-start"
                  variant="primary"
                  [fullWidth]="true"
                  data-test="recipe-cooking-open-sidebar"
                  (onClick)="cookingModeEntered.emit()"
                >
                  <app-icon name="kitchen" [size]="16" [label]="null" />
                  {{
                    (hasCookingSession ? 'recipes.cooking.mode_open' : 'recipes.cooking.start') | t
                  }}
                </app-button>
                <app-button
                  variant="outline"
                  [fullWidth]="true"
                  data-test="recipe-cooking-mark-done"
                  [disabled]="cookingRecipeId === recipe.id"
                  (onClick)="cookRequested.emit()"
                  >{{ 'recipes.cocinar_ahora' | t }}</app-button
                >
              </div>
            </section>

            <section
              [hidden]="detailSection !== 'guidance'"
              id="recipe-detail-panel-guidance"
              role="tabpanel"
              tabindex="0"
              aria-labelledby="recipe-detail-tab-guidance"
              class="recipe-detail__tab-panel recipe-detail__section"
              data-test="recipe-guidance"
            >
              <section
                *ngIf="recipe.guidance?.appliances?.length || recipe.utensils.length"
                class="recipe-detail__panel"
                data-test="recipe-equipment"
              >
                <h3>{{ 'recipes.appliances' | t }}</h3>
                <ul *ngIf="recipe.guidance?.appliances?.length" class="recipe-detail__plain-list">
                  <li *ngFor="let appliance of recipe.guidance?.appliances">{{ appliance }}</li>
                </ul>
                <h4 *ngIf="recipe.utensils.length">{{ 'recipes.utensils' | t }}</h4>
                <ul *ngIf="recipe.utensils.length" class="recipe-detail__plain-list">
                  <li *ngFor="let utensil of recipe.utensils">{{ utensil }}</li>
                </ul>
              </section>
              <section
                *ngIf="recipe.guidance?.parallelTasks?.length"
                class="recipe-detail__panel"
                data-test="recipe-parallel-tasks"
              >
                <h3>{{ 'recipes.parallel_tasks' | t }}</h3>
                <ul class="recipe-detail__plain-list">
                  <li *ngFor="let task of recipe.guidance?.parallelTasks">{{ task }}</li>
                </ul>
              </section>
              <section
                *ngIf="recipe.guidance?.tipsAndVariations?.length"
                class="recipe-detail__panel"
                data-test="recipe-tips-variations"
              >
                <h3>{{ 'recipes.tips_variations' | t }}</h3>
                <ul class="recipe-detail__plain-list">
                  <li *ngFor="let tip of recipe.guidance?.tipsAndVariations">{{ tip }}</li>
                </ul>
              </section>
              <section *ngIf="recipe.sourceAttribution as source" class="recipe-detail__source">
                <h3>{{ 'recipes.book.source' | t }}</h3>
                <strong>{{ source.publisher }}</strong>
                <p *ngIf="source.title">{{ source.title }}</p>
                <p *ngIf="source.note">{{ source.note }}</p>
                <a
                  *ngIf="sourceUrl as sourceUrl"
                  [href]="sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ 'recipes.book.open_source' | t }}</a
                >
              </section>
              <p
                *ngIf="
                  !recipe.guidance?.appliances?.length &&
                  !recipe.utensils.length &&
                  !recipe.guidance?.parallelTasks?.length &&
                  !recipe.guidance?.tipsAndVariations?.length &&
                  !recipe.sourceAttribution
                "
                class="recipe-detail__empty"
              >
                {{ 'recipes.detail.empty_guidance' | t }}
              </p>
            </section>

            <section
              [hidden]="detailSection !== 'storage'"
              id="recipe-detail-panel-storage"
              role="tabpanel"
              tabindex="0"
              aria-labelledby="recipe-detail-tab-storage"
              class="recipe-detail__tab-panel recipe-detail__section recipe-detail__panel"
              data-test="recipe-storage"
            >
              <ng-container *ngIf="recipe.storage; else noRecipeStorage">
                <h3>{{ 'recipes.conservacion' | t }}</h3>
                <p>
                  {{ recipe.storage.method }} ·
                  {{ 'recipes.storage_fridge' | t: { duration: recipe.storage.duration } }}
                </p>
                <p *ngIf="recipe.storage.container">
                  {{ 'recipes.container' | t: { name: recipe.storage.container } }}
                </p>
                <p *ngIf="recipe.storage.freezingPossible && recipe.storage.freezingDuration">
                  {{
                    'recipes.freezing_duration' | t: { duration: recipe.storage.freezingDuration }
                  }}
                </p>
                <p *ngIf="recipe.storage.freezingPossible === false">
                  {{ 'recipes.no_freezing' | t }}
                </p>
                <p *ngIf="recipe.storage.reheatingInstructions">
                  {{ 'recipes.recalentar' | t: { text: recipe.storage.reheatingInstructions } }}
                </p>
              </ng-container>
              <ng-template #noRecipeStorage>
                <h3>{{ 'recipes.conservacion' | t }}</h3>
                <p class="recipe-detail__empty">{{ 'recipes.detail.empty_storage' | t }}</p>
              </ng-template>
              <section
                *ngIf="recipe.nutrition || recipe.calories"
                class="recipe-detail__nutrition-section"
                data-test="recipe-nutrition"
              >
                <h4>{{ 'recipes.nutrition' | t }}</h4>
                <p *ngIf="recipe.calories" class="recipe-detail__calories">
                  {{ 'recipes.kcal_per_serving' | t: { n: recipe.calories } }}
                </p>
                <dl *ngIf="recipe.nutrition as nutrition" class="recipe-detail__nutrition">
                  <div *ngIf="nutrition.protein !== undefined">
                    <dt>{{ 'recipes.protein' | t }}</dt>
                    <dd>{{ nutrition.protein }} g</dd>
                  </div>
                  <div *ngIf="nutrition.carbs !== undefined">
                    <dt>{{ 'recipes.carbs' | t }}</dt>
                    <dd>{{ nutrition.carbs }} g</dd>
                  </div>
                  <div *ngIf="nutrition.fat !== undefined">
                    <dt>{{ 'recipes.fat' | t }}</dt>
                    <dd>{{ nutrition.fat }} g</dd>
                  </div>
                  <div *ngIf="nutrition.fiber !== undefined && nutrition.fiber !== null">
                    <dt>{{ 'recipes.fiber' | t }}</dt>
                    <dd>{{ nutrition.fiber }} g</dd>
                  </div>
                  <div *ngIf="nutrition.sugar !== undefined">
                    <dt>{{ 'recipes.sugar' | t }}</dt>
                    <dd>{{ nutrition.sugar }} g</dd>
                  </div>
                  <div *ngIf="nutrition.sodium !== undefined">
                    <dt>{{ 'recipes.sodium' | t }}</dt>
                    <dd>{{ nutrition.sodium }} mg</dd>
                  </div>
                </dl>
              </section>
            </section>
          </div>
        </div>

        <footer *ngIf="!isCookingMode" class="recipe-detail__actions">
          <app-button
            variant="primary"
            [fullWidth]="true"
            data-test="recipe-cooking-open"
            (onClick)="cookingModeEntered.emit()"
          >
            <app-icon name="kitchen" [size]="16" [label]="null" />
            {{ (hasCookingSession ? 'recipes.cooking.mode_open' : 'recipes.cooking.start') | t }}
          </app-button>
        </footer>
      </article>
    </section>
  `,
  styleUrls: ['./recipe-detail-view.component.css']
})
export class RecipeDetailViewComponent {
  @Input({ required: true }) recipe!: Recipe;
  @Input() isCookingMode = false;
  @Input() hasCookingSession = false;
  @Input() servings = 2;
  @Input() detailSection: RecipeDetailSection = 'preparation';
  @Input() checkedIngredients: ReadonlySet<number> = new Set<number>();
  @Input() detailLevel: DetailLevel = 'intermediate';
  @Input() cookingRecipeId: string | null = null;
  @Input() canEdit = false;
  @Input() imageUrl: string | null = null;
  @Input() difficultyLabel = '';
  @Input() difficultyVariant: BadgeVariant = 'warning';
  @Input() countryLabel = '';
  @Input() sourceUrl: string | null = null;
  @Input() steps: RecipeInstructionStep[] = [];

  showAllPreparationSteps = false;

  @Output() closeRequested = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<void>();
  @Output() servingsChanged = new EventEmitter<number | string>();
  @Output() detailSectionChanged = new EventEmitter<RecipeDetailSection>();
  @Output() detailLevelChanged = new EventEmitter<DetailLevel>();
  @Output() detailTabKeydown = new EventEmitter<{ event: KeyboardEvent; index: number }>();
  @Output() ingredientChecked = new EventEmitter<{ index: number; event: Event }>();
  @Output() cookingModeEntered = new EventEmitter<void>();
  @Output() cookRequested = new EventEmitter<void>();
  @Output() favoriteToggled = new EventEmitter<void>();
  @Output() cookingModeExited = new EventEmitter<void>();

  selectDetailLevel(level: DetailLevel): void {
    this.showAllPreparationSteps = false;
    this.detailLevelChanged.emit(level);
  }

  detailLevelLabel(level: DetailLevel): TranslationKey {
    return recipeDetailLevelLabelKey(level);
  }

  handleDetailTabKeydown(event: KeyboardEvent, index: number): void {
    this.detailTabKeydown.emit({ event, index });
  }

  scaledIngredientQuantity(quantity: number): number {
    return scaleRecipeQuantity(quantity, this.recipe.servings || 2, this.servings);
  }
}
