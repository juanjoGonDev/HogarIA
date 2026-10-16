import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  OnInit,
  signal,
  ViewChild
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { distinctUntilChanged, finalize, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RecipeService } from '../../core/services/recipe.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdService } from '../../core/services/household.service';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { AiService } from '../../core/services/ai.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { TagComponent } from '../../shared/components/ui/tag/tag.component';
import { FilterTagComponent } from '../../shared/components/ui/tag/filter-tag.component';
import { ModalComponent, type ModalSize } from '../../shared/components/ui/modal/modal.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { Recipe, Difficulty, MealType, RecipeFilter } from '../../shared/models/recipe.model';
import type {
  AIRecipeRequest,
  AIGuestPreferences,
  AIRecipeResponse,
  DetailLevel
} from '../../shared/models/ai-config.model';
import { recipeInstructionsForLevel } from '../../shared/models/recipe-instructions';
import type { RecipeInstructionStep } from '../../shared/models/recipe-instructions';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';
import { resolveRecipeRouteIntent } from './recipe-route-intent';
import { recipeCategoryEmoji } from './recipe-category-emoji';
import { RecipeStepPhotoComponent } from './recipe-step-photo.component';
import { RecipeDetailViewComponent } from './recipe-detail-view.component';
import {
  RecipeCatalogResultsComponent,
  type RecipeCatalogDisplay
} from './recipe-catalog-results.component';
import { AiParticipantsComponent } from '../../shared/components/ai-participants.component';
import {
  detailLevelForCookingLevel,
  recipeDetailLevelLabelKey,
  recipeDetailLevelFor,
  rememberRecipeDetailLevel,
  scaleRecipeQuantity,
  type RecipeDetailPreferences
} from './recipe-detail.util';
import {
  filterRecipeIngredientsByCategory,
  mergeAllRecipeIngredients
} from './recipe-ai-wizard.util';

const RECIPE_MEAL_TYPES: readonly MealType[] = [
  'breakfast',
  'brunch',
  'lunch',
  'snack',
  'dinner',
  'dessert'
];
const RECIPE_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
type RecipeDetailSection = 'preparation' | 'ingredients' | 'guidance' | 'storage';
const RECIPE_DETAIL_SECTIONS: readonly RecipeDetailSection[] = [
  'preparation',
  'ingredients',
  'guidance',
  'storage'
];

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function mealTypeFromQuery(value: string | null): MealType | null {
  return value && RECIPE_MEAL_TYPES.includes(value as MealType) ? (value as MealType) : null;
}

function difficultyFromQuery(value: string | null): Difficulty | null {
  return value && RECIPE_DIFFICULTIES.includes(value as Difficulty) ? (value as Difficulty) : null;
}

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    ButtonComponent,
    BadgeComponent,
    TagComponent,
    FilterTagComponent,
    ModalComponent,
    PickerComponent,
    CatalogLabelPipe,
    IconComponent,
    RecipeStepPhotoComponent,
    AiParticipantsComponent,
    RecipeDetailViewComponent,
    RecipeCatalogResultsComponent
  ],
  template: `
    <div class="recipes">
      <div *ngIf="!selectedRecipe()" class="recipes__list-view" data-test="recipe-list-view">
        <!-- Header -->
        <div class="recipes__header">
          <div class="recipes__title-section">
            <h1 class="recipes__title" data-test="recipe-list-heading" tabindex="-1">
              {{ 'recipes.title' | t }}
            </h1>
            <span class="recipes__count">{{ recetasLabel() }}</span>
          </div>
          <div class="recipes__actions">
            <app-button
              *ngIf="collection() === 'book'"
              variant="outline"
              data-test="recipe-create-action"
              (onClick)="createManualRecipe()"
            >
              <app-icon name="add" [size]="16" [label]="null" />
              {{ 'recipes.create_manual' | t }}
            </app-button>
            <app-button variant="outline" (onClick)="openFilterModal()">
              <app-icon name="filter_list" [size]="16" [label]="null" />
              {{ 'recipes.filters' | t }}
            </app-button>
            <app-button variant="primary" (onClick)="openAiModal()">
              <app-icon name="smart_toy" [size]="16" [label]="null" />
              {{ 'recipes.genAI' | t }}
            </app-button>
          </div>
        </div>

        <div
          class="recipes__collections"
          role="tablist"
          [attr.aria-label]="'recipes.collection.label' | t"
        >
          <button
            type="button"
            role="tab"
            class="recipes__collection-tab"
            [class.is-active]="collection() === 'all'"
            [attr.aria-selected]="collection() === 'all'"
            (click)="setCollection('all')"
          >
            {{ 'recipes.collection.all' | t }}
          </button>
          <button
            type="button"
            role="tab"
            class="recipes__collection-tab"
            [class.is-active]="collection() === 'book'"
            [attr.aria-selected]="collection() === 'book'"
            (click)="setCollection('book')"
          >
            {{ 'recipes.collection.book' | t }}
          </button>
        </div>

        <div class="recipes__filter-row">
          <div
            class="recipes__browse-toolbar"
            [class.recipes__browse-toolbar--with-clear]="
              hasActiveFilters() && recipeService.recipes().length > 0
            "
          >
            <form
              class="recipe-book-search"
              role="search"
              (submit)="$event.preventDefault(); applySearch()"
            >
              <label class="recipe-book-search__label" for="recipe-search">{{
                'recipes.search.label' | t
              }}</label>
              <div class="recipe-book-search__field">
                <app-icon name="search" [size]="18" [label]="null" />
                <input
                  id="recipe-search"
                  data-test="recipe-search"
                  type="search"
                  name="recipeSearch"
                  [ngModel]="searchInput()"
                  (ngModelChange)="searchInput.set($event)"
                  [placeholder]="'recipes.search.placeholder' | t"
                  autocomplete="off"
                />
              </div>
            </form>

            <div class="recipes__browse-actions">
              <app-button
                *ngIf="hasActiveFilters() && recipeService.recipes().length > 0"
                variant="ghost"
                (onClick)="clearFilters()"
              >
                {{ 'recipes.book.clear' | t }}
              </app-button>
              <div
                class="recipes__view-switch"
                role="group"
                [attr.aria-label]="'recipes.view.label' | t"
              >
                <button
                  type="button"
                  class="recipes__view-button"
                  [class.is-active]="viewMode() === 'grid'"
                  [attr.aria-label]="'recipes.view.grid' | t"
                  [attr.aria-pressed]="viewMode() === 'grid'"
                  data-test="recipe-view-grid"
                  (click)="setViewMode('grid')"
                >
                  <app-icon name="calendar_view_month" [size]="18" [label]="null" />
                  <span class="recipes__view-label">{{ 'recipes.view.grid' | t }}</span>
                </button>
                <button
                  type="button"
                  class="recipes__view-button"
                  [class.is-active]="viewMode() === 'list'"
                  [attr.aria-label]="'recipes.view.list' | t"
                  [attr.aria-pressed]="viewMode() === 'list'"
                  data-test="recipe-view-list"
                  (click)="setViewMode('list')"
                >
                  <app-icon name="menu" [size]="18" [label]="null" />
                  <span class="recipes__view-label">{{ 'recipes.view.list' | t }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Quick Filters -->
          <div class="recipes__quick-filters">
            <app-filter-tag
              *ngFor="let filter of quickFilters"
              [selected]="activeFilter() === filter.value"
              [touchTarget]="true"
              (onClick)="setFilter(filter.value)"
            >
              <app-icon [name]="filter.icon" [size]="16" [label]="null" />
              {{ filter.labelKey | t }}
            </app-filter-tag>
          </div>
        </div>

        <app-recipe-catalog-results
          [collection]="collection()"
          [featuredRecipe]="featuredRecipe()"
          [recipes]="recipesForGrid()"
          [viewMode]="viewMode()"
          [showAllMobile]="showAllMobileRecipes()"
          [loading]="recipeService.isLoading()"
          [loadError]="!!recipeService.recipesLoadError()"
          [total]="recipeService.total()"
          [page]="page()"
          [pageCount]="pageCount()"
          [hasActiveFilters]="hasActiveFilters()"
          [display]="recipeCatalogDisplay"
          (showAllMobileChange)="showAllMobileRecipes.set($event)"
          (recipeOpened)="viewRecipe($event)"
          (favoriteToggled)="toggleFavorite($event)"
          (openAi)="openAiModal()"
          (clearFiltersRequested)="clearFilters()"
          (retryRequested)="recipeService.retryLoadRecipes()"
          (pageChange)="changePage($event)"
        />
        <!-- Book filters -->
        <app-modal
          [isOpen]="isFilterModalOpen()"
          [title]="'recipes.book.filters_title' | t"
          size="md"
          (onClose)="closeFilterModal()"
        >
          <div class="recipe-book-filter-form">
            <div class="recipe-book-filter-form__field" data-test="recipe-book-country">
              <span class="recipe-book-filter-form__label">{{ 'recipes.book.country' | t }}</span>
              <app-picker
                id="recipe-book-country"
                [options]="countryOptions"
                [value]="draftCountry()"
                [label]="'recipes.book.country' | t"
                [placeholder]="'recipes.book.country_any' | t"
                [floatingPanel]="true"
                (valueChange)="draftCountry.set($event)"
              />
            </div>
            <div class="recipe-book-filter-form__field" data-test="recipe-book-meal">
              <span class="recipe-book-filter-form__label">{{ 'recipes.book.meal' | t }}</span>
              <app-picker
                id="recipe-book-meal"
                [options]="mealTypeOptions"
                [value]="draftMealType()"
                [label]="'recipes.book.meal' | t"
                [placeholder]="'recipes.book.meal_any' | t"
                [floatingPanel]="true"
                (valueChange)="draftMealType.set($event)"
              />
            </div>
            <div class="recipe-book-filter-form__field">
              <span class="recipe-book-filter-form__label">{{ 'recipes.dificultad' | t }}</span>
              <app-picker
                id="recipe-book-difficulty"
                [options]="difficultyOptions"
                [value]="draftDifficulty()"
                [label]="'recipes.dificultad' | t"
                [placeholder]="'ui.choose' | t"
                [floatingPanel]="true"
                (valueChange)="draftDifficulty.set($event)"
              />
            </div>
            <div class="recipe-book-filter-form__field">
              <label for="recipe-book-cuisine">{{ 'recipes.book.cuisine' | t }}</label>
              <input
                id="recipe-book-cuisine"
                class="form-input"
                type="text"
                [ngModel]="draftCuisine()"
                (ngModelChange)="draftCuisine.set($event)"
                [ngModelOptions]="{ standalone: true }"
                [placeholder]="'recipes.book.cuisine_placeholder' | t"
              />
            </div>
            <div class="recipe-book-filter-form__field">
              <label for="recipe-book-tags">{{ 'recipes.book.tags' | t }}</label>
              <input
                id="recipe-book-tags"
                class="form-input"
                type="text"
                [ngModel]="draftTags()"
                (ngModelChange)="draftTags.set($event)"
                [ngModelOptions]="{ standalone: true }"
                [placeholder]="'recipes.book.tags_placeholder' | t"
              />
            </div>
            <div class="recipe-book-filter-form__field">
              <label for="recipe-book-max-time">{{ 'recipes.book.max_time' | t }}</label>
              <input
                id="recipe-book-max-time"
                class="form-input"
                type="number"
                min="1"
                max="1440"
                [ngModel]="draftMaxTime()"
                (ngModelChange)="draftMaxTime.set($event)"
                [ngModelOptions]="{ standalone: true }"
                [placeholder]="'recipes.book.max_time_placeholder' | t"
              />
            </div>
            <div class="recipe-book-filter-form__actions">
              <app-button variant="outline" (onClick)="closeFilterModal()">
                {{ 'common.cancel' | t }}
              </app-button>
              <app-button variant="primary" (onClick)="applyFilters()">
                {{ 'recipes.book.apply' | t }}
              </app-button>
            </div>
          </div>
        </app-modal>

        <!-- AI Generation Modal -->
        <app-modal
          #aiGenerationModal
          [isOpen]="isAiModalOpen()"
          [title]="'recipes.generar_receta_con_ia' | t"
          [size]="aiPreviewModalSize()"
          (onClose)="closeAiModal()"
        >
          <div *ngIf="isAiFormVisible()" class="ai-form">
            <ol
              class="recipe-ai-wizard__steps"
              [attr.aria-label]="'recipes.ai_wizard_label' | t"
              data-test="recipe-ai-wizard-steps"
            >
              <li
                *ngFor="let step of recipeAiSteps"
                [class.recipe-ai-wizard__step--active]="aiGenerationStep() === step.id"
                [class.recipe-ai-wizard__step--complete]="aiGenerationStep() > step.id"
                [attr.aria-current]="aiGenerationStep() === step.id ? 'step' : null"
              >
                <span class="recipe-ai-wizard__step-number">{{ step.id }}</span>
                <span>{{ step.label | t }}</span>
              </li>
            </ol>

            <section
              *ngIf="aiGenerationStep() === 1"
              class="ai-form__step"
              data-test="recipe-ai-step-1"
            >
              <h3 tabindex="-1">{{ 'recipes.ai_step_ingredients' | t }}</h3>
              <p class="ai-form__description">
                {{ 'recipes.selecciona_los_ingredientes_que' | t }}
              </p>

              <div class="ai-form__section">
                <div class="ai-form__section-heading">
                  <label class="ai-form__label">{{
                    'recipes.ingredientes_seleccionados' | t
                  }}</label>
                  <span class="recipe-ai-wizard__count" data-test="selected-ingredient-count">
                    {{ 'recipes.ai_selected_count' | t: { count: selectedIngredients().length } }}
                  </span>
                </div>
                <div class="ai-form__ingredients">
                  <app-tag
                    *ngFor="let ing of selectedIngredients()"
                    [removable]="true"
                    (onRemove)="removeIngredient(ing)"
                  >
                    {{ ing.name | catalog }}
                  </app-tag>
                  <span *ngIf="selectedIngredients().length === 0" class="ai-form__hint">
                    {{ 'recipes.selecciona_ingredientes_de_abajo' | t }}
                  </span>
                </div>
              </div>

              <div class="ai-form__section">
                <div class="ai-form__section-heading">
                  <label class="ai-form__label">{{ 'recipes.tu_despensa' | t }}</label>
                  <div class="ai-form__bulk-actions">
                    <button
                      type="button"
                      class="recipe-ai-wizard__text-action"
                      data-test="recipe-ai-select-all"
                      (click)="selectAllRecipeIngredients()"
                    >
                      {{ 'recipes.ai_select_all' | t }}
                    </button>
                    <button
                      type="button"
                      class="recipe-ai-wizard__text-action"
                      [disabled]="selectedIngredients().length === 0"
                      data-test="recipe-ai-clear-ingredients"
                      (click)="clearRecipeIngredients()"
                    >
                      {{ 'recipes.ai_clear_selection' | t }}
                    </button>
                  </div>
                </div>
                <div
                  class="recipe-ai-wizard__categories"
                  role="group"
                  [attr.aria-label]="'recipes.ai_category_filter' | t"
                >
                  <button
                    type="button"
                    class="recipe-ai-wizard__category"
                    [attr.aria-pressed]="recipeIngredientCategory() === 'all'"
                    data-test="recipe-ai-category-all"
                    (click)="setRecipeIngredientCategory('all')"
                  >
                    {{ 'recipes.ai_category_all' | t }}
                  </button>
                  <button
                    *ngFor="
                      let category of recipeIngredientCategoryOptions();
                      trackBy: trackRecipeIngredientCategory
                    "
                    type="button"
                    class="recipe-ai-wizard__category"
                    [attr.aria-pressed]="recipeIngredientCategory() === category.key"
                    [attr.data-test]="'recipe-ai-category-' + category.key"
                    (click)="setRecipeIngredientCategory(category.key)"
                  >
                    {{ getCategoryIcon(category.key) }} {{ category.label }}
                  </button>
                </div>
                <div class="ai-form__pantry" data-test="recipe-ai-pantry-options">
                  <button
                    *ngFor="let ing of visibleRecipeIngredients()"
                    type="button"
                    class="recipe-ai-wizard__ingredient"
                    [class.recipe-ai-wizard__ingredient--selected]="isIngredientSelected(ing.id)"
                    [attr.aria-pressed]="isIngredientSelected(ing.id)"
                    [attr.data-ingredient-id]="ing.id"
                    (click)="toggleIngredientSelection(ing)"
                  >
                    {{ getCategoryIcon(ing.category) }} {{ ing.name | catalog }}
                  </button>
                  <span *ngIf="visibleRecipeIngredients().length === 0" class="ai-form__hint">{{
                    'recipes.ai_no_ingredients' | t
                  }}</span>
                </div>
              </div>
            </section>

            <section
              *ngIf="aiGenerationStep() === 2"
              class="ai-form__step"
              data-test="recipe-ai-step-2"
            >
              <h3 tabindex="-1">{{ 'recipes.ai_step_participants' | t }}</h3>
              <app-ai-participants
                [members]="householdService.household()?.members ?? []"
                [selectedMemberIds]="recipeMemberIds()"
                (selectedMemberIdsChange)="recipeMemberIds.set($event)"
                [guests]="recipeGuests()"
                (guestsChange)="recipeGuests.set($event)"
              />
            </section>

            <section
              *ngIf="aiGenerationStep() === 3"
              class="ai-form__step"
              data-test="recipe-ai-step-3"
            >
              <h3 tabindex="-1">{{ 'recipes.ai_step_options' | t }}</h3>
              <p class="ai-form__description">{{ 'recipes.ai_review_hint' | t }}</p>
              <div class="ai-form__section">
                <label class="ai-form__label"
                  >{{ 'recipes.ingredientes_seleccionados' | t }} ·
                  {{
                    'recipes.ai_selected_count' | t: { count: selectedIngredients().length }
                  }}</label
                >
                <div class="ai-form__ingredients" data-test="recipe-ai-review-ingredients">
                  <app-tag *ngFor="let ing of selectedIngredients()">{{
                    ing.name | catalog
                  }}</app-tag>
                  <span *ngIf="selectedIngredients().length === 0" class="ai-form__hint">{{
                    'recipes.ai_no_ingredients' | t
                  }}</span>
                </div>
              </div>
              <div class="ai-form__row">
                <div class="ai-form__field">
                  <label class="ai-form__label" for="recipe-difficulty">{{
                    'recipes.dificultad' | t
                  }}</label>
                  <select
                    id="recipe-difficulty"
                    [(ngModel)]="aiOptions.difficulty"
                    [ngModelOptions]="{ standalone: true }"
                    class="form-select"
                  >
                    <option value="easy">{{ 'recipes.facil' | t }}</option>
                    <option value="medium">{{ 'recipes.medio' | t }}</option>
                    <option value="hard">{{ 'recipes.dificil' | t }}</option>
                  </select>
                </div>
                <div class="ai-form__field">
                  <label class="ai-form__label" for="recipe-serving-input">{{
                    'recipes.porciones' | t
                  }}</label>
                  <input
                    id="recipe-serving-input"
                    type="number"
                    [ngModel]="aiOptions.servings"
                    (ngModelChange)="setAiServings($event)"
                    [ngModelOptions]="{ standalone: true }"
                    min="1"
                    step="1"
                    required
                    class="form-input"
                    aria-describedby="recipe-servings-hint"
                  />
                  <p id="recipe-servings-hint" class="ai-form__hint">
                    {{ 'recipes.confirm_servings' | t }}
                  </p>
                </div>
                <div class="ai-form__field">
                  <label class="ai-form__label" for="recipe-detail-level">{{
                    'recipes.detalle' | t
                  }}</label>
                  <select
                    id="recipe-detail-level"
                    [ngModel]="aiOptions.detailLevel"
                    (ngModelChange)="setAiDetailLevel($event)"
                    [ngModelOptions]="{ standalone: true }"
                    class="form-select"
                  >
                    <option value="basic">{{ detailLevelLabel('basic') | t }}</option>
                    <option value="intermediate">{{ detailLevelLabel('intermediate') | t }}</option>
                    <option value="expert">{{ detailLevelLabel('expert') | t }}</option>
                  </select>
                </div>
              </div>
              <p
                *ngIf="selectedIngredients().length === 0"
                class="recipe-ai-wizard__validation"
                role="status"
              >
                {{ 'recipes.ai_need_ingredient' | t }}
              </p>
            </section>

            <div class="ai-form__actions recipe-ai-wizard__actions">
              <app-button
                *ngIf="aiGenerationStep() > 1"
                variant="outline"
                data-test="recipe-ai-back"
                (onClick)="setRecipeAiStep(aiGenerationStep() - 1)"
              >
                {{ 'recipes.ai_previous' | t }}
              </app-button>
              <span class="recipe-ai-wizard__spacer"></span>
              <app-button
                *ngIf="aiGenerationStep() < 3"
                variant="primary"
                data-test="recipe-ai-next"
                (onClick)="setRecipeAiStep(aiGenerationStep() + 1)"
              >
                {{ 'recipes.ai_next' | t }}
              </app-button>
              <ng-container *ngIf="aiGenerationStep() === 3">
                <app-button
                  variant="primary"
                  [loading]="aiService.isGenerating()"
                  [disabled]="selectedIngredients().length === 0 || !validRecipeServings()"
                  (onClick)="generateSingle()"
                >
                  {{ 'recipes.generar_1_receta' | t }}
                </app-button>
                <app-button
                  variant="outline"
                  [loading]="aiService.isGenerating()"
                  [disabled]="selectedIngredients().length === 0 || !validRecipeServings()"
                  (onClick)="generateMultiple()"
                >
                  {{ 'recipes.generar_3_opciones' | t }}
                </app-button>
              </ng-container>
            </div>
          </div>

          <div *ngIf="hasGeneratedRecipePreview()" class="generated-recipe__form-toggle">
            <app-button variant="outline" (onClick)="toggleAiFormExpanded()">
              {{ (aiFormExpanded() ? 'recipes.hide_form' : 'recipes.edit_ingredients') | t }}
            </app-button>
          </div>

          <!-- Generated Recipe -->
          <div *ngIf="generatedPreviewRecipe() as recipe" class="generated-recipe">
            <div class="generated-recipe__header">
              <h3 tabindex="-1" class="generated-recipe__title">{{ recipe.name }}</h3>
              <div class="generated-recipe__meta">
                <app-badge variant="secondary">{{
                  'recipes.porciones_n' | t: { n: generatedPreviewServings() }
                }}</app-badge>
                <app-badge *ngIf="recipe.calories">{{
                  'recipes.kcal_per_serving' | t: { n: recipe.calories }
                }}</app-badge>
              </div>
            </div>

            <div class="recipe-detail__servings" data-test="generated-recipe-serving-control">
              <label for="generated-recipe-serving-count">{{
                'recipes.servings_scaled_label' | t
              }}</label>
              <input
                id="generated-recipe-serving-count"
                class="form-input"
                type="number"
                min="1"
                step="1"
                [ngModel]="generatedPreviewServings()"
                (ngModelChange)="setGeneratedPreviewServings($event)"
                aria-describedby="generated-recipe-serving-hint"
                data-test="generated-serving-count"
              />
              <span id="generated-recipe-serving-hint" class="recipe-detail__hint">
                {{ 'recipes.scaled_only' | t }}
              </span>
            </div>

            <section
              *ngIf="recipe.guidance.batchCookingWarning"
              class="step-card__warning generated-recipe__batch-warning"
              data-test="generated-recipe-batch-warning"
              role="note"
            >
              <app-icon name="error_outline" [size]="16" [label]="null" />
              <strong>{{ 'recipes.batch_cooking_warning_heading' | t }}:</strong>
              {{ recipe.guidance.batchCookingWarning }}
            </section>

            <p class="generated-recipe__description">{{ recipe.description }}</p>
            <div
              class="recipe-detail__timings generated-recipe__timings"
              [attr.aria-label]="'recipes.total_time' | t"
              data-test="generated-recipe-timings"
            >
              <span
                ><strong>{{ 'recipes.total_time' | t }}</strong>
                {{ 'recipes.min' | t: { n: recipe.totalTime } }}</span
              >
              <span *ngIf="recipe.prepTime"
                ><strong>{{ 'recipes.prep_time' | t }}</strong>
                {{ 'recipes.min' | t: { n: recipe.prepTime } }}</span
              >
              <span *ngIf="recipe.cookTime"
                ><strong>{{ 'recipes.cook_time' | t }}</strong>
                {{ 'recipes.min' | t: { n: recipe.cookTime } }}</span
              >
              <span *ngIf="recipe.restTime"
                ><strong>{{ 'recipes.rest_time' | t }}</strong>
                {{ 'recipes.min' | t: { n: recipe.restTime } }}</span
              >
            </div>

            <section
              *ngIf="recipe.nutrition"
              class="recipe-detail__section recipe-detail__panel"
              data-test="generated-recipe-nutrition"
            >
              <h4>{{ 'recipes.nutrition' | t }}</h4>
              <dl class="recipe-detail__nutrition">
                <div *ngIf="recipe.nutrition?.protein !== undefined">
                  <dt>{{ 'recipes.protein' | t }}</dt>
                  <dd>{{ recipe.nutrition?.protein }} g</dd>
                </div>
                <div *ngIf="recipe.nutrition?.carbs !== undefined">
                  <dt>{{ 'recipes.carbs' | t }}</dt>
                  <dd>{{ recipe.nutrition?.carbs }} g</dd>
                </div>
                <div *ngIf="recipe.nutrition?.fat !== undefined">
                  <dt>{{ 'recipes.fat' | t }}</dt>
                  <dd>{{ recipe.nutrition?.fat }} g</dd>
                </div>
                <div
                  *ngIf="recipe.nutrition?.fiber !== undefined && recipe.nutrition?.fiber !== null"
                >
                  <dt>{{ 'recipes.fiber' | t }}</dt>
                  <dd>{{ recipe.nutrition?.fiber }} g</dd>
                </div>
              </dl>
            </section>

            <!-- Ingredients -->
            <div class="generated-recipe__section" data-test="generated-recipe-ingredients">
              <h4>{{ 'dashboard.ingredients' | t }}</h4>
              <ul class="generated-recipe__list">
                <li *ngFor="let ing of recipe.ingredients">
                  {{
                    'recipes.ingrediente_de'
                      | t
                        : {
                            quantity: generatedPreviewIngredientQuantity(recipe, ing.quantity),
                            unit: ing.unit,
                            name: ing.name
                          }
                  }}
                  <span *ngIf="ing.preparation" class="generated-recipe__prep"
                    >({{ ing.preparation }})</span
                  >
                  <span *ngIf="ing.notes" class="generated-recipe__prep"> · {{ ing.notes }}</span>
                  <span *ngIf="ing.isOptional" class="recipe-detail__optional">
                    · {{ 'recipes.optional' | t }}</span
                  >
                  <span *ngIf="ing.substitutes?.length" class="generated-recipe__prep">
                    · {{ 'recipes.substitutes' | t }}: {{ ing.substitutes?.join(', ') }}</span
                  >
                </li>
              </ul>
            </div>

            <section
              *ngIf="
                recipe.guidance && (recipe.guidance.appliances.length || recipe.utensils.length)
              "
              class="generated-recipe__section"
              data-test="generated-recipe-equipment"
            >
              <h4>{{ 'recipes.appliances' | t }}</h4>
              <p *ngIf="recipe.guidance.appliances.length">
                {{ recipe.guidance.appliances.join(', ') }}
              </p>
              <p *ngIf="recipe.utensils.length">
                {{ 'recipes.utensils' | t }}: {{ recipe.utensils.join(', ') }}
              </p>
            </section>

            <!-- Steps -->
            <div class="generated-recipe__section" data-test="generated-recipe-preparation">
              <h4>{{ 'recipes.preparacion' | t }}</h4>
              <div
                *ngIf="recipe.instructionsByLevel"
                class="ai-form__field generated-recipe__detail-level"
              >
                <label class="ai-form__label" for="generated-recipe-detail-level">
                  {{ 'recipes.detalle' | t }}
                </label>
                <select
                  id="generated-recipe-detail-level"
                  class="form-select"
                  [ngModel]="generatedPreviewDetailLevel()"
                  (ngModelChange)="setGeneratedPreviewDetailLevel($event)"
                >
                  <option value="basic">{{ detailLevelLabel('basic') | t }}</option>
                  <option value="intermediate">{{ detailLevelLabel('intermediate') | t }}</option>
                  <option value="expert">{{ detailLevelLabel('expert') | t }}</option>
                </select>
              </div>
              <div class="generated-recipe__steps">
                <div
                  *ngFor="
                    let step of getGeneratedRecipeSteps(recipe, generatedPreviewDetailLevel())
                  "
                  class="step"
                >
                  <span class="step__number">{{ step.stepNumber }}</span>
                  <div class="step__content">
                    <app-recipe-step-photo
                      [instruction]="step.instruction"
                      [image]="step.image"
                      [imageAttribution]="step.imageAttribution"
                    />
                    <p class="step__instruction">{{ step.instruction }}</p>
                    <div class="step__meta" *ngIf="step.duration || step.tips">
                      <span *ngIf="step.duration" class="step__duration">{{
                        'recipes.min' | t: { n: step.duration }
                      }}</span>
                      <span *ngIf="step.tips" class="step__tips">
                        <app-icon name="help_outline" [size]="16" [label]="null" /> {{ step.tips }}
                      </span>
                    </div>
                    <div
                      *ngIf="step.warning"
                      class="step-card__warning"
                      data-test="generated-recipe-warning"
                    >
                      <app-icon name="error_outline" [size]="16" [label]="null" />
                      {{ step.warning }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <section *ngIf="recipe.guidance" class="generated-recipe__guidance">
              <div
                *ngIf="recipe.guidance.parallelTasks.length"
                class="generated-recipe__section"
                data-test="generated-recipe-parallel-tasks"
              >
                <h4>{{ 'recipes.parallel_tasks' | t }}</h4>
                <ul>
                  <li *ngFor="let task of recipe.guidance.parallelTasks">{{ task }}</li>
                </ul>
              </div>
              <div
                *ngIf="recipe.guidance.tipsAndVariations.length"
                class="generated-recipe__section"
                data-test="generated-recipe-tips-variations"
              >
                <h4>{{ 'recipes.tips_variations' | t }}</h4>
                <ul>
                  <li *ngFor="let tip of recipe.guidance.tipsAndVariations">{{ tip }}</li>
                </ul>
              </div>
            </section>

            <section
              *ngIf="recipe.storage"
              class="recipe-detail__section recipe-detail__panel"
              data-test="generated-recipe-storage"
            >
              <h4>{{ 'recipes.conservacion' | t }}</h4>
              <p>
                {{ recipe.storage.method }} ·
                {{ 'recipes.storage_fridge' | t: { duration: recipe.storage.duration } }}
              </p>
              <p *ngIf="recipe.storage.container">
                {{ 'recipes.container' | t: { name: recipe.storage.container } }}
              </p>
              <p *ngIf="recipe.storage.freezingPossible && recipe.storage.freezingDuration">
                {{ 'recipes.freezing_duration' | t: { duration: recipe.storage.freezingDuration } }}
              </p>
              <p *ngIf="recipe.storage.freezingPossible === false">
                {{ 'recipes.no_freezing' | t }}
              </p>
              <p *ngIf="recipe.storage.reheatingInstructions">
                {{ 'recipes.recalentar' | t: { text: recipe.storage.reheatingInstructions } }}
              </p>
            </section>

            <!-- Save Button -->
            <div class="generated-recipe__actions">
              <app-button
                *ngIf="selectedGeneratedOptionIndex() !== null"
                variant="outline"
                (onClick)="returnToGeneratedOptions()"
              >
                {{ 'recipes.back_to_options' | t }}
              </app-button>
              <app-button
                variant="primary"
                (onClick)="saveGeneratedRecipe(recipe, generatedPreviewDetailLevel())"
              >
                {{ 'recipes.guardar_receta' | t }}
              </app-button>
              <app-button variant="ghost" (onClick)="discardGeneratedPreviews()">
                {{ 'ui.dismiss' | t }}
              </app-button>
            </div>
          </div>

          <!-- Multiple results are drafts: persist only the one the user explicitly saves. -->
          <section
            *ngIf="
              aiService.generatedRecipes().length > 0 && selectedGeneratedOptionIndex() === null
            "
            class="generated-options"
            [attr.aria-label]="'recipes.elige_una_para_guardar' | t"
          >
            <h3 tabindex="-1" class="generated-options__title">
              {{ 'recipes.elige_una_para_guardar' | t }}
            </h3>
            <div class="generated-options__list">
              <article
                *ngFor="let recipe of aiService.generatedRecipes(); let i = index"
                class="generated-option"
                [attr.aria-label]="recipe.name"
              >
                <div class="generated-option__header">
                  <h4 class="generated-option__title">{{ recipe.name }}</h4>
                  <div class="generated-option__meta">
                    <app-badge variant="primary">{{
                      'recipes.min' | t: { n: recipe.totalTime }
                    }}</app-badge>
                    <app-badge variant="secondary">{{
                      'recipes.porciones_n' | t: { n: generatedPreviewServings() }
                    }}</app-badge>
                  </div>
                </div>
                <p class="generated-option__description">{{ recipe.description }}</p>
                <div
                  *ngIf="recipe.instructionsByLevel"
                  class="ai-form__field generated-option__detail-level"
                >
                  <label class="ai-form__label" [attr.for]="'generated-option-level-' + i">
                    {{ 'recipes.detalle' | t }}
                  </label>
                  <select
                    [id]="'generated-option-level-' + i"
                    class="form-select"
                    [ngModel]="generatedRecipeDetailLevel(i)"
                    (ngModelChange)="setGeneratedRecipeDetailLevel(i, $event)"
                  >
                    <option value="basic">{{ detailLevelLabel('basic') | t }}</option>
                    <option value="intermediate">{{ detailLevelLabel('intermediate') | t }}</option>
                    <option value="expert">{{ detailLevelLabel('expert') | t }}</option>
                  </select>
                  <ol class="generated-option__steps">
                    <li
                      *ngFor="
                        let step of getGeneratedRecipeSteps(recipe, generatedRecipeDetailLevel(i))
                      "
                    >
                      {{ step.instruction }}
                    </li>
                  </ol>
                </div>
                <div class="generated-option__actions">
                  <app-button variant="outline" (onClick)="viewGeneratedOption(i)">
                    {{ 'recipes.view_full_recipe' | t }}
                  </app-button>
                  <app-button
                    variant="primary"
                    (onClick)="saveGeneratedRecipe(recipe, generatedRecipeDetailLevel(i))"
                  >
                    {{ 'recipes.guardar_receta' | t }}
                  </app-button>
                </div>
              </article>
            </div>
          </section>
        </app-modal>
      </div>

      <!-- Saved recipes have a shareable full-page view, not a dialog over the list. -->
      <app-recipe-detail-view
        *ngIf="selectedRecipe() as recipe"
        [recipe]="recipe"
        [isCookingMode]="isCookingMode()"
        [hasCookingSession]="hasCookingSession()"
        [servings]="recipeServings()"
        [detailSection]="recipeDetailSection()"
        [checkedIngredients]="checkedRecipeIngredients()"
        [detailLevel]="selectedRecipeDetailLevel()"
        [cookingRecipeId]="cookingRecipeId()"
        [canEdit]="canEditRecipe(recipe)"
        [imageUrl]="recipeImageUrl(recipe)"
        [difficultyLabel]="getDifficultyLabel(recipe.difficulty)"
        [difficultyVariant]="getDifficultyVariant(recipe.difficulty)"
        [countryLabel]="recipe.countryCode ? countryLabel(recipe.countryCode) : ''"
        [sourceUrl]="attributionUrl(recipe)"
        [steps]="getRecipeSteps(recipe, selectedRecipeDetailLevel())"
        (closeRequested)="closeRecipeDetail()"
        (editRequested)="editRecipe(recipe)"
        (servingsChanged)="setRecipeServings($event)"
        (detailSectionChanged)="setRecipeDetailSection($event)"
        (detailLevelChanged)="setSelectedRecipeDetailLevel($event)"
        (detailTabKeydown)="onRecipeDetailTabKeydown($event.event, $event.index)"
        (ingredientChecked)="setRecipeIngredientChecked($event.index, $event.event)"
        (cookingModeEntered)="enterCookingMode()"
        (cookRequested)="cookRecipe(recipe)"
        (favoriteToggled)="toggleFavorite(recipe)"
        (cookingModeExited)="exitCookingMode()"
      />
    </div>
  `,
  styleUrls: ['./recipes.component.css']
})
export class RecipesComponent implements OnInit {
  @ViewChild('aiGenerationModal') private aiGenerationModal?: ModalComponent;

  private readonly i18n = inject(I18nService);
  private readonly authService = inject(AuthService);
  readonly householdService = inject(HouseholdService);
  private readonly tasteProfileService = inject(TasteProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** Cuantas recetas hay, dicho como se lee: «1 receta» no es «1 recetas». */
  recetasLabel(): string {
    const n = this.recipeService.total();
    return this.i18n.plural(n, 'recipes.n_recetas_uno', 'recipes.n_recetas_varios', { count: n });
  }

  createManualRecipe(): void {
    void this.router.navigate(['/recipes', 'new']);
  }

  recipeService = inject(RecipeService);
  readonly recipeCatalogDisplay: RecipeCatalogDisplay = {
    imageUrl: (recipe) => this.recipeImageUrl(recipe),
    difficultyVariant: (difficulty) => this.getDifficultyVariant(difficulty),
    difficultyLabel: (difficulty) => this.getDifficultyLabel(difficulty),
    countryLabel: (countryCode) => this.countryLabel(countryCode),
    mealTypeLabel: (mealType) => this.mealTypeLabel(mealType)
  };
  aiService = inject(AiService);
  pantryService = inject(PantryService);
  private toastService = inject(ToastService);

  readonly recipeAiSteps: readonly { id: number; label: TranslationKey }[] = [
    { id: 1, label: 'recipes.ai_step_ingredients' },
    { id: 2, label: 'recipes.ai_step_participants' },
    { id: 3, label: 'recipes.ai_step_options' }
  ];

  activeFilter = signal('');
  collection = signal<'all' | 'book'>('all');
  featuredRecipe = computed(() => {
    if (this.collection() !== 'all' || this.hasActiveFilters() || this.page() !== 1) return null;
    return this.recipeService.recipes()[0] ?? null;
  });
  recipesForGrid = computed(() => this.recipeService.recipes());
  showAllMobileRecipes = signal(false);
  searchInput = signal('');
  viewMode = signal<'grid' | 'list'>(this.initialRecipeViewMode());
  isFilterModalOpen = signal(false);
  private country = signal<string | null>(null);
  private mealType = signal<MealType | null>(null);
  private cuisine = signal('');
  private tags = signal<string[]>([]);
  private difficulty = signal<Difficulty | null>(null);
  private maxTime = signal<number | null>(null);
  page = signal(1);
  private pageSize = signal(9);
  draftCountry = signal<string | null>(null);
  draftMealType = signal<string | null>(null);
  draftCuisine = signal('');
  draftTags = signal('');
  draftDifficulty = signal<string | null>(null);
  draftMaxTime = signal<number | null>(null);
  isAiModalOpen = signal(false);
  aiGenerationStep = signal(1);
  recipeIngredientCategory = signal('all');
  selectedRecipe = signal<Recipe | null>(null);
  recipeDetailSection = signal<RecipeDetailSection>('preparation');
  checkedRecipeIngredients = signal<ReadonlySet<number>>(new Set<number>());
  cookingRecipeId = signal<string | null>(null);
  isCookingMode = signal(false);
  hasCookingSession = signal(false);
  recipeServings = signal(2);
  private readonly recipeServingsTouched = signal(false);
  generatedPreviewServings = signal(1);
  selectedIngredients = signal<any[]>([]);
  selectedRecipeDetailLevel = signal<DetailLevel>('intermediate');
  singleGeneratedDetailLevel = signal<DetailLevel>('intermediate');
  private recipeDetailPreferences = signal<RecipeDetailPreferences>({});
  private generatedRecipeLevels = signal<Record<number, DetailLevel>>({});
  selectedGeneratedOptionIndex = signal<number | null>(null);
  aiFormExpanded = signal(false);
  recipeMemberIds = signal<string[]>([]);
  recipeGuests = signal<AIGuestPreferences[]>([]);
  private readonly recipeContextHouseholdId = signal<string | null | undefined>(undefined);

  aiOptions = {
    difficulty: 'medium',
    servings: 2,
    detailLevel: 'intermediate'
  };
  private readonly servingsTouched = signal(false);
  private readonly detailLevelTouched = signal(false);
  private readonly syncRecipeHouseholdParticipants = effect(() => {
    if (!this.isAiModalOpen()) return;
    const householdId = this.householdService.activeHouseholdId();
    const household = this.householdService.household();
    if (!householdId) {
      if (this.recipeContextHouseholdId() === null) return;
      this.recipeContextHouseholdId.set(null);
      this.recipeMemberIds.set([]);
      this.recipeGuests.set([]);
      return;
    }
    if (household?.id !== householdId) {
      this.recipeContextHouseholdId.set(undefined);
      this.recipeMemberIds.set([]);
      this.recipeGuests.set([]);
      return;
    }
    if (this.recipeContextHouseholdId() === householdId) return;
    this.recipeContextHouseholdId.set(householdId);
    this.recipeMemberIds.set(
      household?.members.filter((member) => member.isActive).map((member) => member.id) ?? []
    );
    this.recipeGuests.set([]);
  });
  private readonly synchronizeGenerationDefaults = effect(() => {
    if (!this.servingsTouched()) {
      if (this.isAiModalOpen()) {
        const count = this.recipeMemberIds().length + this.recipeGuests().length;
        this.aiOptions.servings = this.householdService.household()
          ? count || 2
          : Math.max(2, count + 1);
      } else {
        this.aiOptions.servings = this.householdService.defaultServings();
      }
    }
    if (!this.detailLevelTouched()) {
      this.aiOptions.detailLevel = detailLevelForCookingLevel(
        this.tasteProfileService.profile().cookingLevel
      );
    }
  });
  private readonly synchronizeRecipeServingsDefault = effect(() => {
    if (!this.selectedRecipe() || this.recipeServingsTouched()) return;
    this.recipeServings.set(this.householdService.defaultServings());
  });

  /** Cuatro filtros, cuatro claves. «IA» en ingles se escribe «AI», y eso un catalogo con la frase dentro no lo puede saber. */
  readonly quickFilters: { value: string; labelKey: TranslationKey; icon: IconName }[] = [
    { value: '', labelKey: 'recipes.filtro_todas', icon: 'filter_list' },
    { value: 'favorites', labelKey: 'recipes.filtro_favoritas', icon: 'favorite' },
    { value: 'quick', labelKey: 'recipes.filtro_rapidas', icon: 'schedule' },
    { value: 'ai', labelKey: 'recipes.filtro_ia', icon: 'smart_toy' }
  ];

  get countryOptions(): PickerOption[] {
    return [
      { value: 'ES', label: this.i18n.t('recipes.book.country_es') },
      { value: 'SV', label: this.i18n.t('recipes.book.country_sv') }
    ];
  }

  get mealTypeOptions(): PickerOption[] {
    return [
      { value: 'breakfast', label: this.i18n.t('meal.breakfast') },
      { value: 'brunch', label: this.i18n.t('recipes.book.meal_brunch') },
      { value: 'lunch', label: this.i18n.t('meal.lunch') },
      { value: 'snack', label: this.i18n.t('meal.snack') },
      { value: 'dinner', label: this.i18n.t('meal.dinner') },
      { value: 'dessert', label: this.i18n.t('recipes.book.meal_dessert') }
    ];
  }

  get difficultyOptions(): PickerOption[] {
    return [
      { value: 'easy', label: this.i18n.t('recipes.facil') },
      { value: 'medium', label: this.i18n.t('recipes.medio') },
      { value: 'hard', label: this.i18n.t('recipes.dificil') }
    ];
  }

  constructor() {
    effect(() => {
      if (this.recipeService.isLoading() || this.recipeService.recipesLoadError()) return;
      const lastPage = this.pageCount();
      if (this.page() > lastPage) this.changePage(lastPage);
    });
  }

  ngOnInit(): void {
    this.pantryService.loadIngredients();
    this.householdService.ensureHousehold();
    this.tasteProfileService.ensureLoaded();

    this.route.queryParamMap
      .pipe(
        map((params) => ({
          collection: params.get('collection') === 'book' ? ('book' as const) : ('all' as const),
          search: params.get('search') ?? '',
          country: (params.get('country') ?? params.get('countryCode') ?? '').toUpperCase(),
          mealType: mealTypeFromQuery(params.get('mealType')),
          cuisine: params.get('cuisine') ?? '',
          tags: params.get('tags') ?? '',
          difficulty: difficultyFromQuery(params.get('difficulty')),
          maxTime: positiveInteger(params.get('maxTime')),
          isFavorite: ['true', '1'].includes(params.get('isFavorite') ?? ''),
          author: params.get('author'),
          page: positiveInteger(params.get('page')) ?? 1,
          pageSize: positiveInteger(params.get('pageSize'))
        })),
        distinctUntilChanged(
          (previous, current) => JSON.stringify(previous) === JSON.stringify(current)
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => {
        this.collection.set(state.collection);
        this.searchInput.set(state.search);
        this.country.set(/^[A-Z]{2}$/.test(state.country) ? state.country : null);
        this.mealType.set(state.mealType);
        this.cuisine.set(state.cuisine);
        this.tags.set(
          state.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        );
        this.difficulty.set(state.difficulty);
        this.maxTime.set(state.maxTime);
        this.page.set(state.page);
        this.pageSize.set(Math.min(100, state.pageSize ?? 9));
        this.activeFilter.set(
          state.isFavorite
            ? 'favorites'
            : state.author === 'ai'
              ? 'ai'
              : state.maxTime === 30
                ? 'quick'
                : ''
        );

        const filter: RecipeFilter = {
          page: state.page,
          pageSize: Math.min(100, state.pageSize ?? 9)
        };
        const search = state.search.trim();
        if (search) filter.search = search;
        if (/^[A-Z]{2}$/.test(state.country)) filter.countryCode = state.country;
        if (state.mealType) filter.mealType = state.mealType;
        if (state.cuisine.trim()) filter.cuisine = state.cuisine.trim();
        if (state.tags.trim()) {
          filter.tags = state.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
        }
        if (state.difficulty) filter.difficulty = state.difficulty;
        if (state.maxTime) filter.maxTime = state.maxTime;
        if (state.isFavorite) filter.isFavorite = true;
        if (state.author === 'ai' || state.author === 'user') filter.author = state.author;
        if (state.collection === 'book') filter.catalogOnly = true;
        this.recipeService.loadRecipes(filter);
      });

    combineLatest([this.route.queryParamMap, this.route.fragment])
      .pipe(
        map(([queryParams, fragment]) =>
          resolveRecipeRouteIntent(queryParams.get('recipe'), fragment)
        ),
        distinctUntilChanged(
          (previous, current) =>
            previous.type === current.type &&
            (previous.type !== 'recipe' ||
              (current.type === 'recipe' && previous.recipeId === current.recipeId))
        ),
        switchMap((intent) =>
          intent.type === 'recipe'
            ? this.recipeService
                .getRecipe(intent.recipeId)
                .pipe(map((recipe) => ({ intent, recipe })))
            : of({ intent, recipe: null })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ intent, recipe }) => {
        if (intent.type === 'ai') {
          this.selectedRecipe.set(null);
          if (!this.isAiModalOpen()) this.openAiModal();
          return;
        }

        if (intent.type === 'recipe') {
          if (this.isAiModalOpen()) this.closeAiModal();
          if (recipe) {
            this.showRecipe(recipe);
          } else {
            this.closeRecipeDetail();
          }
          return;
        }

        if (this.isAiModalOpen()) this.closeAiModal();
        if (this.selectedRecipe()) {
          this.selectedRecipe.set(null);
          this.focusAfterRender('[data-test="recipe-list-heading"]');
        }
      });
  }

  setFilter(filter: string): void {
    this.showAllMobileRecipes.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        isFavorite: filter === 'favorites' ? 'true' : null,
        author: filter === 'ai' ? 'ai' : null,
        maxTime: filter === 'quick' ? '30' : null,
        page: null
      },
      queryParamsHandling: 'merge'
    });
  }

  setCollection(collection: 'all' | 'book'): void {
    this.showAllMobileRecipes.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        collection: collection === 'book' ? 'book' : null,
        page: null,
        pageSize: null
      },
      queryParamsHandling: 'merge'
    });
  }

  applySearch(): void {
    this.showAllMobileRecipes.set(false);
    const search = this.searchInput().trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: search || null, page: null },
      queryParamsHandling: 'merge'
    });
  }

  setViewMode(mode: 'grid' | 'list'): void {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    const user = this.authService.currentUser();
    if (!user) return;

    this.authService
      .updateProfile({
        preferences: { ...user.preferences, recipeViewMode: mode }
      })
      .subscribe();
  }

  private initialRecipeViewMode(): 'grid' | 'list' {
    const stored = this.authService.currentUser()?.preferences?.recipeViewMode;
    if (stored === 'grid' || stored === 'list') return stored;
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
      ? 'list'
      : 'grid';
  }

  pageCount(): number {
    return Math.max(1, Math.ceil(this.recipeService.total() / this.pageSize()));
  }

  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.pageCount()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: String(nextPage) },
      queryParamsHandling: 'merge'
    });
  }

  hasActiveFilters(): boolean {
    return Boolean(
      this.searchInput().trim() ||
      this.country() ||
      this.mealType() ||
      this.cuisine().trim() ||
      this.tags().length > 0 ||
      this.difficulty() ||
      this.maxTime() ||
      this.activeFilter()
    );
  }

  openFilterModal(): void {
    this.draftCountry.set(this.country());
    this.draftMealType.set(this.mealType());
    this.draftCuisine.set(this.cuisine());
    this.draftTags.set(this.tags().join(', '));
    this.draftDifficulty.set(this.difficulty());
    this.draftMaxTime.set(this.maxTime());
    this.isFilterModalOpen.set(true);
  }

  closeFilterModal(): void {
    this.isFilterModalOpen.set(false);
  }

  applyFilters(): void {
    const maxTime = positiveInteger(
      this.draftMaxTime() === null ? null : String(this.draftMaxTime())
    );
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: this.searchInput().trim() || null,
        country: this.draftCountry() || null,
        countryCode: null,
        mealType: this.draftMealType() || null,
        cuisine: this.draftCuisine().trim() || null,
        tags: this.draftTags().trim() || null,
        difficulty: this.draftDifficulty() || null,
        maxTime: maxTime ? String(maxTime) : null,
        page: null
      },
      queryParamsHandling: 'merge'
    });
    this.closeFilterModal();
  }

  clearFilters(): void {
    this.searchInput.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: null,
        country: null,
        countryCode: null,
        mealType: null,
        mealTypes: null,
        cuisine: null,
        difficulty: null,
        maxTime: null,
        isFavorite: null,
        author: null,
        tags: null,
        page: null
      },
      queryParamsHandling: 'merge'
    });
  }

  countryLabel(countryCode: string): string {
    if (countryCode === 'ES') return this.i18n.t('recipes.book.country_es');
    if (countryCode === 'SV') return this.i18n.t('recipes.book.country_sv');
    return countryCode;
  }

  mealTypeLabel(mealType: MealType): string {
    const keys: Record<MealType, TranslationKey> = {
      breakfast: 'meal.breakfast',
      brunch: 'recipes.book.meal_brunch',
      lunch: 'meal.lunch',
      snack: 'meal.snack',
      dinner: 'meal.dinner',
      dessert: 'recipes.book.meal_dessert'
    };
    return this.i18n.t(keys[mealType]);
  }

  recipeImageUrl(recipe: Recipe): string | null {
    if (
      typeof recipe.image === 'string' &&
      /^\/api\/recipe-images\/[a-f0-9]{24}$/.test(recipe.image)
    ) {
      return recipe.image;
    }
    return this.safeExternalUrl(recipe.image);
  }

  displayedRecipeCalories(recipe: Recipe): number | null {
    return recipe.calories ?? recipe.nutrition?.calories ?? null;
  }

  scaledIngredientQuantity(recipe: Recipe, quantity: number): number {
    return scaleRecipeQuantity(quantity, recipe.servings || 2, this.recipeServings());
  }

  setRecipeDetailSection(section: RecipeDetailSection): void {
    if (RECIPE_DETAIL_SECTIONS.includes(section)) this.recipeDetailSection.set(section);
  }

  onRecipeDetailTabKeydown(event: KeyboardEvent, index: number): void {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % RECIPE_DETAIL_SECTIONS.length;
    else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + RECIPE_DETAIL_SECTIONS.length) % RECIPE_DETAIL_SECTIONS.length;
    } else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = RECIPE_DETAIL_SECTIONS.length - 1;
    else return;

    event.preventDefault();
    const section = RECIPE_DETAIL_SECTIONS[nextIndex];
    this.setRecipeDetailSection(section);
    this.focusAfterRender(`[data-test="recipe-detail-tab-${section}"]`);
  }

  isRecipeIngredientChecked(index: number): boolean {
    return this.checkedRecipeIngredients().has(index);
  }

  setRecipeIngredientChecked(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.checkedRecipeIngredients());
    if (checked) next.add(index);
    else next.delete(index);
    this.checkedRecipeIngredients.set(next);
  }

  generatedPreviewIngredientQuantity(recipe: AIRecipeResponse, quantity: number): number {
    return scaleRecipeQuantity(quantity, recipe.baseServings, this.generatedPreviewServings());
  }

  setGeneratedPreviewServings(value: number | string): void {
    const servings = Number(value);
    if (Number.isSafeInteger(servings) && servings >= 1) {
      this.generatedPreviewServings.set(servings);
    }
  }

  setRecipeServings(value: number | string): void {
    const servings = Number(value);
    if (Number.isSafeInteger(servings) && servings >= 1) {
      this.recipeServingsTouched.set(true);
      this.recipeServings.set(servings);
    }
  }

  setAiServings(value: number | string): void {
    this.servingsTouched.set(true);
    this.aiOptions.servings = Number(value);
  }

  setAiDetailLevel(value: DetailLevel): void {
    this.detailLevelTouched.set(true);
    this.aiOptions.detailLevel = value;
  }

  validRecipeServings(): boolean {
    const servings = Number(this.aiOptions.servings);
    return Number.isSafeInteger(servings) && servings >= 1;
  }

  attributionUrl(recipe: Recipe): string | null {
    return this.safeExternalUrl(recipe.sourceAttribution?.url);
  }

  aiPreviewModalSize(): ModalSize {
    return this.hasGeneratedRecipePreview() ? 'full' : 'lg';
  }

  hasGeneratedRecipePreview(): boolean {
    return (
      Boolean(this.aiService.generatedRecipe()) || this.aiService.generatedRecipes().length > 0
    );
  }

  generatedPreviewRecipe(): AIRecipeResponse | null {
    const optionIndex = this.selectedGeneratedOptionIndex();
    if (optionIndex !== null) {
      return this.aiService.generatedRecipes()[optionIndex] ?? null;
    }
    return this.aiService.generatedRecipe();
  }

  generatedPreviewDetailLevel(): DetailLevel {
    const optionIndex = this.selectedGeneratedOptionIndex();
    return optionIndex === null
      ? this.singleGeneratedDetailLevel()
      : this.generatedRecipeDetailLevel(optionIndex);
  }

  setGeneratedPreviewDetailLevel(level: DetailLevel): void {
    const optionIndex = this.selectedGeneratedOptionIndex();
    if (optionIndex === null) {
      this.setSingleGeneratedDetailLevel(level);
      return;
    }
    this.setGeneratedRecipeDetailLevel(optionIndex, level);
  }

  viewGeneratedOption(index: number): void {
    if (!this.aiService.generatedRecipes()[index]) return;
    this.selectedGeneratedOptionIndex.set(index);
    this.aiFormExpanded.set(false);
    this.focusAfterRender('.generated-recipe__title', true);
  }

  returnToGeneratedOptions(): void {
    this.selectedGeneratedOptionIndex.set(null);
    this.focusAfterRender('.generated-options__title', true);
  }

  isAiFormVisible(): boolean {
    return !this.hasGeneratedRecipePreview() || this.aiFormExpanded();
  }

  toggleAiFormExpanded(): void {
    this.aiFormExpanded.update((expanded) => !expanded);
  }

  discardGeneratedPreviews(): void {
    this.aiService.clearGenerated();
    this.aiFormExpanded.set(false);
    this.selectedGeneratedOptionIndex.set(null);
    this.focusAfterRender(`[data-test="recipe-ai-step-${this.aiGenerationStep()}"] h3`, true);
  }

  private safeExternalUrl(value?: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }

  openAiModal(): void {
    this.servingsTouched.set(false);
    this.detailLevelTouched.set(false);
    this.recipeContextHouseholdId.set(undefined);
    this.recipeMemberIds.set([]);
    this.recipeGuests.set([]);
    this.isAiModalOpen.set(true);
    this.aiGenerationStep.set(1);
    this.recipeIngredientCategory.set('all');
    this.pantryService.loadCategories();
    this.aiFormExpanded.set(false);
    this.selectedGeneratedOptionIndex.set(null);
    this.aiService.clearGenerated();
  }

  closeAiModal(): void {
    const clearAiFragment = this.isAiModalOpen() && this.route.snapshot.fragment === 'ai';
    this.isAiModalOpen.set(false);
    this.recipeContextHouseholdId.set(undefined);
    this.recipeMemberIds.set([]);
    this.recipeGuests.set([]);
    this.aiFormExpanded.set(false);
    this.aiGenerationStep.set(1);
    this.recipeIngredientCategory.set('all');
    this.selectedGeneratedOptionIndex.set(null);
    this.selectedIngredients.set([]);
    this.aiService.clearGenerated();
    if (clearAiFragment) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        queryParamsHandling: 'merge',
        fragment: undefined,
        replaceUrl: true
      });
    }
  }

  viewRecipe(recipe: Recipe): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { recipe: recipe.id },
      queryParamsHandling: 'merge'
    });
  }

  canEditRecipe(recipe: Recipe): boolean {
    return (
      recipe.author !== 'catalog' &&
      Boolean(this.authService.userId()) &&
      recipe.authorId === this.authService.userId()
    );
  }

  editRecipe(recipe: Recipe): void {
    if (!this.canEditRecipe(recipe)) return;
    void this.router.navigate(['/recipes', recipe.id, 'edit']);
  }

  private showRecipe(recipe: Recipe): void {
    this.isCookingMode.set(false);
    this.hasCookingSession.set(false);
    this.selectedRecipe.set(recipe);
    this.recipeDetailSection.set('preparation');
    this.checkedRecipeIngredients.set(new Set<number>());
    this.recipeServingsTouched.set(false);
    this.resetRecipeServings();
    this.selectedRecipeDetailLevel.set(
      recipeDetailLevelFor(
        this.recipeDetailPreferences(),
        recipe.id,
        detailLevelForCookingLevel(this.tasteProfileService.profile().cookingLevel)
      )
    );
    this.focusAfterRender('[data-test="recipe-detail-title"]');
  }

  private resetRecipeServings(): void {
    this.recipeServings.set(this.householdService.defaultServings());
  }

  private focusAfterRender(selector: string, resetAiModalScroll = false): void {
    afterNextRender(
      () => {
        if (resetAiModalScroll) this.aiGenerationModal?.resetBodyScroll();
        const target = Array.from(this.document.querySelectorAll<HTMLElement>(selector)).find(
          (element) =>
            element.getClientRects().length > 0 &&
            this.document.defaultView?.getComputedStyle(element).visibility !== 'hidden'
        );
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
  }

  getRecipeSteps(recipe: Recipe, level: DetailLevel) {
    return recipeInstructionsForLevel(recipe, level);
  }

  getGeneratedRecipeSteps(recipe: AIRecipeResponse, level: DetailLevel) {
    return recipeInstructionsForLevel(recipe, level);
  }

  generatedRecipeDetailLevel(index: number): DetailLevel {
    return this.generatedRecipeLevels()[index] ?? (this.aiOptions.detailLevel as DetailLevel);
  }

  setGeneratedRecipeDetailLevel(index: number, level: DetailLevel): void {
    this.generatedRecipeLevels.update((levels) => ({ ...levels, [index]: level }));
  }

  setSingleGeneratedDetailLevel(level: DetailLevel): void {
    this.singleGeneratedDetailLevel.set(level);
    this.selectedRecipeDetailLevel.set(level);
  }

  setSelectedRecipeDetailLevel(level: DetailLevel): void {
    this.selectedRecipeDetailLevel.set(level);
    const recipe = this.selectedRecipe();
    if (recipe) {
      this.recipeDetailPreferences.update((preferences) =>
        rememberRecipeDetailLevel(preferences, recipe.id, level)
      );
    }
  }

  closeRecipeDetail(): void {
    const clearRecipeQuery = this.route.snapshot.queryParamMap.has('recipe');
    this.isCookingMode.set(false);
    this.hasCookingSession.set(false);
    this.selectedRecipe.set(null);
    this.focusAfterRender('[data-test="recipe-list-heading"]');
    if (clearRecipeQuery) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { recipe: null },
        queryParamsHandling: 'merge',
        preserveFragment: true,
        replaceUrl: true
      });
    }
  }

  enterCookingMode(): void {
    const recipe = this.selectedRecipe();
    if (!recipe || this.getRecipeSteps(recipe, this.selectedRecipeDetailLevel()).length === 0)
      return;
    this.hasCookingSession.set(true);
    this.isCookingMode.set(true);
    this.focusAfterRender('[data-test="recipe-cooking-title"]');
  }

  exitCookingMode(): void {
    this.isCookingMode.set(false);
    this.focusAfterRender(
      '[data-test="recipe-cooking-open"] button, [data-test="recipe-cooking-open-sidebar"] button'
    );
  }

  toggleIngredientSelection(ingredient: any): void {
    this.selectedIngredients.update((list) => {
      const exists = list.find((i) => i.id === ingredient.id);
      if (exists) {
        return list.filter((i) => i.id !== ingredient.id);
      }
      return [...list, ingredient];
    });
  }

  readonly recipeIngredientCategoryOptions = computed(() => {
    const keys = [
      ...new Set(this.pantryService.ingredients().map((ingredient) => ingredient.category))
    ];
    return keys
      .map((key) => ({
        key,
        label:
          this.pantryService.categoryByKey(key)?.name ??
          key.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
      }))
      .sort((left, right) => {
        const leftPosition =
          this.pantryService.categoryByKey(left.key)?.position ?? Number.MAX_SAFE_INTEGER;
        const rightPosition =
          this.pantryService.categoryByKey(right.key)?.position ?? Number.MAX_SAFE_INTEGER;
        return leftPosition - rightPosition || left.label.localeCompare(right.label);
      });
  });

  trackRecipeIngredientCategory(_index: number, category: { key: string }): string {
    return category.key;
  }

  visibleRecipeIngredients(): any[] {
    return filterRecipeIngredientsByCategory(
      this.pantryService.ingredients(),
      this.recipeIngredientCategory()
    );
  }

  setRecipeIngredientCategory(category: string): void {
    this.recipeIngredientCategory.set(category);
  }

  selectAllRecipeIngredients(): void {
    this.selectedIngredients.update((selected) =>
      mergeAllRecipeIngredients(selected, this.pantryService.ingredients())
    );
  }

  clearRecipeIngredients(): void {
    this.selectedIngredients.set([]);
  }

  setRecipeAiStep(step: number): void {
    const nextStep = Math.min(3, Math.max(1, Math.floor(step)));
    if (nextStep === this.aiGenerationStep()) return;
    this.aiGenerationStep.set(nextStep);
    this.focusAfterRender(`[data-test="recipe-ai-step-${nextStep}"] h3`);
  }

  removeIngredient(ingredient: any): void {
    this.selectedIngredients.update((list) => list.filter((i) => i.id !== ingredient.id));
  }

  isIngredientSelected(id: string): boolean {
    return this.selectedIngredients().some((i) => i.id === id);
  }

  generateSingle(): void {
    if (!this.validRecipeServings()) {
      this.showRecipeGenerationError('recipes.servings_range_error');
      return;
    }
    this.selectedGeneratedOptionIndex.set(null);
    this.singleGeneratedDetailLevel.set(this.aiOptions.detailLevel as DetailLevel);
    const requestedServings = Number(this.aiOptions.servings);
    const request = {
      ingredients: this.selectedIngredients().map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit
      })),
      utensils: [],
      servings: requestedServings,
      householdMemberIds: this.recipeMemberIds(),
      guests: this.recipeGuests(),
      difficulty: this.aiOptions.difficulty as AIRecipeRequest['difficulty'],
      detailLevel: this.aiOptions.detailLevel as any,
      dietaryRestrictions: [],
      allergies: [],
      preferences: []
    };

    this.aiService.generateRecipe(request).subscribe({
      next: (recipe) => {
        if (!recipe) {
          this.showRecipeGenerationError('recipes.no_se_pudo_generar');
          return;
        }
        this.generatedPreviewServings.set(requestedServings);
        this.aiFormExpanded.set(false);
        this.singleGeneratedDetailLevel.set(
          recipe.selectedDetailLevel ?? (this.aiOptions.detailLevel as DetailLevel)
        );
        this.toastService.success(
          this.i18n.t('recipes.receta_generada'),
          this.i18n.t('recipes.la_ia_ha_creado')
        );
        this.focusAfterRender('.generated-recipe__title', true);
      },
      error: () => this.showRecipeGenerationError('recipes.no_se_pudo_generar')
    });
  }

  generateMultiple(): void {
    if (!this.validRecipeServings()) {
      this.showRecipeGenerationError('recipes.servings_range_error');
      return;
    }
    this.selectedGeneratedOptionIndex.set(null);
    this.generatedRecipeLevels.set({});
    const requestedServings = Number(this.aiOptions.servings);
    const request = {
      ingredients: this.selectedIngredients().map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit
      })),
      utensils: [],
      servings: requestedServings,
      householdMemberIds: this.recipeMemberIds(),
      guests: this.recipeGuests(),
      difficulty: this.aiOptions.difficulty as AIRecipeRequest['difficulty'],
      detailLevel: this.aiOptions.detailLevel as any,
      dietaryRestrictions: [],
      allergies: [],
      preferences: [],
      count: 3
    };

    this.aiService.generateMultipleRecipes(request).subscribe({
      next: (recipes) => {
        if (!recipes?.length) {
          this.showRecipeGenerationError('recipes.no_se_pudieron_generar');
          return;
        }
        this.generatedPreviewServings.set(requestedServings);
        this.aiFormExpanded.set(false);
        const initialLevel = this.aiOptions.detailLevel as DetailLevel;
        this.generatedRecipeLevels.set(
          recipes.reduce<Record<number, DetailLevel>>((levels, recipe, index) => {
            levels[index] = recipe.selectedDetailLevel ?? initialLevel;
            return levels;
          }, {})
        );
        this.toastService.success(
          this.i18n.t('recipes.recetas_generadas'),
          this.i18n.t('recipes.selecciona_tu_favorita')
        );
        this.focusAfterRender('.generated-options__title', true);
      },
      error: () => this.showRecipeGenerationError('recipes.no_se_pudieron_generar')
    });
  }

  private showRecipeGenerationError(messageKey: TranslationKey): void {
    this.toastService.error(this.i18n.t('ui.error'), this.i18n.t(messageKey));
  }

  saveGeneratedRecipe(recipe: AIRecipeResponse, selectedLevel?: DetailLevel): void {
    this.singleGeneratedDetailLevel.set(
      selectedLevel ?? recipe.selectedDetailLevel ?? (this.aiOptions.detailLevel as DetailLevel)
    );
    const convertSteps = (steps: NonNullable<AIRecipeResponse['instructionsByLevel']>['basic']) =>
      steps.map((step) => ({
        stepNumber: step.stepNumber,
        instruction: step.instruction,
        duration: step.duration,
        temperature: step.temperature,
        timerRequired: step.timerRequired,
        timerDuration: step.timerDuration,
        tips: step.tips,
        warning: step.warning,
        illustration: step.illustration ?? null
      }));
    const instructionsByLevel = {
      basic: convertSteps(recipe.instructionsByLevel.basic),
      intermediate: convertSteps(recipe.instructionsByLevel.intermediate),
      expert: convertSteps(recipe.instructionsByLevel.expert)
    };

    this.recipeService
      .createRecipe({
        name: recipe.name,
        author: 'ai',
        description: recipe.description,
        difficulty: recipe.difficulty as Difficulty,
        cuisine: recipe.cuisine,
        totalTime: recipe.totalTime,
        prepTime: recipe.prepTime,
        cookTime: recipe.cookTime,
        restTime: recipe.restTime,
        servings: recipe.baseServings,
        calories: recipe.calories,
        ingredients: recipe.ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit as any,
          preparation: i.preparation,
          isOptional: i.isOptional ?? false,
          substitutes: i.substitutes ?? [],
          notes: i.notes
        })),
        utensils: recipe.utensils,
        guidance: recipe.guidance,
        instructionsByLevel,
        nutrition: recipe.nutrition
          ? {
              calories: recipe.nutrition.calories,
              protein: recipe.nutrition.protein,
              carbs: recipe.nutrition.carbs,
              fat: recipe.nutrition.fat,
              fiber: recipe.nutrition.fiber
            }
          : undefined,
        storage: recipe.storage
          ? {
              method: recipe.storage.method,
              container: recipe.storage.container,
              duration: recipe.storage.duration,
              reheatingInstructions: recipe.storage.reheatingInstructions,
              freezingPossible: recipe.storage.freezingPossible,
              freezingDuration: recipe.storage.freezingDuration
            }
          : undefined,
        tags: recipe.tags ?? []
      })
      .subscribe({
        next: () => {
          this.toastService.success(
            this.i18n.t('recipes.guardada'),
            this.i18n.t('recipes.la_receta_se_ha')
          );
          this.closeAiModal();
        },
        error: () => {
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('recipes.no_se_pudo_guardar')
          );
        }
      });
  }

  toggleFavorite(recipe: Recipe): void {
    this.recipeService.toggleFavorite(recipe.id);
  }

  cookRecipe(recipe: Recipe): void {
    if (this.cookingRecipeId() === recipe.id) return;
    this.cookingRecipeId.set(recipe.id);
    this.recipeService
      .recordCooking(recipe.id)
      .pipe(finalize(() => this.cookingRecipeId.set(null)))
      .subscribe({
        next: (recorded) => {
          if (!recorded) {
            this.toastService.error(
              this.i18n.t('ui.error'),
              this.i18n.t('recipes.no_se_pudo_registrar_cocina')
            );
            return;
          }
          this.toastService.success(
            this.i18n.t('recipes.a_cocinar'),
            this.i18n.t('recipes.disfruta_preparando_tu_receta')
          );
          if (this.selectedRecipe()?.id === recipe.id) this.closeRecipeDetail();
        },
        error: () => {
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('recipes.no_se_pudo_registrar_cocina')
          );
        }
      });
  }

  getCategoryIcon(category: string): string {
    return recipeCategoryEmoji(category);
  }

  getDifficultyVariant(difficulty: string): 'success' | 'warning' | 'error' {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return 'success';
      case 'medium':
        return 'warning';
      case 'hard':
        return 'error';
      default:
        return 'warning';
    }
  }

  getDifficultyLabel(difficulty: string): string {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return this.i18n.t('recipes.facil');
      case 'medium':
        return this.i18n.t('recipes.medio');
      case 'hard':
        return this.i18n.t('recipes.dificil');
      default:
        return difficulty;
    }
  }

  detailLevelLabel(level: DetailLevel): TranslationKey {
    return recipeDetailLevelLabelKey(level);
  }

  trackById(_index: number, item: Recipe): string {
    return item.id;
  }
}
