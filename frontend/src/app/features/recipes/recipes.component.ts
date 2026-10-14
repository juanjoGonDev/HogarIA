import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  OnInit,
  signal
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
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { TimerComponent } from '../../shared/components/ui/timer/timer.component';
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
import { RecipeCookingViewComponent } from './recipe-cooking-view.component';
import { AiParticipantsComponent } from '../../shared/components/ai-participants.component';
import {
  detailLevelForCookingLevel,
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
    LoadingComponent,
    TimerComponent,
    PickerComponent,
    CatalogLabelPipe,
    IconComponent,
    RecipeStepPhotoComponent,
    RecipeCookingViewComponent,
    AiParticipantsComponent
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

        <div *ngIf="collection() === 'book'" class="recipes__book-controls">
          <form
            class="recipe-book-search"
            role="search"
            (submit)="$event.preventDefault(); applyBookSearch()"
          >
            <label class="recipe-book-search__label" for="recipe-book-search">{{
              'recipes.search.label' | t
            }}</label>
            <div class="recipe-book-search__field">
              <app-icon name="search" [size]="18" [label]="null" />
              <input
                id="recipe-book-search"
                data-test="recipe-book-search"
                type="search"
                name="recipeBookSearch"
                [ngModel]="searchInput()"
                (ngModelChange)="searchInput.set($event)"
                [placeholder]="'recipes.search.placeholder' | t"
                autocomplete="off"
              />
            </div>
          </form>
          <app-button *ngIf="hasActiveFilters()" variant="ghost" (onClick)="clearFilters()">
            {{ 'recipes.book.clear' | t }}
          </app-button>
        </div>

        <!-- Quick Filters -->
        <div class="recipes__quick-filters">
          <app-filter-tag
            *ngFor="let filter of quickFilters"
            [selected]="activeFilter() === filter.value"
            (onClick)="setFilter(filter.value)"
          >
            <app-icon [name]="filter.icon" [size]="16" [label]="null" />
            {{ filter.labelKey | t }}
          </app-filter-tag>
        </div>

        <!-- Loading -->
        <app-loading
          *ngIf="recipeService.isLoading()"
          [message]="'recipes.loading' | t"
        ></app-loading>

        <div
          *ngIf="recipeService.recipesLoadError()"
          class="recipes__load-error"
          data-test="recipes-load-error"
          role="alert"
          aria-atomic="true"
        >
          <span>{{ 'recipes.list_load_error' | t }}</span>
          <app-button
            variant="outline"
            size="sm"
            type="button"
            data-test="recipes-retry-load"
            (onClick)="recipeService.retryLoadRecipes()"
          >
            {{ 'recipes.retry_list_load' | t }}
          </app-button>
        </div>

        <!-- Recipes Grid -->
        <div class="recipes__grid" *ngIf="!recipeService.isLoading()">
          <article
            *ngFor="let recipe of recipeService.recipes(); trackBy: trackById"
            class="recipe-card"
            data-test="recipe-card"
          >
            <button type="button" class="recipe-card__open" (click)="viewRecipe(recipe)">
              <div class="recipe-card__image">
                <img
                  *ngIf="recipeImageUrl(recipe) as imageUrl; else noRecipeImage"
                  [src]="imageUrl"
                  [alt]="'recipes.book.cover_alt' | t: { name: recipe.name }"
                  loading="lazy"
                />
                <ng-template #noRecipeImage>
                  <span
                    class="recipe-card__cover-fallback recipe-card__placeholder"
                    aria-hidden="true"
                  >
                    <app-icon name="kitchen" [size]="48" [label]="null" />
                  </span>
                </ng-template>
              </div>

              <div class="recipe-card__content">
                <h3 class="recipe-card__name">{{ recipe.name }}</h3>
                <p class="recipe-card__description">{{ recipe.description }}</p>
                <div *ngIf="collection() === 'book'" class="recipe-card__origin">
                  <span *ngIf="recipe.countryCode">{{ countryLabel(recipe.countryCode) }}</span>
                  <span *ngFor="let type of recipe.mealType">{{ mealTypeLabel(type) }}</span>
                </div>

                <div class="recipe-card__meta">
                  <span class="recipe-card__time">{{
                    'recipes.min' | t: { n: recipe.totalTime }
                  }}</span>
                  <app-badge [variant]="getDifficultyVariant(recipe.difficulty)" size="sm">
                    {{ recipe.difficulty }}
                  </app-badge>
                  <span
                    class="recipe-card__servings"
                    [attr.aria-label]="'recipes.porciones_n' | t: { n: recipe.servings }"
                  >
                    <app-icon name="group" [size]="16" [label]="null" />
                    <span aria-hidden="true">{{ recipe.servings }}</span>
                  </span>
                </div>
              </div>
            </button>
            <button
              type="button"
              class="recipe-card__favorite"
              [class.recipe-card__favorite--active]="recipe.isFavorite"
              [attr.aria-label]="
                (recipe.isFavorite ? 'recipes.favorito' : 'recipes.anadir_a_favoritos') | t
              "
              [attr.aria-pressed]="recipe.isFavorite"
              (click)="toggleFavorite(recipe)"
            >
              <app-icon name="favorite" [size]="20" [label]="null" />
            </button>
          </article>

          <!-- Empty State -->
          <div
            *ngIf="recipeService.recipes().length === 0 && !recipeService.recipesLoadError()"
            class="empty-state"
          >
            <span class="empty-state__icon"
              ><app-icon name="menu_book" [size]="64" [label]="null"
            /></span>
            <h3 class="empty-state__title">
              {{ collection() === 'book' ? ('recipes.book.no_results' | t) : ('recipes.none' | t) }}
            </h3>
            <p class="empty-state__text">
              {{
                collection() === 'book'
                  ? ('recipes.book.no_results_desc' | t)
                  : ('recipes.none.desc' | t)
              }}
            </p>
            <app-button *ngIf="collection() !== 'book'" variant="primary" (onClick)="openAiModal()">
              {{ 'recipes.generar_con_ia' | t }}
            </app-button>
            <app-button
              *ngIf="collection() === 'book'"
              variant="outline"
              (onClick)="clearFilters()"
            >
              {{ 'recipes.book.clear' | t }}
            </app-button>
          </div>
        </div>

        <nav
          *ngIf="collection() === 'book' && pageCount() > 1"
          class="recipe-book-pagination"
          [attr.aria-label]="'recipes.collection.book' | t"
        >
          <app-button variant="outline" [disabled]="page() <= 1" (onClick)="changePage(page() - 1)">
            {{ 'recipes.book.previous_page' | t }}
          </app-button>
          <span aria-live="polite">{{
            'recipes.book.page' | t: { current: page(), total: pageCount() }
          }}</span>
          <app-button
            variant="outline"
            [disabled]="page() >= pageCount()"
            (onClick)="changePage(page() + 1)"
          >
            {{ 'recipes.book.next_page' | t }}
          </app-button>
        </nav>

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
                    <option value="basic">{{ 'recipes.basico' | t }}</option>
                    <option value="intermediate">{{ 'auth.intermediate' | t }}</option>
                    <option value="expert">{{ 'auth.expert' | t }}</option>
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
              <h3 class="generated-recipe__title">{{ recipe.name }}</h3>
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
                  <option value="basic">{{ 'recipes.basico' | t }}</option>
                  <option value="intermediate">{{ 'auth.intermediate' | t }}</option>
                  <option value="expert">{{ 'auth.expert' | t }}</option>
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
            <h3 class="generated-options__title">{{ 'recipes.elige_una_para_guardar' | t }}</h3>
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
                    <option value="basic">{{ 'recipes.basico' | t }}</option>
                    <option value="intermediate">{{ 'auth.intermediate' | t }}</option>
                    <option value="expert">{{ 'auth.expert' | t }}</option>
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
      <section
        *ngIf="selectedRecipe() as recipe"
        class="recipe-detail-page"
        [class.recipe-detail-page--cooking]="isCookingMode()"
        data-test="recipe-detail-page"
        aria-labelledby="recipe-detail-title"
      >
        <header class="recipe-detail-page__header">
          <app-button variant="ghost" (onClick)="closeRecipeDetail()">
            <app-icon name="chevron_left" [size]="18" [label]="null" />
            {{ 'recipes.return_to_list' | t }}
          </app-button>
          <h1
            *ngIf="!isCookingMode()"
            id="recipe-detail-title"
            data-test="recipe-detail-title"
            tabindex="-1"
          >
            {{ recipe.name }}
          </h1>
          <app-button
            *ngIf="!isCookingMode() && getRecipeSteps(recipe, selectedRecipeDetailLevel()).length"
            variant="primary"
            data-test="recipe-cooking-open"
            (onClick)="enterCookingMode()"
          >
            <app-icon name="kitchen" [size]="16" [label]="null" />
            {{ 'recipes.cooking.mode_open' | t }}
          </app-button>
          <app-button
            *ngIf="canEditRecipe(recipe)"
            variant="outline"
            data-test="recipe-edit-action"
            (onClick)="editRecipe(recipe)"
          >
            <app-icon name="edit" [size]="16" [label]="null" />
            {{ 'recipes.edit_recipe' | t }}
          </app-button>
        </header>
        <article class="recipe-detail" data-test="recipe-full-detail">
          <app-recipe-cooking-view
            *ngIf="isCookingMode()"
            [recipe]="recipe"
            [steps]="getRecipeSteps(recipe, selectedRecipeDetailLevel())"
            [servings]="recipeServings()"
            (servingsChange)="setRecipeServings($event)"
            (exit)="exitCookingMode()"
          />
          <header *ngIf="!isCookingMode()" class="recipe-detail__hero">
            <div class="recipe-detail__cover">
              <img
                *ngIf="recipeImageUrl(recipe) as imageUrl; else detailNoRecipeImage"
                [src]="imageUrl"
                [alt]="
                  recipe.imageAttribution?.altText ||
                  ('recipes.book.cover_alt' | t: { name: recipe.name })
                "
              />
              <ng-template #detailNoRecipeImage>
                <span
                  class="recipe-card__cover-fallback recipe-card__placeholder"
                  aria-hidden="true"
                >
                  <app-icon name="kitchen" [size]="40" [label]="null" />
                </span>
              </ng-template>
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
                <span *ngIf="recipe.countryCode">{{ countryLabel(recipe.countryCode) }}</span>
                <span *ngIf="recipe.cuisine">{{ recipe.cuisine }}</span>
                <app-badge [variant]="getDifficultyVariant(recipe.difficulty)">
                  {{ recipe.difficulty }}
                </app-badge>
              </div>
              <p class="recipe-detail__description">{{ recipe.description }}</p>
              <div class="recipe-detail__timings" [attr.aria-label]="'recipes.total_time' | t">
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
                <span *ngIf="recipe.calories || recipe.nutrition?.calories"
                  ><strong>{{ 'recipes.nutrition' | t }}</strong>
                  {{
                    'recipes.kcal_per_serving'
                      | t: { n: recipe.calories || recipe.nutrition?.calories }
                  }}</span
                >
              </div>
              <div class="recipe-detail__servings">
                <label for="saved-recipe-servings">{{ 'recipes.servings_scaled_label' | t }}</label>
                <input
                  id="saved-recipe-servings"
                  class="form-input"
                  type="number"
                  min="1"
                  [ngModel]="recipeServings()"
                  (ngModelChange)="setRecipeServings($event)"
                  data-test="recipe-serving-count"
                />
                <span class="recipe-detail__hint">{{ 'recipes.scaled_only' | t }}</span>
              </div>
            </div>
          </header>

          <section
            *ngIf="!isCookingMode() && recipe.guidance?.batchCookingWarning"
            class="recipe-detail__section recipe-detail__panel"
            data-test="recipe-batch-warning"
            role="note"
          >
            <h3>{{ 'recipes.batch_cooking_warning_heading' | t }}</h3>
            <p>{{ recipe.guidance?.batchCookingWarning }}</p>
          </section>

          <section
            *ngIf="!isCookingMode() && recipe.nutrition"
            class="recipe-detail__section recipe-detail__panel"
            data-test="recipe-nutrition"
          >
            <h3>{{ 'recipes.nutrition' | t }}</h3>
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
              <div *ngIf="recipe.nutrition?.sugar !== undefined">
                <dt>{{ 'recipes.sugar' | t }}</dt>
                <dd>{{ recipe.nutrition?.sugar }} g</dd>
              </div>
              <div *ngIf="recipe.nutrition?.sodium !== undefined">
                <dt>{{ 'recipes.sodium' | t }}</dt>
                <dd>{{ recipe.nutrition?.sodium }} mg</dd>
              </div>
            </dl>
          </section>

          <div *ngIf="!isCookingMode()" class="recipe-detail__body">
            <aside class="recipe-detail__sidebar" [attr.aria-label]="'dashboard.ingredients' | t">
              <section
                class="recipe-detail__section recipe-detail__panel"
                data-test="recipe-ingredients"
              >
                <h3>{{ 'dashboard.ingredients' | t }}</h3>
                <ul class="recipe-detail__ingredients">
                  <li *ngFor="let ing of recipe.ingredients">
                    <span class="recipe-detail__ingredient-line">
                      <strong
                        >{{ scaledIngredientQuantity(recipe, ing.quantity) | number: '1.0-2' }}
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
                  </li>
                </ul>
              </section>

              <section
                *ngIf="recipe.guidance?.appliances?.length || recipe.utensils.length"
                class="recipe-detail__section recipe-detail__panel"
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
            </aside>

            <div class="recipe-detail__main">
              <section class="recipe-detail__section" data-test="recipe-preparation">
                <div class="recipe-detail__section-header">
                  <h3>{{ 'recipes.preparacion' | t }}</h3>
                  <div *ngIf="recipe.instructionsByLevel" class="recipe-detail__detail-level">
                    <label for="saved-recipe-detail-level">{{ 'recipes.detalle' | t }}</label>
                    <select
                      id="saved-recipe-detail-level"
                      class="form-select"
                      [ngModel]="selectedRecipeDetailLevel()"
                      (ngModelChange)="setSelectedRecipeDetailLevel($event)"
                      data-test="recipe-detail-level"
                    >
                      <option value="basic">{{ 'recipes.basico' | t }}</option>
                      <option value="intermediate">{{ 'auth.intermediate' | t }}</option>
                      <option value="expert">{{ 'auth.expert' | t }}</option>
                    </select>
                  </div>
                </div>
                <div class="recipe-detail__steps">
                  <article
                    *ngFor="let step of getRecipeSteps(recipe, selectedRecipeDetailLevel())"
                    class="step-card"
                    [attr.data-step-number]="step.stepNumber"
                  >
                    <div class="step-card__header">
                      <span class="step-card__number">{{
                        'recipes.paso_n' | t: { n: step.stepNumber }
                      }}</span>
                      <span *ngIf="step.duration" class="step-card__time">{{
                        'recipes.min' | t: { n: step.duration }
                      }}</span>
                    </div>
                    <app-recipe-step-photo
                      [instruction]="step.instruction"
                      [image]="step.image"
                      [imageAttribution]="step.imageAttribution"
                    />
                    <p class="step-card__instruction">{{ step.instruction }}</p>
                    <app-timer
                      *ngIf="step.timerRequired && step.timerDuration"
                      [duration]="step.timerDuration * 60"
                      [label]="'recipes.timer_paso' | t: { n: step.stepNumber }"
                    ></app-timer>
                    <div *ngIf="step.tips" class="step-card__tip">
                      <app-icon name="help_outline" [size]="16" [label]="null" /> {{ step.tips }}
                    </div>
                    <div *ngIf="step.warning" class="step-card__warning">
                      <app-icon name="error_outline" [size]="16" [label]="null" />
                      {{ step.warning }}
                    </div>
                  </article>
                </div>
              </section>

              <section
                *ngIf="recipe.guidance?.parallelTasks?.length"
                class="recipe-detail__section recipe-detail__panel"
                data-test="recipe-parallel-tasks"
              >
                <h3>{{ 'recipes.parallel_tasks' | t }}</h3>
                <ul class="recipe-detail__plain-list">
                  <li *ngFor="let task of recipe.guidance?.parallelTasks">{{ task }}</li>
                </ul>
              </section>

              <section
                *ngIf="recipe.guidance?.tipsAndVariations?.length"
                class="recipe-detail__section recipe-detail__panel"
                data-test="recipe-tips-variations"
              >
                <h3>{{ 'recipes.tips_variations' | t }}</h3>
                <ul class="recipe-detail__plain-list">
                  <li *ngFor="let tip of recipe.guidance?.tipsAndVariations">{{ tip }}</li>
                </ul>
              </section>

              <section
                *ngIf="recipe.storage"
                class="recipe-detail__section recipe-detail__panel"
                data-test="recipe-storage"
              >
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
                <p *ngIf="!recipe.storage.freezingPossible">{{ 'recipes.no_freezing' | t }}</p>
                <p *ngIf="recipe.storage.reheatingInstructions">
                  {{ 'recipes.recalentar' | t: { text: recipe.storage.reheatingInstructions } }}
                </p>
              </section>
            </div>
          </div>

          <section
            *ngIf="!isCookingMode() && recipe.sourceAttribution as source"
            class="recipe-detail__source"
          >
            <h3>{{ 'recipes.book.source' | t }}</h3>
            <strong>{{ source.publisher }}</strong>
            <p *ngIf="source.title">{{ source.title }}</p>
            <p *ngIf="source.note">{{ source.note }}</p>
            <a
              *ngIf="attributionUrl(recipe) as sourceUrl"
              [href]="sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ 'recipes.book.open_source' | t }}</a
            >
          </section>

          <footer *ngIf="!isCookingMode()" class="recipe-detail__actions">
            <app-button
              variant="primary"
              [disabled]="cookingRecipeId() === recipe.id"
              (onClick)="cookRecipe(recipe)"
              >{{ 'recipes.cocinar_ahora' | t }}</app-button
            >
            <app-button variant="outline" (onClick)="toggleFavorite(recipe)">{{
              recipe.isFavorite ? ('recipes.favorito' | t) : ('recipes.anadir_a_favoritos' | t)
            }}</app-button>
          </footer>
        </article>
      </section>
    </div>
  `,
  styles: [
    `
      /*
     * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
     *
     * Todo lo que se pulsa avisa antes de que se pulse. Va aqui arriba, junto, en lugar de repartido por
     * las reglas de cada control: asi la proxima clase que se anada se compara con esta lista, y el
     * check-ui (regla boton-sin-afecto) no deja a nadie poner un boton sin su hover. Van sin :hover los
     * deshabilitados —un boton apagado que se ilumina es la manera mas rapida de ensenar a desconfiar.
     */
      /* El corazon de la tarjeta esta encima de una tarjeta que ya es un enlace: su hover tiene que marcar
       el icono, no la tarjeta, y por eso se pinta el circulo en lugar de cambiar el color del trazo. */
      .recipe-card__favorite:hover {
        background: var(--error-subtle);
        transform: scale(1.1);
      }

      .recipes {
        width: 100%;
        min-width: 0;
        padding-block: var(--container-padding);
      }

      .recipe-detail-page {
        width: 100%;
        min-width: 0;
      }

      .recipe-detail-page__header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        width: 100%;
        max-width: 1440px;
        min-width: 0;
        margin: 0 auto var(--space-4);

        h1 {
          min-width: 0;
          margin: 0;
          font-size: var(--text-2xl);
          font-weight: var(--font-semibold);
          overflow-wrap: anywhere;
        }
      }

      .recipe-detail-page__header h1:focus {
        outline: none;
      }

      .recipe-detail-page--cooking .recipe-detail-page__header {
        min-height: 0;
        margin-bottom: 0;
      }

      .recipe-detail-page--cooking .recipe-detail-page__header > app-button {
        display: none;
      }

      .recipes__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
        gap: var(--space-3);
      }

      .recipes__title-section {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
      }

      .recipes__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      .recipes__count {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .recipes__actions {
        display: flex;
        gap: var(--space-2);
      }

      .recipes__quick-filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-bottom: var(--space-6);
      }

      .recipes__collection-tab:hover:not(.is-active) {
        color: var(--primary-dark);
      }

      .recipes__collection-tab:focus-visible,
      .recipe-card__open:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }

      .recipe-card__open:hover .recipe-card__name {
        color: var(--primary-dark);
      }

      .recipes__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--space-4);
      }

      .recipes__load-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--error-subtle);
        color: var(--color-error-700);
      }

      /* Recipe Card */
      .recipe-card {
        position: relative;
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-default);
        overflow: hidden;
        cursor: pointer;
        transition: border-color var(--duration-150) var(--ease-out);

        &:hover {
          border-color: var(--border-strong);
        }
      }

      .recipe-card__image {
        position: relative;
        aspect-ratio: 16/10;
        background: var(--bg-tertiary);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .recipe-card__favorite {
        position: absolute;
        top: var(--space-2);
        right: var(--space-2);
        width: 44px;
        height: 44px;
        border-radius: var(--radius-full);
        background: rgba(255, 255, 255, 0.9);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .recipe-card__content {
        padding: var(--space-4);
      }

      .recipe-card__name {
        font-family: var(--font-display);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        margin-bottom: var(--space-1);
      }

      .recipe-card__description {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        margin-bottom: var(--space-3);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .recipe-card__meta {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .recipe-card__servings {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }

      /* AI Form */
      .ai-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }

      .ai-form__description {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .ai-form__section {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .ai-form__step {
        display: grid;
        min-width: 0;
        gap: var(--space-4);
      }

      .ai-form__step h3 {
        margin: 0;
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
      }

      .ai-form__section-heading,
      .ai-form__bulk-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
      }

      .ai-form__bulk-actions {
        justify-content: flex-end;
      }

      .recipe-ai-wizard__steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--space-2);
        margin: 0;
        padding: 0 0 var(--space-3);
        border-bottom: 1px solid var(--border-default);
        list-style: none;
      }

      .recipe-ai-wizard__steps li {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .recipe-ai-wizard__step-number {
        display: inline-flex;
        flex: 0 0 24px;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
      }

      .recipe-ai-wizard__step--active {
        color: var(--text-primary);
        font-weight: var(--font-semibold);
      }

      .recipe-ai-wizard__step--active .recipe-ai-wizard__step-number,
      .recipe-ai-wizard__step--complete .recipe-ai-wizard__step-number {
        border-color: var(--primary);
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      .recipe-ai-wizard__count {
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .recipe-ai-wizard__text-action {
        min-height: 36px;
        padding: 4px 8px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        font: inherit;
        font-size: var(--text-xs);
      }

      .recipe-ai-wizard__text-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .recipe-ai-wizard__categories {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }

      .recipe-ai-wizard__category,
      .recipe-ai-wizard__ingredient {
        display: inline-flex;
        min-height: 36px;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        font: inherit;
        font-size: var(--text-sm);
      }

      .recipe-ai-wizard__category[aria-pressed='true'],
      .recipe-ai-wizard__ingredient--selected {
        border-color: var(--primary);
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      .recipe-ai-wizard__ingredient {
        max-width: 100%;
        text-align: left;
      }

      .recipe-ai-wizard__validation {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .recipe-ai-wizard__actions {
        align-items: center;
      }

      .recipe-ai-wizard__spacer {
        flex: 1 1 auto;
      }

      .ai-form__label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .ai-form__ingredients,
      .ai-form__pantry {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        padding: var(--space-3);
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
        min-height: 60px;
      }

      .ai-form__pantry {
        align-content: start;
        max-height: 240px;
        overflow: auto;
        overscroll-behavior: contain;
      }

      .ai-form__hint {
        font-size: var(--text-sm);
        color: var(--text-tertiary);
      }

      .ai-form__row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-4);
      }

      .ai-form__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }

      .ai-form__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
      }

      :where(
        .recipe-ai-wizard__text-action,
        .recipe-ai-wizard__category,
        .recipe-ai-wizard__ingredient
      ):focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      /* Generated Recipe */
      .generated-recipe {
        margin-top: var(--space-6);
        padding-top: var(--space-6);
        border-top: 1px solid var(--border-default);
      }

      .generated-recipe__header {
        margin-bottom: var(--space-4);
      }

      .generated-recipe__title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        margin-bottom: var(--space-2);
      }

      .generated-recipe__meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }

      .generated-recipe__description {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-6);
      }

      .generated-recipe__section {
        margin-bottom: var(--space-6);

        h4 {
          font-size: var(--text-base);
          font-weight: var(--font-semibold);
          margin-bottom: var(--space-3);
        }
      }

      .generated-recipe__list {
        list-style: none;
        padding: 0;

        li {
          padding: var(--space-2) 0;
          border-bottom: 1px solid var(--border-default);
          font-size: var(--text-sm);
        }
      }

      .generated-recipe__prep {
        color: var(--text-tertiary);
        font-style: italic;
      }

      .generated-recipe__steps {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .step {
        display: flex;
        gap: var(--space-3);
      }

      .step__number {
        width: 28px;
        height: 28px;
        background: var(--primary-subtle);
        color: var(--primary-dark);
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--text-xs);
        font-weight: var(--font-bold);
        flex-shrink: 0;
      }

      .step__instruction {
        font-size: var(--text-sm);
      }

      .step__meta {
        display: flex;
        gap: var(--space-3);
        margin-top: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .generated-recipe__actions {
        display: flex;
        gap: var(--space-3);
        flex-wrap: wrap;
        margin-top: var(--space-6);
      }

      .generated-options {
        display: grid;
        gap: var(--space-3);
        margin-top: var(--space-6);
      }

      .generated-options__title {
        margin: 0;
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
      }

      .generated-options__list {
        display: grid;
        gap: var(--space-3);
      }

      .generated-option {
        display: grid;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }

      .generated-option__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2);
        min-width: 0;
      }

      .generated-option__title {
        min-width: 0;
        margin: 0;
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        overflow-wrap: anywhere;
      }

      .generated-option__meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }

      .generated-option__description {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        overflow-wrap: anywhere;
      }

      .generated-option__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-2);
      }

      /* Recipe Detail */
      .recipe-detail {
        width: 100%;
        max-width: 1440px;
        margin-inline: auto;
        color: var(--text-primary);
      }

      .recipe-detail__hero {
        display: grid;
        grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.8fr);
        gap: var(--space-6);
        align-items: stretch;
        margin-bottom: var(--space-6);
      }

      .recipe-detail__cover {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        min-height: 220px;
        overflow: hidden;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        background: var(--bg-tertiary);
        display: flex;
        flex-direction: column;

        img {
          display: block;
          width: 100%;
          max-width: 100%;
          height: auto;
          min-height: inherit;
          max-height: 360px;
          object-fit: cover;
        }

        .recipe-card__cover-fallback {
          display: flex;
          min-height: inherit;
          align-items: center;
          justify-content: center;
        }
      }

      .recipe-detail__image-credit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-3);
        margin: 0;
        padding: var(--space-2) var(--space-3);
        border-top: 1px solid var(--border-default);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .recipe-detail__image-credit a {
        color: var(--primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }

      .recipe-detail__header {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--space-4);
        min-width: 0;
      }

      .recipe-detail__meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .recipe-detail__description {
        margin: 0;
        font-size: var(--text-base);
        color: var(--text-secondary);
        line-height: 1.65;
        overflow-wrap: anywhere;
      }

      .recipe-detail__timings {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: var(--space-2);

        span {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          min-width: 0;
          padding: var(--space-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          background: var(--bg-tertiary);
          font-size: var(--text-sm);
          overflow-wrap: anywhere;
        }

        strong {
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: var(--font-medium);
        }
      }

      .recipe-detail__servings {
        display: grid;
        grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
        gap: var(--space-2) var(--space-3);
        align-items: center;

        label {
          font-size: var(--text-sm);
          font-weight: var(--font-semibold);
        }

        input {
          max-width: 180px;
        }
      }

      .recipe-detail__hint {
        grid-column: 1 / -1;
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .recipe-detail__body {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-6);
        align-items: start;
      }

      .recipe-detail__sidebar,
      .recipe-detail__main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: var(--space-5);
      }

      .recipe-detail__panel {
        padding: var(--space-5);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        background: var(--bg-secondary);
        box-shadow: var(--shadow-sm);
      }

      .recipe-detail__section {
        min-width: 0;

        h3 {
          margin: 0 0 var(--space-4);
          font-size: var(--text-lg);
          font-weight: var(--font-semibold);
          line-height: 1.3;
        }

        h4 {
          margin: var(--space-4) 0 var(--space-2);
          font-size: var(--text-sm);
          font-weight: var(--font-semibold);
        }

        ul {
          list-style: none;
          padding: 0;
          margin: 0;

          li {
            padding: var(--space-3) 0;
            border-bottom: 1px solid var(--border-default);
            font-size: var(--text-sm);
            line-height: 1.5;
            overflow-wrap: anywhere;

            &:last-child {
              border-bottom: 0;
              padding-bottom: 0;
            }
          }
        }
      }

      .recipe-detail__section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);

        h3 {
          margin-bottom: 0;
        }
      }

      .recipe-detail__ingredients {
        li {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }
      }

      .recipe-detail__ingredient-line {
        display: block;
      }

      .recipe-detail__ingredient-note {
        display: block;
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .recipe-detail__optional {
        display: inline-flex;
        align-items: center;
        margin-inline-start: var(--space-2);
        padding: 0 var(--space-2);
        border-radius: var(--radius-full);
        background: var(--warning-subtle);
        color: var(--color-warning-700);
        font-size: var(--text-xs);
      }

      .recipe-detail__plain-list {
        color: var(--text-secondary);
      }

      .recipe-detail__nutrition {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-2);
        margin: 0;

        div {
          min-width: 0;
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          background: var(--bg-tertiary);
        }

        dt {
          color: var(--text-secondary);
          font-size: var(--text-xs);
        }

        dd {
          margin: var(--space-1) 0 0;
          font-weight: var(--font-semibold);
          overflow-wrap: anywhere;
        }
      }

      .recipe-detail__source {
        margin-top: var(--space-6);
        padding: var(--space-5);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        background: var(--bg-tertiary);
        overflow-wrap: anywhere;

        h3,
        p {
          margin-block: 0 var(--space-2);
        }
      }

      .recipe-detail__detail-level {
        display: flex;
        align-items: center;
        gap: var(--space-3);

        label {
          color: var(--text-secondary);
          font-size: var(--text-sm);
          white-space: nowrap;
        }

        select {
          width: auto;
          min-width: 170px;
        }
      }

      .recipe-detail__steps {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .step-card {
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-sm);
        scroll-margin-block: calc(var(--header-height, 64px) + var(--space-3));
      }

      .step-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-2);
      }

      .step-card__number {
        font-weight: var(--font-semibold);
        font-size: var(--text-sm);
      }

      .step-card__time {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .step-card__instruction {
        margin: 0;
        font-size: var(--text-base);
        line-height: 1.7;
        overflow-wrap: anywhere;
      }

      .step-card__tip,
      .step-card__warning {
        font-size: var(--text-xs);
        padding: var(--space-2);
        border-radius: var(--radius-md);
        margin-top: var(--space-2);
      }

      .step-card__tip {
        background: var(--info-subtle);
        color: var(--color-info-700);
      }

      .step-card__warning {
        background: var(--warning-subtle);
        color: var(--color-warning-700);
      }

      .recipe-detail__actions {
        display: flex;
        gap: var(--space-3);
        margin-top: var(--space-6);
      }

      @media (max-width: 760px) {
        .recipe-detail-page__header {
          align-items: flex-start;
          flex-direction: column;

          h1 {
            width: 100%;
          }
        }

        .recipe-detail__hero,
        .recipe-detail__body {
          grid-template-columns: minmax(0, 1fr);
          gap: var(--space-4);
        }

        .recipe-detail__cover {
          min-height: 180px;
          max-height: 300px;
        }

        .recipe-detail__cover img,
        .recipe-detail__cover .recipe-card__cover-fallback {
          min-height: 180px;
          max-height: 300px;
        }

        .recipe-detail__panel {
          padding: var(--space-4);
        }

        .recipe-detail__section-header {
          align-items: stretch;
          flex-direction: column;
        }
      }

      @media (max-width: 400px) {
        .recipe-detail__timings {
          grid-template-columns: minmax(0, 1fr);
        }

        .recipe-detail__servings {
          grid-template-columns: minmax(0, 1fr);
        }

        .recipe-detail__servings input {
          max-width: none;
        }

        .recipe-detail__detail-level {
          align-items: stretch;
          flex-direction: column;
        }

        .recipe-detail__detail-level select {
          width: 100%;
        }

        .recipe-detail__nutrition {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      /* Form elements */
      .form-select,
      .form-input {
        width: 100%;
        padding: var(--space-2) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);

        &:focus {
          outline: none;
          border-color: var(--primary);
        }
      }

      /* Empty State */
      .empty-state {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-12);
        text-align: center;
      }

      .empty-state__icon {
        display: flex;
        color: var(--text-tertiary);
        margin-bottom: var(--space-4);
      }

      .empty-state__title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-semibold);
        margin-bottom: var(--space-2);
      }

      .empty-state__text {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-6);
      }

      @media (max-width: 480px) {
        .recipe-ai-wizard__steps {
          gap: var(--space-1);
        }

        .recipe-ai-wizard__steps li {
          align-items: flex-start;
          flex-direction: column;
          gap: var(--space-1);
          font-size: var(--text-xs);
        }

        .recipe-ai-wizard__text-action {
          padding-inline: var(--space-2);
        }

        .ai-form__row {
          grid-template-columns: 1fr;
        }

        .ai-form__actions,
        .recipe-detail__actions,
        .generated-recipe__actions,
        .generated-option__actions {
          flex-direction: column;
        }

        .generated-option__header {
          flex-direction: column;
        }

        .generated-option__actions app-button {
          width: 100%;
        }
      }
    `
  ]
})
export class RecipesComponent implements OnInit {
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

  recipeService = inject(RecipeService);
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
  searchInput = signal('');
  isFilterModalOpen = signal(false);
  private country = signal<string | null>(null);
  private mealType = signal<MealType | null>(null);
  private cuisine = signal('');
  private tags = signal<string[]>([]);
  private difficulty = signal<Difficulty | null>(null);
  private maxTime = signal<number | null>(null);
  page = signal(1);
  private pageSize = signal(20);
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
  cookingRecipeId = signal<string | null>(null);
  isCookingMode = signal(false);
  recipeServings = signal(2);
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
        this.pageSize.set(Math.min(100, state.pageSize ?? (state.collection === 'book' ? 12 : 20)));
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
          pageSize: Math.min(100, state.pageSize ?? (state.collection === 'book' ? 12 : 20))
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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        collection: collection === 'book' ? 'book' : null,
        page: null,
        pageSize: collection === 'book' ? '12' : null
      },
      queryParamsHandling: 'merge'
    });
  }

  applyBookSearch(): void {
    const search = this.searchInput().trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: search || null, page: null },
      queryParamsHandling: 'merge'
    });
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
  }

  returnToGeneratedOptions(): void {
    this.selectedGeneratedOptionIndex.set(null);
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
    this.selectedRecipe.set(recipe);
    this.resetRecipeServings(recipe);
    this.selectedRecipeDetailLevel.set(
      recipeDetailLevelFor(
        this.recipeDetailPreferences(),
        recipe.id,
        this.singleGeneratedDetailLevel()
      )
    );
    this.focusAfterRender('[data-test="recipe-detail-title"]');
  }

  private resetRecipeServings(recipe: Recipe): void {
    this.recipeServings.set(Math.max(1, Math.trunc(recipe.servings || 2)));
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => this.document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }),
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
    this.isCookingMode.set(true);
    this.focusAfterRender('[data-test="recipe-cooking-title"]');
  }

  exitCookingMode(): void {
    this.isCookingMode.set(false);
    const recipe = this.selectedRecipe();
    if (recipe) this.resetRecipeServings(recipe);
    this.focusAfterRender('[data-test="recipe-cooking-open"] button');
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

  trackById(_index: number, item: Recipe): string {
    return item.id;
  }
}
