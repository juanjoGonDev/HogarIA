import { CommonModule, DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  Injector,
  inject,
  OnInit,
  OnDestroy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
  finalize,
  forkJoin,
  from,
  map,
  of,
  Subject,
  Subscription,
  switchMap,
  timer,
  tap
} from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AiService } from '../../core/services/ai.service';
import { I18nService } from '../../core/services/i18n.service';
import { RecipeService } from '../../core/services/recipe.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { PickerComponent, PickerOption } from '../../shared/components/ui/picker/picker.component';
import { Difficulty, MealType, MeasurementUnit, Recipe } from '../../shared/models/recipe.model';
import { RecipeDetailLevel } from '../../shared/models/recipe-instructions';
import { RecipeStepPhoto } from '../../shared/models/recipe-step-photo';
import {
  RecipeStepVideoCandidate,
  RecipeStepVideoScene
} from '../../shared/models/recipe-step-video';
import { AIRecipeImproveResponse, RecipeImproveScope } from '../../shared/models/ai-config.model';
import {
  buildRecipeEditPayload,
  createRecipeEditDraft,
  RecipeEditDraft,
  RecipeEditorStep,
  recipeToEditDraft
} from './recipe-edit.util';
import { RecipeImproveDialogComponent } from './recipe-improve-dialog.component';
import {
  applyRecipeImprovement as applyRecipeImprovementPatch,
  classifyRecipeMediaScene,
  recipeImprovementInput
} from './recipe-improve.util';

const DETAIL_LEVELS: RecipeDetailLevel[] = ['basic', 'intermediate', 'expert'];
const MEAL_TYPES: MealType[] = ['breakfast', 'brunch', 'lunch', 'snack', 'dinner', 'dessert'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const UNITS: MeasurementUnit[] = [
  'g',
  'kg',
  'ml',
  'l',
  'cup',
  'tbsp',
  'tsp',
  'unit',
  'bunch',
  'slice',
  'piece'
];
type PhotoSearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error';
type StepMediaSearchState = Exclude<PhotoSearchState, 'idle'>;
interface StepMediaSearchResult {
  photo: RecipeStepPhoto | null;
  videos: RecipeStepVideoCandidate[];
  failed: boolean;
}
type RecipeEditorTab =
  'basics' | 'ingredients' | 'instructions' | 'guidance' | 'nutrition' | 'media';

@Component({
  selector: 'app-recipe-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    PickerComponent,
    RecipeImproveDialogComponent
  ],
  template: `
    <div class="recipe-editor" data-test="recipe-editor-page" [attr.aria-busy]="loading">
      <div *ngIf="loading" class="recipe-editor__state" role="status" aria-live="polite">
        {{ 'recipes.editor.loading' | t }}
      </div>

      <section *ngIf="!loading && forbidden" class="recipe-editor__state" role="alert">
        <p>{{ 'recipes.editor.forbidden' | t }}</p>
        <app-button variant="outline" (onClick)="goToList()">
          {{ 'recipes.return_to_list' | t }}
        </app-button>
      </section>

      <section *ngIf="!loading && notFound" class="recipe-editor__state" role="alert">
        <p>{{ 'recipes.editor.not_found' | t }}</p>
        <app-button variant="outline" (onClick)="goToList()">
          {{ 'recipes.return_to_list' | t }}
        </app-button>
      </section>

      <form
        *ngIf="!loading && draft as form"
        class="recipe-editor__form"
        data-test="recipe-editor-form"
        (ngSubmit)="save()"
        novalidate
      >
        <header class="recipe-editor__header">
          <div class="recipe-editor__heading">
            <app-button variant="ghost" (onClick)="cancelEditing()">
              <app-icon name="chevron_left" [size]="18" [label]="null" />
              {{ 'recipes.return_to_list' | t }}
            </app-button>
            <h1 id="recipe-editor-title" tabindex="-1" data-test="recipe-editor-title">
              {{ (isCreateMode ? 'recipes.editor.create_title' : 'recipes.editor.title') | t }}
            </h1>
            <p>
              {{
                (isCreateMode ? 'recipes.editor.create_subtitle' : 'recipes.editor.subtitle') | t
              }}
            </p>
            <p *ngIf="!isCreateMode" class="recipe-editor__recipe-name">{{ form.name }}</p>
          </div>
          <app-button
            class="recipe-editor__improve-trigger"
            variant="outline"
            [fullWidth]="true"
            [type]="'button'"
            [disabled]="saving"
            data-test="recipe-improve-open"
            (onClick)="openRecipeImprovement()"
          >
            <app-icon name="smart_toy" [size]="18" [label]="null" />
            {{ 'recipes.improve.button' | t }}
          </app-button>
        </header>

        <p
          *ngIf="formError"
          class="recipe-editor__message"
          role="alert"
          tabindex="-1"
          data-test="recipe-editor-error"
        >
          {{ formError | t }}
        </p>

        <nav
          class="recipe-editor__tabs"
          role="tablist"
          [attr.aria-label]="'recipes.editor.sections_label' | t"
          data-test="recipe-editor-tabs"
        >
          <button
            *ngFor="let tab of editorTabs; let index = index"
            type="button"
            role="tab"
            class="recipe-editor__tab"
            [id]="'recipe-editor-tab-' + tab.id"
            [attr.aria-controls]="'editor-panel-' + tab.id"
            [attr.aria-selected]="activeTab === tab.id"
            [attr.tabindex]="activeTab === tab.id ? 0 : -1"
            [class.is-active]="activeTab === tab.id"
            (click)="setActiveTab(tab.id)"
            (keydown)="onEditorTabKeydown($event, index)"
          >
            {{ tab.label | t }}
          </button>
        </nav>

        <section
          [hidden]="activeTab !== 'basics'"
          id="editor-panel-basics"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-basics"
          data-test="editor-panel-basics"
          class="editor-section"
        >
          <h2 id="editor-basics-title">{{ 'recipes.editor.section_basics' | t }}</h2>
          <div class="editor-grid">
            <div class="editor-field editor-field--wide">
              <label for="editor-name">{{ 'recipes.editor.name' | t }}</label>
              <input
                id="editor-name"
                class="form-input"
                name="name"
                [(ngModel)]="form.name"
                required
                maxlength="120"
              />
            </div>
            <div class="editor-field editor-field--wide">
              <label for="editor-description">{{ 'recipes.editor.description' | t }}</label>
              <textarea
                id="editor-description"
                class="form-input editor-textarea"
                name="description"
                [(ngModel)]="form.description"
                rows="3"
                maxlength="2000"
              ></textarea>
            </div>
            <div class="editor-field">
              <span>{{ 'recipes.editor.difficulty' | t }}</span>
              <app-picker
                id="editor-difficulty"
                [options]="difficultyOptions"
                [value]="form.difficulty"
                [label]="'recipes.editor.difficulty' | t"
                (valueChange)="setDifficulty(form, $event)"
              />
            </div>
            <div class="editor-field">
              <label for="editor-cuisine">{{ 'recipes.editor.cuisine' | t }}</label>
              <input
                id="editor-cuisine"
                class="form-input"
                name="cuisine"
                [(ngModel)]="form.cuisine"
                maxlength="80"
              />
            </div>
            <div class="editor-field">
              <label for="editor-country">{{ 'recipes.editor.country' | t }}</label>
              <input
                id="editor-country"
                class="form-input"
                name="countryCode"
                [(ngModel)]="form.countryCode"
                maxlength="2"
                autocomplete="off"
              />
            </div>
            <div class="editor-field editor-field--wide">
              <fieldset class="editor-choice-group">
                <legend>{{ 'recipes.editor.meal_types' | t }}</legend>
                <label *ngFor="let meal of mealTypes" class="editor-check">
                  <input
                    type="checkbox"
                    [checked]="form.mealType.includes(meal)"
                    (change)="toggleMealType(form, meal, $event)"
                  />
                  <span>{{ mealTypeLabel(meal) }}</span>
                </label>
              </fieldset>
            </div>
            <div class="editor-field">
              <label for="editor-total-time">{{ 'recipes.editor.total_time' | t }}</label>
              <input
                id="editor-total-time"
                class="form-input"
                type="number"
                min="1"
                step="1"
                name="totalTime"
                [(ngModel)]="form.totalTime"
              />
            </div>
            <div class="editor-field">
              <label for="editor-prep-time">{{ 'recipes.editor.prep_time' | t }}</label>
              <input
                id="editor-prep-time"
                class="form-input"
                type="number"
                min="1"
                step="1"
                name="prepTime"
                [(ngModel)]="form.prepTime"
              />
            </div>
            <div class="editor-field">
              <label for="editor-cook-time">{{ 'recipes.editor.cook_time' | t }}</label>
              <input
                id="editor-cook-time"
                class="form-input"
                type="number"
                min="0"
                step="1"
                name="cookTime"
                [(ngModel)]="form.cookTime"
              />
            </div>
            <div class="editor-field">
              <label for="editor-rest-time">{{ 'recipes.editor.rest_time' | t }}</label>
              <input
                id="editor-rest-time"
                class="form-input"
                type="number"
                min="0"
                step="1"
                name="restTime"
                [(ngModel)]="form.restTime"
              />
            </div>
            <div class="editor-field">
              <label for="editor-servings">{{ 'recipes.editor.servings' | t }}</label>
              <input
                id="editor-servings"
                class="form-input"
                type="number"
                min="1"
                step="1"
                name="servings"
                [(ngModel)]="form.servings"
                required
              />
            </div>
            <div *ngIf="!form.nutritionEnabled" class="editor-field">
              <label for="editor-calories">{{ 'recipes.editor.calories' | t }}</label>
              <input
                id="editor-calories"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="calories"
                [(ngModel)]="form.calories"
              />
            </div>
            <div class="editor-field editor-field--wide">
              <label for="editor-tags">{{ 'recipes.editor.tags' | t }}</label>
              <input id="editor-tags" class="form-input" name="tags" [(ngModel)]="form.tagsText" />
            </div>
          </div>
        </section>

        <section
          [hidden]="activeTab !== 'ingredients'"
          id="editor-panel-ingredients"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-ingredients"
          data-test="editor-panel-ingredients"
          class="editor-section"
        >
          <div class="editor-section__heading">
            <h2 id="editor-ingredients-title">{{ 'recipes.editor.section_ingredients' | t }}</h2>
            <app-button variant="outline" (onClick)="addIngredient(form)">
              <app-icon name="add" [size]="18" [label]="null" />
              {{ 'recipes.editor.add_ingredient' | t }}
            </app-button>
          </div>
          <article
            *ngFor="let ingredient of form.ingredients; let index = index; trackBy: trackIndex"
            class="editor-item"
          >
            <div class="editor-item__heading">
              <h3>{{ 'recipes.editor.ingredient_name' | t }} {{ index + 1 }}</h3>
              <div class="editor-item__actions">
                <button
                  type="button"
                  class="editor-icon-button"
                  [disabled]="index === 0"
                  [attr.aria-label]="'recipes.editor.move_up' | t"
                  (click)="moveIngredient(form, index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="editor-icon-button"
                  [disabled]="index === form.ingredients.length - 1"
                  [attr.aria-label]="'recipes.editor.move_down' | t"
                  (click)="moveIngredient(form, index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="editor-icon-button editor-icon-button--danger"
                  [attr.aria-label]="'recipes.editor.remove_ingredient' | t"
                  (click)="removeIngredient(form, index)"
                >
                  ×
                </button>
              </div>
            </div>
            <div class="editor-grid">
              <div class="editor-field">
                <label [for]="'ingredient-name-' + index">{{
                  'recipes.editor.ingredient_name' | t
                }}</label>
                <input
                  [id]="'ingredient-name-' + index"
                  class="form-input"
                  [name]="'ingredient-name-' + index"
                  [(ngModel)]="ingredient.name"
                  required
                />
              </div>
              <div class="editor-field">
                <label [for]="'ingredient-quantity-' + index">{{
                  'recipes.editor.quantity' | t
                }}</label>
                <input
                  [id]="'ingredient-quantity-' + index"
                  class="form-input"
                  type="number"
                  min="0"
                  step="any"
                  [name]="'ingredient-quantity-' + index"
                  [(ngModel)]="ingredient.quantityText"
                  required
                />
              </div>
              <div class="editor-field">
                <label [for]="'ingredient-unit-' + index">{{ 'recipes.editor.unit' | t }}</label>
                <app-picker
                  [id]="'ingredient-unit-' + index"
                  [options]="unitOptions"
                  [value]="ingredient.unit"
                  [label]="('recipes.editor.unit' | t) + ' ' + (index + 1)"
                  (valueChange)="setIngredientUnit(ingredient, $event)"
                />
              </div>
              <div class="editor-field">
                <label [for]="'ingredient-preparation-' + index">{{
                  'recipes.editor.preparation' | t
                }}</label>
                <input
                  [id]="'ingredient-preparation-' + index"
                  class="form-input"
                  [name]="'ingredient-preparation-' + index"
                  [(ngModel)]="ingredient.preparation"
                />
              </div>
              <div class="editor-field editor-field--wide">
                <label [for]="'ingredient-substitutes-' + index">{{
                  'recipes.editor.substitutes' | t
                }}</label>
                <input
                  [id]="'ingredient-substitutes-' + index"
                  class="form-input"
                  [name]="'ingredient-substitutes-' + index"
                  [(ngModel)]="ingredient.substitutesText"
                />
              </div>
              <div class="editor-field editor-field--wide">
                <label [for]="'ingredient-notes-' + index">{{ 'recipes.editor.notes' | t }}</label>
                <input
                  [id]="'ingredient-notes-' + index"
                  class="form-input"
                  [name]="'ingredient-notes-' + index"
                  [(ngModel)]="ingredient.notes"
                />
              </div>
              <label class="editor-check editor-field--wide">
                <input
                  type="checkbox"
                  [name]="'ingredient-optional-' + index"
                  [(ngModel)]="ingredient.isOptional"
                />
                <span>{{ 'recipes.editor.optional' | t }}</span>
              </label>
            </div>
          </article>
        </section>

        <section
          [hidden]="activeTab !== 'instructions'"
          id="editor-panel-instructions"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-instructions"
          data-test="editor-panel-instructions"
          class="editor-section"
        >
          <h2 id="editor-instructions-title">{{ 'recipes.editor.section_instructions' | t }}</h2>
          <p *ngIf="!form.instructionsByLevel" class="editor-hint">
            {{ 'recipes.editor.legacy_note' | t }}
          </p>

          <ng-container *ngIf="form.instructionsByLevel; else legacyInstructions">
            <nav
              class="recipe-editor__level-tabs"
              role="tablist"
              [attr.aria-label]="'recipes.editor.levels_label' | t"
            >
              <button
                *ngFor="let level of detailLevels; let index = index"
                type="button"
                role="tab"
                class="recipe-editor__level-tab"
                [id]="'editor-level-tab-' + level"
                [attr.aria-controls]="'editor-level-panel-' + level"
                [attr.aria-selected]="activeDetailLevel === level"
                [attr.tabindex]="activeDetailLevel === level ? 0 : -1"
                [class.is-active]="activeDetailLevel === level"
                (click)="setActiveDetailLevel(level)"
                (keydown)="onDetailTabKeydown($event, index)"
              >
                {{ detailLevelLabel(level) }}
              </button>
            </nav>
            <section
              *ngFor="let level of detailLevels"
              [hidden]="activeDetailLevel !== level"
              [id]="'editor-level-panel-' + level"
              role="tabpanel"
              tabindex="0"
              class="editor-level"
              [attr.aria-labelledby]="'editor-level-tab-' + level"
            >
              <div class="editor-section__heading">
                <h3 [id]="'editor-level-' + level">{{ detailLevelLabel(level) }}</h3>
                <app-button variant="outline" (onClick)="addStep(form, level)">
                  <app-icon name="add" [size]="18" [label]="null" />
                  {{ 'recipes.editor.add_step' | t }}
                </app-button>
              </div>
              <ng-container
                *ngTemplateOutlet="
                  stepList;
                  context: { $implicit: stepsFor(form, level), group: level, draft: form }
                "
              ></ng-container>
            </section>
          </ng-container>
          <ng-template #legacyInstructions>
            <div class="editor-section__heading">
              <h3>{{ 'recipes.editor.basic' | t }}</h3>
              <app-button variant="outline" (onClick)="addStep(form)">
                <app-icon name="add" [size]="18" [label]="null" />
                {{ 'recipes.editor.add_step' | t }}
              </app-button>
            </div>
            <ng-container
              *ngTemplateOutlet="
                stepList;
                context: { $implicit: stepsFor(form), group: 'legacy', draft: form }
              "
            ></ng-container>
          </ng-template>

          <ng-template #stepList let-steps let-group="group" let-draft="draft">
            <article
              *ngFor="let step of steps; let index = index; trackBy: trackIndex"
              class="editor-item editor-step"
            >
              <div class="editor-item__heading">
                <h4>{{ 'recipes.paso_n' | t: { n: index + 1 } }}</h4>
                <div class="editor-item__actions">
                  <button
                    type="button"
                    class="editor-icon-button"
                    [disabled]="index === 0"
                    [attr.aria-label]="'recipes.editor.move_up' | t"
                    (click)="moveStep(draft, group === 'legacy' ? undefined : group, index, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="editor-icon-button"
                    [disabled]="index === steps.length - 1"
                    [attr.aria-label]="'recipes.editor.move_down' | t"
                    (click)="moveStep(draft, group === 'legacy' ? undefined : group, index, 1)"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="editor-icon-button editor-icon-button--danger"
                    [attr.aria-label]="'recipes.editor.remove_step' | t"
                    (click)="removeStep(draft, group === 'legacy' ? undefined : group, index)"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="editor-grid">
                <div class="editor-field editor-field--wide">
                  <label [for]="'step-instruction-' + group + '-' + index">{{
                    'recipes.editor.step_instruction' | t
                  }}</label>
                  <textarea
                    [id]="'step-instruction-' + group + '-' + index"
                    class="form-input editor-textarea"
                    [name]="'step-instruction-' + group + '-' + index"
                    [(ngModel)]="step.instruction"
                    rows="3"
                    required
                  ></textarea>
                </div>
                <div class="editor-field">
                  <label [for]="'step-duration-' + group + '-' + index">{{
                    'recipes.editor.step_duration' | t
                  }}</label>
                  <input
                    [id]="'step-duration-' + group + '-' + index"
                    class="form-input"
                    type="number"
                    min="1"
                    step="1"
                    [name]="'step-duration-' + group + '-' + index"
                    [(ngModel)]="step.durationText"
                  />
                </div>
                <div class="editor-field">
                  <label [for]="'step-temperature-' + group + '-' + index">{{
                    'recipes.editor.step_temperature' | t
                  }}</label>
                  <div class="editor-inline-inputs">
                    <input
                      [id]="'step-temperature-' + group + '-' + index"
                      class="form-input"
                      type="number"
                      step="any"
                      [name]="'step-temperature-' + group + '-' + index"
                      [(ngModel)]="step.temperatureText"
                    />
                    <app-picker
                      class="editor-unit"
                      [options]="temperatureUnitOptions"
                      [value]="step.temperatureUnit"
                      [label]="
                        ('recipes.editor.step_temperature' | t) + ' ' + group + ' ' + (index + 1)
                      "
                      (valueChange)="setTemperatureUnit(step, $event)"
                    />
                  </div>
                </div>
                <label class="editor-check editor-field--wide">
                  <input
                    type="checkbox"
                    [name]="'step-timer-' + group + '-' + index"
                    [(ngModel)]="step.timerRequired"
                  />
                  <span>{{ 'recipes.editor.timer_required' | t }}</span>
                </label>
                <div *ngIf="step.timerRequired" class="editor-field">
                  <label [for]="'step-timer-duration-' + group + '-' + index">{{
                    'recipes.editor.timer_duration' | t
                  }}</label>
                  <input
                    [id]="'step-timer-duration-' + group + '-' + index"
                    class="form-input"
                    type="number"
                    min="1"
                    step="1"
                    [name]="'step-timer-duration-' + group + '-' + index"
                    [(ngModel)]="step.timerDurationText"
                  />
                </div>
                <div class="editor-field editor-field--wide">
                  <label [for]="'step-tips-' + group + '-' + index">{{
                    'recipes.editor.step_tips' | t
                  }}</label>
                  <textarea
                    [id]="'step-tips-' + group + '-' + index"
                    class="form-input editor-textarea"
                    [name]="'step-tips-' + group + '-' + index"
                    [(ngModel)]="step.tips"
                    rows="2"
                  ></textarea>
                </div>
                <div class="editor-field editor-field--wide">
                  <label [for]="'step-warning-' + group + '-' + index">{{
                    'recipes.editor.step_warning' | t
                  }}</label>
                  <textarea
                    [id]="'step-warning-' + group + '-' + index"
                    class="form-input editor-textarea"
                    [name]="'step-warning-' + group + '-' + index"
                    [(ngModel)]="step.warning"
                    rows="2"
                  ></textarea>
                </div>
                <div class="editor-field editor-field--wide">
                  <label [for]="'step-image-' + group + '-' + index">{{
                    'recipes.editor.step_image' | t
                  }}</label>
                  <input
                    [id]="'step-image-' + group + '-' + index"
                    class="form-input"
                    type="text"
                    inputmode="url"
                    [name]="'step-image-' + group + '-' + index"
                    [(ngModel)]="step.imageUrl"
                    (ngModelChange)="onStepImageChange(step, $event)"
                  />
                  <p class="editor-hint">{{ 'recipes.editor.step_image_hint' | t }}</p>
                  <figure *ngIf="step.imageUrl" class="editor-cover-preview editor-step-preview">
                    <img
                      [src]="step.imageUrl"
                      [alt]="step.imageAttribution?.altText || step.instruction"
                      loading="lazy"
                    />
                    <figcaption *ngIf="step.imageAttribution as credit">
                      <span>{{ 'recipes.step_photo_credit' | t: { author: credit.author } }}</span>
                      <a [href]="credit.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                        credit.licenseName
                      }}</a>
                      <a [href]="credit.sourceUrl" target="_blank" rel="noopener noreferrer">{{
                        'recipes.step_photo_source' | t
                      }}</a>
                    </figcaption>
                  </figure>
                  <button
                    *ngIf="step.imageUrl"
                    type="button"
                    class="editor-text-button"
                    (click)="clearStepPhoto(step)"
                  >
                    {{ 'recipes.editor.remove_step_photo' | t }}
                  </button>
                </div>
                <div class="editor-field editor-field--wide editor-step-media-search">
                  <div class="editor-step-media-search__toolbar">
                    <span>{{ 'recipes.editor.step_video_heading' | t }}</span>
                    <app-button
                      variant="outline"
                      [disabled]="isSearchingStepMedia"
                      [attr.data-test]="'recipe-step-media-search-' + group + '-' + index"
                      (onClick)="searchStepMedia(step)"
                    >
                      <app-icon name="search" [size]="16" [label]="null" />
                      {{
                        (stepMediaState(step) === 'loading'
                          ? 'recipes.editor.step_media_searching'
                          : 'recipes.editor.step_media_search'
                        ) | t
                      }}
                    </app-button>
                  </div>
                  <p
                    *ngIf="stepMediaState(step) === 'loading'"
                    class="editor-hint"
                    role="status"
                    aria-live="polite"
                  >
                    {{ 'recipes.editor.step_media_searching' | t }}
                  </p>
                  <div
                    *ngIf="stepMediaState(step) === 'error'"
                    class="editor-photo-search__error"
                    role="alert"
                  >
                    <span>{{ 'recipes.editor.step_media_search_failed' | t }}</span>
                    <button
                      type="button"
                      class="editor-text-button"
                      (click)="searchStepMedia(step, true)"
                    >
                      {{ 'recipes.editor.step_media_search_retry' | t }}
                    </button>
                  </div>
                  <p
                    *ngIf="stepMediaState(step) === 'empty'"
                    class="editor-hint"
                    role="status"
                    aria-live="polite"
                  >
                    {{ 'recipes.editor.step_media_search_empty' | t }}
                  </p>
                  <p
                    *ngIf="stepMediaResult(step)?.failed && stepMediaState(step) === 'results'"
                    class="editor-hint"
                    role="status"
                  >
                    {{ 'recipes.editor.step_media_search_failed' | t }}
                  </p>
                  <figure
                    *ngIf="stepMediaResult(step)?.photo as photo"
                    class="editor-step-media-search__photo"
                  >
                    <img [src]="photo.previewUrl" [alt]="photo.altText" loading="lazy" />
                    <figcaption>
                      <span>{{ photo.author }} · {{ photo.licenseName }}</span>
                      <a [href]="photo.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                        photo.licenseName
                      }}</a>
                      <button
                        type="button"
                        class="editor-text-button"
                        (click)="selectStepPhoto(step, photo)"
                      >
                        {{
                          (step.imagePhotoId === photo.id
                            ? 'recipes.editor.image_search_selected'
                            : 'recipes.editor.image_search_select'
                          ) | t
                        }}
                      </button>
                    </figcaption>
                  </figure>
                  <div *ngIf="stepMediaResult(step)?.videos?.length" class="editor-video-results">
                    <article
                      *ngFor="let video of stepMediaResult(step)?.videos; trackBy: trackVideo"
                      class="editor-video-result"
                      [attr.data-test]="'recipe-step-video-result-' + group + '-' + index"
                      [class.editor-video-result--selected]="step.videoId === video.id"
                    >
                      <img [src]="video.thumbnailUrl" alt="" loading="lazy" />
                      <div class="editor-video-result__copy">
                        <strong>{{ video.title }}</strong>
                        <span>{{ video.author }} · {{ video.licenseName }}</span>
                        <span>{{
                          'recipes.editor.step_video_duration'
                            | t: { seconds: video.durationSeconds }
                        }}</span>
                        <a [href]="video.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                          video.licenseName
                        }}</a>
                        <a [href]="video.sourceUrl" target="_blank" rel="noopener noreferrer">{{
                          'recipes.step_photo_source' | t
                        }}</a>
                      </div>
                      <app-button
                        variant="outline"
                        [disabled]="step.videoId === video.id"
                        (onClick)="selectStepVideo(step, video)"
                      >
                        {{
                          (step.videoId === video.id
                            ? 'recipes.editor.step_video_selected'
                            : 'recipes.editor.step_video_select'
                          ) | t
                        }}
                      </app-button>
                    </article>
                  </div>
                  <div *ngIf="step.video as selectedVideo" class="editor-selected-video">
                    <img [src]="selectedVideo.thumbnailUrl" alt="" loading="lazy" />
                    <span
                      >{{ selectedVideo.title }} · {{ selectedVideo.author }} ·
                      {{ selectedVideo.licenseName }}</span
                    >
                    <button type="button" class="editor-text-button" (click)="clearStepVideo(step)">
                      {{ 'recipes.editor.step_video_remove' | t }}
                    </button>
                  </div>
                </div>
                <div
                  class="editor-field editor-field--wide editor-photo-search"
                  [attr.data-test]="'recipe-step-photo-search-' + group + '-' + index"
                >
                  <label [for]="'step-photo-search-' + group + '-' + index">{{
                    'recipes.editor.step_image_search_label' | t
                  }}</label>
                  <input
                    [id]="'step-photo-search-' + group + '-' + index"
                    class="form-input"
                    type="search"
                    [name]="'step-photo-search-' + group + '-' + index"
                    [(ngModel)]="step.photoSearchQuery"
                    (ngModelChange)="searchStepPhotos(step, $event)"
                    [placeholder]="'recipes.editor.step_image_search_placeholder' | t"
                    maxlength="80"
                    autocomplete="off"
                    [attr.aria-describedby]="'step-photo-search-hint-' + group + '-' + index"
                  />
                  <p [id]="'step-photo-search-hint-' + group + '-' + index" class="editor-hint">
                    {{ 'recipes.editor.step_image_search_hint' | t }}
                  </p>
                  <p
                    *ngIf="stepPhotoState(step) === 'loading'"
                    class="editor-hint"
                    role="status"
                    aria-live="polite"
                  >
                    {{ 'recipes.editor.image_search_loading' | t }}
                  </p>
                  <p
                    *ngIf="stepPhotoState(step) === 'empty'"
                    class="editor-hint"
                    role="status"
                    aria-live="polite"
                  >
                    {{ 'recipes.editor.image_search_empty' | t }}
                  </p>
                  <div
                    *ngIf="stepPhotoState(step) === 'error'"
                    class="editor-photo-search__error"
                    role="alert"
                  >
                    <span>{{ 'recipes.editor.image_search_failed' | t }}</span>
                    <button
                      type="button"
                      class="editor-text-button"
                      (click)="searchStepPhotos(step, step.photoSearchQuery, true)"
                    >
                      {{ 'recipes.editor.image_search_retry' | t }}
                    </button>
                  </div>
                  <div
                    *ngIf="stepPhotoResults(step).length > 0"
                    class="editor-photo-results"
                    [attr.data-test]="'recipe-step-photo-results-' + group + '-' + index"
                  >
                    <button
                      *ngFor="let photo of stepPhotoResults(step); trackBy: trackPhoto"
                      type="button"
                      class="editor-photo-result"
                      [class.editor-photo-result--selected]="step.imagePhotoId === photo.id"
                      [attr.aria-pressed]="step.imagePhotoId === photo.id"
                      (click)="selectStepPhoto(step, photo)"
                    >
                      <img [src]="photo.previewUrl" [alt]="photo.altText" loading="lazy" />
                      <span class="editor-photo-result__author">{{ photo.author }}</span>
                      <span>{{ photo.licenseName }}</span>
                      <span class="editor-photo-result__action">{{
                        (step.imagePhotoId === photo.id
                          ? 'recipes.editor.image_search_selected'
                          : 'recipes.editor.image_search_select'
                        ) | t
                      }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </ng-template>
        </section>

        <section
          [hidden]="activeTab !== 'guidance'"
          id="editor-panel-guidance"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-guidance"
          class="editor-section"
        >
          <h2 id="editor-equipment-title">{{ 'recipes.editor.section_equipment' | t }}</h2>
          <div class="editor-grid">
            <div class="editor-field">
              <label for="editor-utensils">{{ 'recipes.utensils' | t }}</label>
              <textarea
                id="editor-utensils"
                class="form-input editor-textarea"
                name="utensils"
                [(ngModel)]="form.utensilsText"
                rows="4"
              ></textarea>
            </div>
            <div class="editor-field">
              <label for="editor-appliances">{{ 'recipes.editor.appliances' | t }}</label>
              <textarea
                id="editor-appliances"
                class="form-input editor-textarea"
                name="appliances"
                [(ngModel)]="form.appliancesText"
                rows="4"
              ></textarea>
            </div>
          </div>
          <div class="editor-subsection">
            <h2 id="editor-guidance-title">{{ 'recipes.editor.section_guidance' | t }}</h2>
            <div class="editor-grid">
              <div class="editor-field">
                <label for="editor-parallel">{{ 'recipes.editor.parallel_tasks' | t }}</label>
                <textarea
                  id="editor-parallel"
                  class="form-input editor-textarea"
                  name="parallelTasks"
                  [(ngModel)]="form.parallelTasksText"
                  rows="4"
                ></textarea>
              </div>
              <div class="editor-field">
                <label for="editor-guidance-tips">{{ 'recipes.editor.tips_variations' | t }}</label>
                <textarea
                  id="editor-guidance-tips"
                  class="form-input editor-textarea"
                  name="guidanceTips"
                  [(ngModel)]="form.tipsAndVariationsText"
                  rows="4"
                ></textarea>
              </div>
            </div>
          </div>
        </section>

        <section
          [hidden]="activeTab !== 'nutrition'"
          id="editor-panel-nutrition"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-nutrition"
          class="editor-section"
        >
          <h2 id="editor-nutrition-title">{{ 'recipes.editor.section_nutrition' | t }}</h2>
          <label class="editor-check editor-check--section">
            <input type="checkbox" name="nutritionEnabled" [(ngModel)]="form.nutritionEnabled" />
            <span>{{ 'recipes.editor.enable_nutrition' | t }}</span>
          </label>
          <div *ngIf="form.nutritionEnabled" class="editor-grid editor-grid--details">
            <div class="editor-field">
              <label for="nutrition-calories">{{ 'recipes.editor.calories' | t }}</label
              ><input
                id="nutrition-calories"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionCalories"
                [(ngModel)]="form.nutrition.calories"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-protein">{{ 'recipes.editor.protein' | t }}</label
              ><input
                id="nutrition-protein"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionProtein"
                [(ngModel)]="form.nutrition.protein"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-carbs">{{ 'recipes.editor.carbs' | t }}</label
              ><input
                id="nutrition-carbs"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionCarbs"
                [(ngModel)]="form.nutrition.carbs"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-fat">{{ 'recipes.editor.fat' | t }}</label
              ><input
                id="nutrition-fat"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionFat"
                [(ngModel)]="form.nutrition.fat"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-fiber">{{ 'recipes.editor.fiber' | t }}</label
              ><input
                id="nutrition-fiber"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionFiber"
                [(ngModel)]="form.nutrition.fiber"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-sugar">{{ 'recipes.editor.sugar' | t }}</label
              ><input
                id="nutrition-sugar"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionSugar"
                [(ngModel)]="form.nutrition.sugar"
              />
            </div>
            <div class="editor-field">
              <label for="nutrition-sodium">{{ 'recipes.editor.sodium' | t }}</label
              ><input
                id="nutrition-sodium"
                class="form-input"
                type="number"
                min="0"
                step="any"
                name="nutritionSodium"
                [(ngModel)]="form.nutrition.sodium"
              />
            </div>
          </div>
          <div class="editor-subsection">
            <h2 id="editor-storage-title">{{ 'recipes.editor.section_storage' | t }}</h2>
            <label class="editor-check editor-check--section">
              <input type="checkbox" name="storageEnabled" [(ngModel)]="form.storageEnabled" />
              <span>{{ 'recipes.editor.enable_storage' | t }}</span>
            </label>
            <div *ngIf="form.storageEnabled" class="editor-grid editor-grid--details">
              <div class="editor-field">
                <label for="storage-method">{{ 'recipes.editor.storage_method' | t }}</label
                ><input
                  id="storage-method"
                  class="form-input"
                  name="storageMethod"
                  [(ngModel)]="form.storage.method"
                  required
                />
              </div>
              <div class="editor-field">
                <label for="storage-container">{{ 'recipes.editor.storage_container' | t }}</label
                ><input
                  id="storage-container"
                  class="form-input"
                  name="storageContainer"
                  [(ngModel)]="form.storage.container"
                />
              </div>
              <div class="editor-field">
                <label for="storage-duration">{{ 'recipes.editor.storage_duration' | t }}</label
                ><input
                  id="storage-duration"
                  class="form-input"
                  name="storageDuration"
                  [(ngModel)]="form.storage.duration"
                  required
                />
              </div>
              <div class="editor-field">
                <label for="storage-reheating">{{ 'recipes.editor.storage_reheating' | t }}</label
                ><textarea
                  id="storage-reheating"
                  class="form-input editor-textarea"
                  name="storageReheating"
                  [(ngModel)]="form.storage.reheatingInstructions"
                  rows="2"
                ></textarea>
              </div>
              <label class="editor-check editor-field--wide"
                ><input
                  type="checkbox"
                  name="storageFreezing"
                  [(ngModel)]="form.storage.freezingPossible"
                /><span>{{ 'recipes.editor.storage_freezing' | t }}</span></label
              >
              <div *ngIf="form.storage.freezingPossible" class="editor-field">
                <label for="storage-freezing-duration">{{
                  'recipes.editor.storage_freezing_duration' | t
                }}</label
                ><input
                  id="storage-freezing-duration"
                  class="form-input"
                  name="storageFreezingDuration"
                  [(ngModel)]="form.storage.freezingDuration"
                />
              </div>
            </div>
          </div>
        </section>

        <section
          [hidden]="activeTab !== 'media'"
          id="editor-panel-media"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="recipe-editor-tab-media"
          data-test="editor-panel-media"
          class="editor-section"
        >
          <h2 id="editor-media-title">{{ 'recipes.editor.section_media' | t }}</h2>
          <div class="editor-grid">
            <div class="editor-field editor-field--wide">
              <label for="editor-image">{{ 'recipes.editor.cover_image' | t }}</label>
              <input
                id="editor-image"
                class="form-input"
                type="text"
                name="image"
                [ngModel]="form.image"
                (ngModelChange)="onCoverImageChange(form, $event)"
                inputmode="url"
              />
              <p class="editor-hint">{{ 'recipes.editor.cover_image_hint' | t }}</p>
              <figure *ngIf="form.image" class="editor-cover-preview">
                <img
                  [src]="form.image"
                  [alt]="form.imageAttribution?.altText || form.name"
                  loading="lazy"
                />
                <figcaption *ngIf="form.imageAttribution as credit">
                  <span>{{ 'recipes.step_photo_credit' | t: { author: credit.author } }}</span>
                  <a [href]="credit.licenseUrl" target="_blank" rel="noopener noreferrer">{{
                    credit.licenseName
                  }}</a>
                  <a [href]="credit.sourceUrl" target="_blank" rel="noopener noreferrer">{{
                    'recipes.step_photo_source' | t
                  }}</a>
                </figcaption>
              </figure>
            </div>
            <div
              class="editor-field editor-field--wide editor-photo-search"
              data-test="recipe-photo-search"
            >
              <label for="editor-photo-search">{{ 'recipes.editor.image_search_label' | t }}</label>
              <input
                id="editor-photo-search"
                class="form-input"
                type="search"
                name="photoSearch"
                [(ngModel)]="imageSearchQuery"
                (ngModelChange)="searchCoverPhotos($event)"
                [placeholder]="'recipes.editor.image_search_placeholder' | t"
                maxlength="80"
                autocomplete="off"
                aria-describedby="editor-photo-search-hint"
              />
              <p id="editor-photo-search-hint" class="editor-hint">
                {{ 'recipes.editor.image_search_hint' | t }}
              </p>
              <p
                *ngIf="imageSearchState === 'loading'"
                class="editor-hint"
                role="status"
                aria-live="polite"
              >
                {{ 'recipes.editor.image_search_loading' | t }}
              </p>
              <p
                *ngIf="imageSearchState === 'empty'"
                class="editor-hint"
                role="status"
                aria-live="polite"
              >
                {{ 'recipes.editor.image_search_empty' | t }}
              </p>
              <div
                *ngIf="imageSearchState === 'error'"
                class="editor-photo-search__error"
                role="alert"
              >
                <span>{{ 'recipes.editor.image_search_failed' | t }}</span>
                <button type="button" class="editor-text-button" (click)="retryCoverPhotoSearch()">
                  {{ 'recipes.editor.image_search_retry' | t }}
                </button>
              </div>
              <div
                *ngIf="imageSearchResults.length > 0"
                class="editor-photo-results"
                data-test="recipe-photo-results"
              >
                <button
                  *ngFor="let photo of imageSearchResults; trackBy: trackPhoto"
                  type="button"
                  class="editor-photo-result"
                  [class.editor-photo-result--selected]="form.imagePhotoId === photo.id"
                  [attr.aria-pressed]="form.imagePhotoId === photo.id"
                  (click)="selectCoverPhoto(form, photo)"
                >
                  <img [src]="photo.previewUrl" [alt]="photo.altText" loading="lazy" />
                  <span class="editor-photo-result__author">{{ photo.author }}</span
                  ><span>{{ photo.licenseName }}</span>
                  <span class="editor-photo-result__action">{{
                    (form.imagePhotoId === photo.id
                      ? 'recipes.editor.image_search_selected'
                      : 'recipes.editor.image_search_select'
                    ) | t
                  }}</span>
                </button>
              </div>
              <div class="editor-image-generation">
                <button
                  type="button"
                  class="editor-text-button"
                  disabled
                  aria-describedby="editor-image-generation-help"
                >
                  {{ 'recipes.editor.generate_image' | t }}
                </button>
                <p id="editor-image-generation-help" class="editor-hint">
                  {{ 'recipes.editor.generate_image_unavailable' | t }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <footer class="recipe-editor__actions">
          <app-button
            variant="outline"
            [fullWidth]="true"
            [disabled]="saving"
            (onClick)="cancelEditing()"
          >
            {{ 'recipes.editor.cancel' | t }}
          </app-button>
          <app-button
            data-test="recipe-editor-save"
            variant="primary"
            [fullWidth]="true"
            [type]="'submit'"
            [loading]="saving"
            [disabled]="saving"
          >
            {{
              (saving
                ? 'recipes.editor.saving'
                : isCreateMode
                  ? 'recipes.editor.create_save'
                  : 'recipes.editor.save'
              ) | t
            }}
          </app-button>
        </footer>
      </form>
    </div>

    <app-recipe-improve-dialog
      [isOpen]="improveDialogOpen"
      [draft]="draft"
      [loading]="improvingRecipe"
      [errorKey]="improvementError"
      [response]="improvementResponse"
      (request)="requestRecipeImprovement($event)"
      (apply)="applyRecipeImprovement($event)"
      (cancel)="cancelRecipeImprovement()"
      (revise)="reviseRecipeImprovement()"
    />

    <app-modal
      [isOpen]="confirmDiscard"
      [title]="'recipes.editor.confirm_title' | t"
      size="sm"
      [showFooter]="true"
      (onClose)="keepEditing()"
    >
      <p>{{ 'recipes.editor.confirm_message' | t }}</p>
      <div footer class="editor-confirm-actions">
        <app-button variant="outline" (onClick)="keepEditing()">{{
          'recipes.editor.stay' | t
        }}</app-button>
        <app-button
          variant="danger"
          data-test="recipe-editor-confirm-discard"
          (onClick)="confirmDiscardChanges()"
          >{{ 'recipes.editor.discard' | t }}</app-button
        >
      </div>
    </app-modal>
  `,
  styles: [
    `
      .recipe-editor {
        width: 100%;
        min-width: 0;
        padding-block: var(--container-padding);
        color: var(--text-primary);
      }
      .recipe-editor__form {
        display: grid;
        gap: var(--space-4);
        padding-bottom: calc(96px + env(safe-area-inset-bottom));
      }
      .recipe-editor__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-4);
      }
      .recipe-editor__improve-trigger {
        flex: 0 0 auto;
      }
      .recipe-editor__heading {
        min-width: 0;
        display: grid;
        justify-items: start;
        gap: var(--space-2);
      }
      .recipe-editor__heading h1 {
        margin: 0;
        font-size: var(--text-2xl);
        line-height: var(--leading-tight);
        font-weight: var(--font-semibold);
        overflow-wrap: anywhere;
      }
      .recipe-editor__heading h1:focus {
        outline: none;
      }
      .recipe-editor__heading p {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .recipe-editor__heading .recipe-editor__recipe-name {
        color: var(--text-primary);
        font-weight: var(--font-medium);
      }
      .recipe-editor__tabs,
      .recipe-editor__level-tabs {
        display: flex;
        gap: var(--space-1);
        min-width: 0;
        overflow-x: auto;
        border-bottom: 1px solid var(--border-default);
        scrollbar-width: thin;
      }
      .recipe-editor__tab,
      .recipe-editor__level-tab {
        position: relative;
        min-height: 44px;
        flex: 0 0 auto;
        padding: var(--space-2) var(--space-3);
        border: 0;
        border-radius: var(--radius-md) var(--radius-md) 0 0;
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--text-sm);
        cursor: pointer;
        white-space: nowrap;
      }
      .recipe-editor__tab:hover,
      .recipe-editor__level-tab:hover {
        background: var(--bg-secondary);
        color: var(--text-primary);
      }
      .recipe-editor__tab.is-active,
      .recipe-editor__level-tab.is-active {
        color: var(--primary);
        font-weight: var(--font-semibold);
      }
      .recipe-editor__tab.is-active::after,
      .recipe-editor__level-tab.is-active::after {
        position: absolute;
        right: var(--space-2);
        bottom: -1px;
        left: var(--space-2);
        height: 2px;
        background: var(--primary);
        content: '';
      }
      .recipe-editor__tab:focus-visible,
      .recipe-editor__level-tab:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }
      .recipe-editor__level-tabs {
        margin-block: var(--space-4);
        border-bottom-color: transparent;
      }
      .recipe-editor__level-tab {
        border-radius: var(--radius-md);
      }
      .editor-level[hidden] {
        display: none;
      }
      .editor-section[hidden] {
        display: none;
      }
      .editor-tabpanel {
        min-width: 0;
      }
      .recipe-editor__state {
        min-height: 40vh;
        display: grid;
        justify-items: start;
        align-content: center;
        gap: var(--space-4);
      }
      .recipe-editor__message {
        margin: 0;
        padding: var(--space-3) var(--space-4);
        border-inline-start: 3px solid var(--error);
        background: var(--bg-secondary);
        color: var(--text-primary);
      }
      .editor-section {
        min-width: 0;
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }
      .editor-subsection {
        margin-top: var(--space-5);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border-default);
      }
      .editor-section > h2,
      .editor-section__heading h2 {
        margin: 0;
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
      }
      .editor-section__heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-bottom: var(--space-3);
      }
      .editor-section__heading h3 {
        margin: 0;
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
      }
      .editor-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-3);
        margin-top: var(--space-4);
      }
      .editor-field {
        min-width: 0;
        display: grid;
        align-content: start;
        gap: var(--space-2);
      }
      .editor-field--wide {
        grid-column: 1 / -1;
      }
      .editor-field > label,
      .editor-choice-group legend {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }
      .editor-field > span {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }
      .editor-field .form-input,
      .editor-field .form-select {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 44px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }
      .editor-field .form-input:focus-visible,
      .editor-field .form-select:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 1px;
      }
      .editor-textarea {
        resize: vertical;
        min-height: 88px !important;
      }
      .editor-hint {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }
      .editor-cover-preview {
        margin: 0;
        display: grid;
        gap: var(--space-2);
      }
      .editor-cover-preview img {
        display: block;
        width: min(100%, 560px);
        max-height: 320px;
        border-radius: var(--radius-md);
        object-fit: cover;
        background: var(--bg-tertiary);
      }
      .editor-cover-preview figcaption {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-3);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }
      .editor-cover-preview a {
        color: var(--primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }
      .editor-photo-results {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--space-3);
      }
      .editor-photo-result {
        min-width: 0;
        display: grid;
        align-content: start;
        gap: var(--space-1);
        padding: var(--space-2);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-secondary);
        text-align: start;
        font: inherit;
        font-size: var(--text-xs);
        cursor: pointer;
      }
      .editor-photo-result:hover,
      .editor-photo-result--selected {
        border-color: var(--primary);
      }
      .editor-photo-result:focus-visible,
      .editor-text-button:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .editor-photo-result img {
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        border-radius: var(--radius-sm);
        object-fit: cover;
        background: var(--bg-tertiary);
      }
      .editor-photo-result__author {
        overflow-wrap: anywhere;
        color: var(--text-primary);
        font-weight: var(--font-medium);
      }
      .editor-photo-result__action {
        margin-top: var(--space-1);
        color: var(--primary);
        font-weight: var(--font-medium);
      }
      .editor-step-media-search {
        min-width: 0;
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-default);
      }
      .editor-step-media-search__toolbar {
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .editor-step-media-search__toolbar > span {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }
      .editor-step-media-search__photo {
        width: min(100%, 260px);
        display: grid;
        gap: var(--space-2);
        margin: var(--space-2) 0 0;
      }
      .editor-step-media-search__photo img,
      .editor-video-result > img,
      .editor-selected-video > img {
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        border-radius: var(--radius-sm);
        object-fit: cover;
        background: var(--bg-tertiary);
      }
      .editor-step-media-search__photo figcaption {
        min-width: 0;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-xs);
        overflow-wrap: anywhere;
      }
      .editor-step-media-search__photo a,
      .editor-video-result a {
        color: var(--primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }
      .editor-video-results {
        min-width: 0;
        display: grid;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }
      .editor-video-result {
        min-width: 0;
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }
      .editor-video-result--selected {
        border-color: var(--primary);
      }
      .editor-video-result__copy {
        min-width: 0;
        display: grid;
        gap: var(--space-1);
        overflow-wrap: anywhere;
        font-size: var(--text-xs);
      }
      .editor-video-result__copy strong {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }
      .editor-video-result__copy span {
        color: var(--text-secondary);
      }
      .editor-selected-video {
        min-width: 0;
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-xs);
        overflow-wrap: anywhere;
      }
      .editor-selected-video > img {
        border-radius: var(--radius-sm);
      }
      .editor-photo-search__error,
      .editor-image-generation {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .editor-image-generation {
        padding-top: var(--space-2);
        border-top: 1px solid var(--border-default);
      }
      .editor-text-button {
        border: 0;
        padding: 0;
        background: none;
        color: var(--primary);
        font: inherit;
        font-size: var(--text-sm);
        text-decoration: underline;
        text-underline-offset: 0.15em;
        cursor: pointer;
      }
      .editor-text-button:disabled {
        color: var(--text-secondary);
        text-decoration: none;
        cursor: not-allowed;
      }
      .editor-image-generation .editor-hint {
        flex: 1 1 240px;
      }
      .editor-choice-group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .editor-choice-group legend {
        margin-bottom: var(--space-2);
      }
      .editor-check {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-primary);
        font-size: var(--text-sm);
        cursor: pointer;
      }
      .editor-check input {
        width: 18px;
        height: 18px;
        accent-color: var(--primary);
      }
      .editor-check--section {
        margin-top: var(--space-2);
      }
      .editor-item {
        min-width: 0;
        margin-top: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }
      .editor-item__heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-bottom: var(--space-3);
      }
      .editor-item__heading h3,
      .editor-item__heading h4 {
        margin: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .editor-item__actions {
        display: flex;
        gap: var(--space-1);
      }
      .editor-icon-button {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--text-lg);
        cursor: pointer;
      }
      .editor-icon-button:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 1px;
      }
      .editor-icon-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .editor-icon-button--danger {
        color: var(--error);
      }
      .editor-level + .editor-level {
        margin-top: var(--space-5);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border-default);
      }
      .editor-inline-inputs {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 72px;
        gap: var(--space-2);
      }
      .editor-unit {
        width: 88px;
        flex: 0 0 88px;
      }
      .recipe-editor__actions {
        position: sticky;
        z-index: 2;
        bottom: 0;
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        margin-inline: calc(-1 * var(--container-padding));
        padding: var(--space-3) var(--container-padding)
          calc(var(--space-3) + env(safe-area-inset-bottom));
        border-top: 1px solid var(--border-default);
        background: var(--bg-primary);
      }
      .editor-confirm-actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      @media (max-width: 800px) {
        .recipe-editor__tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          overflow: visible;
          border-bottom: 0;
        }
        .recipe-editor__tab {
          min-width: 0;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          white-space: normal;
          line-height: var(--leading-tight);
          text-align: center;
        }
        .recipe-editor__tab.is-active {
          border-color: var(--primary);
          background: var(--bg-secondary);
        }
        .recipe-editor__tab.is-active::after {
          right: 25%;
          left: 25%;
          height: 2px;
          bottom: 2px;
        }
      }
      @media (max-width: 640px) {
        .recipe-editor__header {
          flex-wrap: wrap;
        }
        .recipe-editor__improve-trigger {
          width: 100%;
        }
        .editor-section {
          padding: var(--space-3);
        }
        .editor-grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .editor-field--wide {
          grid-column: auto;
        }
        .editor-section__heading {
          align-items: flex-start;
          flex-direction: column;
        }
        .recipe-editor__actions {
          justify-content: stretch;
        }
        .recipe-editor__actions app-button {
          flex: 1 1 0;
        }
        .editor-video-result {
          grid-template-columns: 64px minmax(0, 1fr);
        }
        .editor-video-result app-button {
          grid-column: 1 / -1;
        }
        .editor-selected-video {
          grid-template-columns: 48px minmax(0, 1fr);
        }
        .editor-selected-video .editor-text-button {
          grid-column: 2;
          justify-self: start;
        }
      }
    `
  ]
})
export class RecipeEditComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly recipeService = inject(RecipeService);
  private readonly aiService = inject(AiService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(I18nService);
  private readonly imageSearchRequests = new Subject<{ query: string; force: boolean }>();
  private readonly stepPhotoSearchRequests = new Map<RecipeEditorStep, Subscription>();
  private readonly stepPhotoSearchStates = new Map<RecipeEditorStep, PhotoSearchState>();
  private readonly stepPhotoSearchResults = new Map<RecipeEditorStep, RecipeStepPhoto[]>();
  private readonly stepMediaSearchStates = new Map<RecipeEditorStep, StepMediaSearchState>();
  private readonly stepMediaSearchResults = new Map<RecipeEditorStep, StepMediaSearchResult>();
  private stepMediaSearchSubscription: Subscription | null = null;
  private recipeImprovementSubscription: Subscription | null = null;

  readonly detailLevels = DETAIL_LEVELS;
  readonly editorTabs = [
    { id: 'basics', label: 'recipes.editor.tab_basics' },
    { id: 'ingredients', label: 'recipes.editor.tab_ingredients' },
    { id: 'instructions', label: 'recipes.editor.tab_instructions' },
    { id: 'guidance', label: 'recipes.editor.tab_guidance' },
    { id: 'nutrition', label: 'recipes.editor.tab_nutrition' },
    { id: 'media', label: 'recipes.editor.tab_media' }
  ] as const;
  activeTab: RecipeEditorTab = 'basics';
  activeDetailLevel: RecipeDetailLevel = 'basic';
  readonly mealTypes = MEAL_TYPES;
  readonly difficultyOptions: PickerOption[] = DIFFICULTIES.map((value) => ({
    value,
    label: this.difficultyLabel(value)
  }));
  readonly unitOptions: PickerOption[] = UNITS.map((value) => ({ value, label: value }));
  readonly temperatureUnitOptions: PickerOption[] = [
    { value: 'C', label: '°C' },
    { value: 'F', label: '°F' }
  ];
  loading = true;
  saving = false;
  forbidden = false;
  notFound = false;
  confirmDiscard = false;
  formError: TranslationKey | null = null;
  draft: RecipeEditDraft | null = null;
  imageSearchQuery = '';
  imageSearchState: PhotoSearchState = 'idle';
  imageSearchResults: RecipeStepPhoto[] = [];
  improveDialogOpen = false;
  improvingRecipe = false;
  improvementError: TranslationKey | null = null;
  improvementResponse: AIRecipeImproveResponse | null = null;
  isSearchingStepMedia = false;
  private improvementDraftSnapshot: RecipeEditDraft | null = null;
  private recipeId = '';
  private originalDraft: RecipeEditDraft | null = null;

  get isCreateMode(): boolean {
    return !this.recipeId;
  }

  ngOnInit(): void {
    this.imageSearchRequests
      .pipe(
        map(({ query, force }) => ({
          query: query
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
          force
        })),
        distinctUntilChanged((previous, next) => previous.query === next.query && !next.force),
        switchMap(({ query }) => {
          if (query.length < 2 || query.length > 80) {
            return of({ state: 'idle' as PhotoSearchState, photos: [] as RecipeStepPhoto[] });
          }
          this.imageSearchState = 'loading';
          this.imageSearchResults = [];
          // switchMap unsubscribes the previous timer/request immediately on each keystroke.
          return timer(320).pipe(
            switchMap(() => this.recipeService.searchRecipePhotos(query)),
            map((photos) => ({
              state: photos.length
                ? ('results' as PhotoSearchState)
                : ('empty' as PhotoSearchState),
              photos
            })),
            catchError(() =>
              of({ state: 'error' as PhotoSearchState, photos: [] as RecipeStepPhoto[] })
            )
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ state, photos }) => {
        this.imageSearchState = state;
        this.imageSearchResults = photos;
      });

    this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.loading = true;
          this.forbidden = false;
          this.notFound = false;
          this.draft = null;
          this.formError = null;
          this.recipeId = params.get('id') ?? '';
          this.activeTab = 'basics';
          this.activeDetailLevel = 'basic';
          if (!this.recipeId) {
            this.draft = createRecipeEditDraft();
            this.originalDraft = createRecipeEditDraft();
            return of(null);
          }
          return this.recipeId ? this.recipeService.getRecipe(this.recipeId) : of(null);
        }),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((recipe) => {
        this.loading = false;
        if (!recipe) {
          if (this.isCreateMode && this.draft) {
            afterNextRender(
              () =>
                this.document.getElementById('recipe-editor-title')?.focus({ preventScroll: true }),
              { injector: this.injector }
            );
            return;
          }
          this.notFound = true;
          return;
        }
        if (!this.canEdit(recipe)) {
          this.forbidden = true;
          return;
        }
        this.draft = recipeToEditDraft(recipe);
        this.originalDraft = recipeToEditDraft(recipe);
        afterNextRender(
          () => this.document.getElementById('recipe-editor-title')?.focus({ preventScroll: true }),
          { injector: this.injector }
        );
      });
  }

  ngOnDestroy(): void {
    this.recipeImprovementSubscription?.unsubscribe();
    this.recipeImprovementSubscription = null;
    for (const request of this.stepPhotoSearchRequests.values()) request.unsubscribe();
    this.stepPhotoSearchRequests.clear();
    this.stepMediaSearchSubscription?.unsubscribe();
    this.stepMediaSearchSubscription = null;
  }

  private canEdit(recipe: Recipe): boolean {
    return (
      recipe.author !== 'catalog' &&
      Boolean(this.authService.userId()) &&
      recipe.authorId === this.authService.userId()
    );
  }

  cancelEditing(): void {
    if (this.saving) return;
    if (this.hasUnsavedChanges()) {
      this.confirmDiscard = true;
      return;
    }
    if (this.isCreateMode) this.goToList();
    else this.goToDetail();
  }

  hasUnsavedChanges(): boolean {
    return Boolean(
      this.draft &&
      this.originalDraft &&
      JSON.stringify(this.draft) !== JSON.stringify(this.originalDraft)
    );
  }

  keepEditing(): void {
    this.confirmDiscard = false;
  }

  confirmDiscardChanges(): void {
    this.confirmDiscard = false;
    if (this.isCreateMode) this.goToList();
    else this.goToDetail();
  }

  goToList(): void {
    void this.router.navigate(['/recipes']);
  }

  openRecipeImprovement(): void {
    if (!this.draft || this.saving) return;
    this.improvementError = null;
    this.improvementResponse = null;
    this.improvementDraftSnapshot = JSON.parse(JSON.stringify(this.draft)) as RecipeEditDraft;
    this.improveDialogOpen = true;
  }

  requestRecipeImprovement(request: { scopes: RecipeImproveScope[]; includeMedia: boolean }): void {
    if (!this.draft || this.improvingRecipe) return;
    const recipe = recipeImprovementInput(this.draft);
    if (!recipe) {
      this.improvementError = 'recipes.improve.complete_first';
      return;
    }
    const uniqueScopes = [...new Set(request.scopes)];
    if (uniqueScopes.length === 0) return;

    this.recipeImprovementSubscription?.unsubscribe();
    this.improvementDraftSnapshot = JSON.parse(JSON.stringify(this.draft)) as RecipeEditDraft;
    this.improvementError = null;
    this.improvementResponse = null;
    this.improvingRecipe = true;
    this.recipeImprovementSubscription = this.aiService
      .improveRecipe({ recipe, scopes: uniqueScopes })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.improvingRecipe = false;
          this.recipeImprovementSubscription = null;
        })
      )
      .subscribe((response) => {
        if (!response || !this.sameScopeSet(uniqueScopes, response.scopes)) {
          this.improvementError = 'recipes.improve.failed';
          return;
        }
        this.improvementResponse = response;
      });
  }

  applyRecipeImprovement(result: {
    patch: AIRecipeImproveResponse['patch'];
    scopes: RecipeImproveScope[];
    includeMedia: boolean;
  }): void {
    if (!this.draft || !this.improvementDraftSnapshot || !this.improvementResponse) return;
    if (
      JSON.stringify(this.draft) !== JSON.stringify(this.improvementDraftSnapshot) ||
      !this.sameScopeSet(this.improvementResponse.scopes, result.scopes)
    ) {
      this.improvementError = 'recipes.improve.stale';
      this.improvementResponse = null;
      return;
    }
    applyRecipeImprovementPatch(this.draft, this.improvementResponse.patch, result.scopes);
    this.cancelRecipeImprovement();
    if (result.includeMedia) {
      this.activeTab = 'instructions';
      this.searchMediaForActiveLevel();
    }
  }

  reviseRecipeImprovement(): void {
    this.improvementResponse = null;
    this.improvementError = null;
  }

  cancelRecipeImprovement(): void {
    this.recipeImprovementSubscription?.unsubscribe();
    this.recipeImprovementSubscription = null;
    this.improvingRecipe = false;
    this.improvementResponse = null;
    this.improvementError = null;
    this.improvementDraftSnapshot = null;
    this.improveDialogOpen = false;
  }

  private sameScopeSet(
    first: readonly RecipeImproveScope[],
    second: readonly RecipeImproveScope[]
  ): boolean {
    return first.length === second.length && first.every((scope) => second.includes(scope));
  }

  save(): void {
    if (!this.draft || this.saving) return;
    const result = buildRecipeEditPayload(this.draft);
    if (!result.payload) {
      this.formError = 'recipes.editor.invalid';
      const errors = result.errors;
      this.activeTab = this.tabForValidationErrors(errors);
      const levelError = errors.find((error) => error.startsWith('level_'));
      const level = levelError?.split('_')[1];
      if (level && DETAIL_LEVELS.includes(level as RecipeDetailLevel)) {
        this.activeDetailLevel = level as RecipeDetailLevel;
      }
      afterNextRender(
        () =>
          this.document.querySelector<HTMLElement>('[data-test="recipe-editor-error"]')?.focus(),
        { injector: this.injector }
      );
      return;
    }
    this.formError = null;
    this.saving = true;
    const request$ = this.isCreateMode
      ? this.recipeService.createRecipe(result.payload)
      : this.recipeService.updateRecipe(this.recipeId, result.payload);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        if (!saved) {
          this.saving = false;
          this.formError = this.isCreateMode
            ? 'recipes.editor.create_failed'
            : 'recipes.editor.save_failed';
          return;
        }
        this.saving = false;
        this.recipeId = saved.id;
        this.originalDraft = recipeToEditDraft(saved);
        this.draft = recipeToEditDraft(saved);
        this.goToDetail();
      },
      error: () => {
        this.saving = false;
        this.formError = this.isCreateMode
          ? 'recipes.editor.create_failed'
          : 'recipes.editor.save_failed';
      }
    });
  }

  private tabForValidationErrors(errors: string[]): RecipeEditorTab {
    const first = errors[0] ?? '';
    if (first.startsWith('ingredient')) return 'ingredients';
    if (first.startsWith('level_') || first.startsWith('steps_')) return 'instructions';
    if (first.startsWith('nutrition_') || first.startsWith('storage_')) return 'nutrition';
    if (first.startsWith('image') || first.includes('_image')) return 'media';
    return 'basics';
  }

  setActiveTab(tab: RecipeEditorTab): void {
    this.activeTab = tab;
  }

  setActiveDetailLevel(level: RecipeDetailLevel): void {
    this.activeDetailLevel = level;
  }

  onEditorTabKeydown(event: KeyboardEvent, index: number): void {
    const next = this.tabIndexForKey(event, index, this.editorTabs.length);
    if (next === null) return;
    event.preventDefault();
    const tab = this.editorTabs[next];
    this.setActiveTab(tab.id);
    this.document.getElementById(`recipe-editor-tab-${tab.id}`)?.focus();
  }

  onDetailTabKeydown(event: KeyboardEvent, index: number): void {
    const next = this.tabIndexForKey(event, index, this.detailLevels.length);
    if (next === null) return;
    event.preventDefault();
    const level = this.detailLevels[next];
    this.setActiveDetailLevel(level);
    this.document.getElementById(`editor-level-tab-${level}`)?.focus();
  }

  private tabIndexForKey(event: KeyboardEvent, index: number, length: number): number | null {
    if (event.key === 'Home') return 0;
    if (event.key === 'End') return length - 1;
    if (event.key === 'ArrowRight') return (index + 1) % length;
    if (event.key === 'ArrowLeft') return (index - 1 + length) % length;
    return null;
  }

  private goToDetail(): void {
    void this.router.navigate(['/recipes'], { queryParams: { recipe: this.recipeId } });
  }

  addIngredient(draft: RecipeEditDraft): void {
    draft.ingredients.push({
      name: '',
      quantityText: '1',
      unit: 'unit',
      preparation: '',
      isOptional: false,
      substitutesText: '',
      notes: ''
    });
  }

  searchCoverPhotos(query: string, force = false): void {
    this.imageSearchQuery = query;
    this.imageSearchRequests.next({ query, force });
  }

  retryCoverPhotoSearch(): void {
    this.searchCoverPhotos(this.imageSearchQuery, true);
  }

  selectCoverPhoto(draft: RecipeEditDraft, photo: RecipeStepPhoto): void {
    draft.imagePhotoId = photo.id;
    draft.image = photo.previewUrl ?? '';
    draft.imageAttribution = {
      altText: photo.altText,
      author: photo.author,
      licenseName: photo.licenseName,
      licenseUrl: photo.licenseUrl,
      sourceUrl: photo.sourceUrl
    };
  }

  onCoverImageChange(draft: RecipeEditDraft, value: string): void {
    if (draft.imagePhotoId && value !== draft.image) {
      draft.imagePhotoId = null;
      draft.imageAttribution = null;
    }
    draft.image = value;
  }

  searchStepPhotos(step: RecipeEditorStep, queryValue: string, force = false): void {
    this.stepPhotoSearchRequests.get(step)?.unsubscribe();
    const query = queryValue
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.stepPhotoSearchResults.set(step, []);
    if (query.length < 2 || query.length > 80) {
      this.stepPhotoSearchStates.set(step, 'idle');
      this.stepPhotoSearchRequests.delete(step);
      return;
    }

    this.stepPhotoSearchStates.set(step, 'loading');
    const request = timer(force ? 0 : 320)
      .pipe(
        switchMap(() => this.recipeService.searchRecipePhotos(query)),
        map((photos) => ({
          state: photos.length ? ('results' as PhotoSearchState) : ('empty' as PhotoSearchState),
          photos
        })),
        catchError(() =>
          of({ state: 'error' as PhotoSearchState, photos: [] as RecipeStepPhoto[] })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ state, photos }) => {
        this.stepPhotoSearchStates.set(step, state);
        this.stepPhotoSearchResults.set(step, photos);
      });
    this.stepPhotoSearchRequests.set(step, request);
  }

  searchStepMedia(step: RecipeEditorStep, retry = false): void {
    if (this.isSearchingStepMedia || !step.instruction.trim()) return;
    this.isSearchingStepMedia = true;
    this.stepMediaSearchStates.set(step, 'loading');
    this.stepMediaSearchResults.delete(step);
    this.stepMediaSearchSubscription = this.requestStepMedia(step, retry)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isSearchingStepMedia = false;
          this.stepMediaSearchSubscription = null;
        })
      )
      .subscribe((result) => this.storeStepMediaResult(step, result));
  }

  private searchMediaForActiveLevel(): void {
    if (!this.draft) return;
    const steps = this.stepsFor(
      this.draft,
      this.draft.instructionsByLevel ? this.activeDetailLevel : undefined
    ).filter((step) => step.instruction.trim());
    if (steps.length === 0) return;

    this.stepMediaSearchSubscription?.unsubscribe();
    this.isSearchingStepMedia = true;
    this.stepMediaSearchSubscription = from(steps)
      .pipe(
        concatMap((step) => {
          this.stepMediaSearchStates.set(step, 'loading');
          this.stepMediaSearchResults.delete(step);
          return this.requestStepMedia(step).pipe(
            tap((result) => this.storeStepMediaResult(step, result))
          );
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isSearchingStepMedia = false;
          this.stepMediaSearchSubscription = null;
        })
      )
      .subscribe();
  }

  private requestStepMedia(step: RecipeEditorStep, retry = false) {
    const scene: RecipeStepVideoScene = classifyRecipeMediaScene(step.instruction);
    const photo$ = retry
      ? this.recipeService.retryStepPhoto(scene)
      : this.recipeService.searchStepPhoto(scene);
    const videos$ = retry
      ? this.recipeService.retryStepVideos(scene)
      : this.recipeService.searchStepVideos(scene);
    return forkJoin({
      photo: photo$.pipe(
        map((value) => ({ value, failed: false })),
        catchError(() => of({ value: null, failed: true }))
      ),
      videos: videos$.pipe(
        map((value) => ({ value, failed: false })),
        catchError(() => of({ value: [] as RecipeStepVideoCandidate[], failed: true }))
      )
    }).pipe(
      map(({ photo, videos }): StepMediaSearchResult => ({
        photo: photo.value,
        videos: videos.value,
        failed: photo.failed || videos.failed
      }))
    );
  }

  private storeStepMediaResult(step: RecipeEditorStep, result: StepMediaSearchResult): void {
    this.stepMediaSearchResults.set(step, result);
    const hasResult = Boolean(result.photo || result.videos.length);
    this.stepMediaSearchStates.set(step, hasResult ? 'results' : result.failed ? 'error' : 'empty');
  }

  stepMediaState(step: RecipeEditorStep): StepMediaSearchState | 'idle' {
    return this.stepMediaSearchStates.get(step) ?? 'idle';
  }

  stepMediaResult(step: RecipeEditorStep): StepMediaSearchResult | null {
    return this.stepMediaSearchResults.get(step) ?? null;
  }

  selectStepVideo(step: RecipeEditorStep, video: RecipeStepVideoCandidate): void {
    step.videoId = video.id;
    step.video = video;
  }

  clearStepVideo(step: RecipeEditorStep): void {
    step.videoId = null;
    step.video = null;
  }

  stepPhotoState(step: RecipeEditorStep): PhotoSearchState {
    return this.stepPhotoSearchStates.get(step) ?? 'idle';
  }

  stepPhotoResults(step: RecipeEditorStep): RecipeStepPhoto[] {
    return this.stepPhotoSearchResults.get(step) ?? [];
  }

  selectStepPhoto(step: RecipeEditorStep, photo: RecipeStepPhoto): void {
    step.imagePhotoId = photo.id;
    step.imageUrl = photo.previewUrl ?? '';
    step.imageAttribution = {
      altText: photo.altText,
      author: photo.author,
      licenseName: photo.licenseName,
      licenseUrl: photo.licenseUrl,
      sourceUrl: photo.sourceUrl
    };
  }

  onStepImageChange(step: RecipeEditorStep, value: string): void {
    if (step.imagePhotoId && value !== `/api/recipe-photo-previews/${step.imagePhotoId}`) {
      step.imagePhotoId = null;
      step.imageAttribution = null;
    }
    step.imageUrl = value;
  }

  clearStepPhoto(step: RecipeEditorStep): void {
    step.imagePhotoId = null;
    step.imageAttribution = null;
    step.imageUrl = '';
  }

  removeIngredient(draft: RecipeEditDraft, index: number): void {
    draft.ingredients.splice(index, 1);
  }

  moveIngredient(draft: RecipeEditDraft, index: number, offset: number): void {
    this.moveItem(draft.ingredients, index, offset);
  }

  stepsFor(draft: RecipeEditDraft, level?: RecipeDetailLevel): RecipeEditorStep[] {
    return level ? (draft.instructionsByLevel?.[level] ?? []) : (draft.steps ?? []);
  }

  addStep(draft: RecipeEditDraft, level?: RecipeDetailLevel): void {
    const steps = this.stepsFor(draft, level);
    steps.push({
      stepNumber: steps.length + 1,
      instruction: '',
      durationText: '',
      temperatureText: '',
      temperatureUnit: 'C',
      timerRequired: false,
      timerDurationText: '',
      tips: '',
      warning: '',
      imageUrl: '',
      imagePhotoId: null,
      imageAttribution: null,
      videoId: null,
      video: null,
      photoSearchQuery: ''
    });
  }

  removeStep(draft: RecipeEditDraft, level: RecipeDetailLevel | undefined, index: number): void {
    const steps = this.stepsFor(draft, level);
    const [removed] = steps.slice(index, index + 1);
    if (removed) {
      this.stepPhotoSearchRequests.get(removed)?.unsubscribe();
      this.stepPhotoSearchRequests.delete(removed);
      this.stepPhotoSearchStates.delete(removed);
      this.stepPhotoSearchResults.delete(removed);
      this.stepMediaSearchStates.delete(removed);
      this.stepMediaSearchResults.delete(removed);
      if (this.stepMediaSearchSubscription && this.isSearchingStepMedia) {
        this.stepMediaSearchSubscription.unsubscribe();
        this.stepMediaSearchSubscription = null;
        this.isSearchingStepMedia = false;
      }
    }
    steps.splice(index, 1);
    this.renumber(steps);
  }

  moveStep(
    draft: RecipeEditDraft,
    level: RecipeDetailLevel | undefined,
    index: number,
    offset: number
  ): void {
    const steps = this.stepsFor(draft, level);
    this.moveItem(steps, index, offset);
    this.renumber(steps);
  }

  toggleMealType(draft: RecipeEditDraft, meal: MealType, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const selected = new Set(draft.mealType);
    checked ? selected.add(meal) : selected.delete(meal);
    draft.mealType = MEAL_TYPES.filter((item) => selected.has(item));
  }

  setDifficulty(draft: RecipeEditDraft, value: string | null): void {
    if (value && DIFFICULTIES.includes(value as Difficulty)) draft.difficulty = value as Difficulty;
  }

  setIngredientUnit(
    ingredient: RecipeEditDraft['ingredients'][number],
    value: string | null
  ): void {
    if (value && UNITS.includes(value as MeasurementUnit))
      ingredient.unit = value as MeasurementUnit;
  }

  setTemperatureUnit(step: RecipeEditorStep, value: string | null): void {
    if (value === 'C' || value === 'F') step.temperatureUnit = value;
  }

  mealTypeLabel(meal: MealType): string {
    const keys: Record<MealType, string> = {
      breakfast: 'meal.breakfast',
      brunch: 'recipes.book.meal_brunch',
      lunch: 'meal.lunch',
      snack: 'meal.snack',
      dinner: 'meal.dinner',
      dessert: 'recipes.book.meal_dessert'
    };
    return this.i18n.t(keys[meal] as TranslationKey);
  }

  difficultyLabel(difficulty: Difficulty): string {
    const keys: Record<Difficulty, string> = {
      easy: 'recipes.facil',
      medium: 'recipes.medio',
      hard: 'recipes.dificil'
    };
    return this.i18n.t(keys[difficulty] as TranslationKey);
  }

  detailLevelLabel(level: RecipeDetailLevel): string {
    const keys: Record<RecipeDetailLevel, string> = {
      basic: 'recipes.editor.basic',
      intermediate: 'recipes.editor.intermediate',
      expert: 'recipes.editor.expert'
    };
    return this.i18n.t(keys[level] as TranslationKey);
  }

  trackIndex(index: number): number {
    return index;
  }

  trackPhoto(_index: number, photo: RecipeStepPhoto): string {
    return photo.id;
  }

  trackVideo(_index: number, video: RecipeStepVideoCandidate): string {
    return video.id;
  }

  private moveItem<T>(items: T[], index: number, offset: number): void {
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= items.length) return;
    const [item] = items.splice(index, 1);
    items.splice(destination, 0, item);
  }

  private renumber(steps: RecipeEditorStep[]): void {
    steps.forEach((step, index) => (step.stepNumber = index + 1));
  }
}
