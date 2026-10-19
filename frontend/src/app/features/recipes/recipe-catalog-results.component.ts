import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Recipe } from '../../shared/models/recipe.model';
import type { MealType } from '../../shared/models/recipe.model';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import {
  BadgeComponent,
  type BadgeVariant
} from '../../shared/components/ui/badge/badge.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';

export type RecipeCollection = 'all' | 'book';
export type RecipeViewMode = 'grid' | 'list';
export type RecipeCatalogDisplay = {
  imageUrl: (recipe: Recipe) => string | null;
  difficultyVariant: (difficulty: string) => BadgeVariant;
  difficultyLabel: (difficulty: string) => string;
  countryLabel: (countryCode: string) => string;
  mealTypeLabel: (mealType: MealType) => string;
};

@Component({
  selector: 'app-recipe-catalog-results',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    LoadingComponent,
    TranslatePipe
  ],
  template: `
    <article
      *ngIf="featuredRecipe as featured"
      class="recipes__featured"
      [class.recipes__featured--placeholder]="!display.imageUrl(featured)"
      data-test="recipe-featured"
    >
      <button
        type="button"
        class="recipes__featured-media"
        [class.recipes__featured-media--placeholder]="!display.imageUrl(featured)"
        [attr.aria-label]="'recipes.featured.open' | t: { name: featured.name }"
        (click)="recipeOpened.emit(featured)"
      >
        <img
          *ngIf="display.imageUrl(featured) as imageUrl; else featuredRecipeFallback"
          [src]="imageUrl"
          [alt]="'recipes.book.cover_alt' | t: { name: featured.name }"
          loading="lazy"
        />
        <ng-template #featuredRecipeFallback>
          <span class="recipes__featured-fallback" aria-hidden="true">
            <app-icon name="menu_book" [size]="48" [label]="null" />
          </span>
        </ng-template>
      </button>
      <div class="recipes__featured-content">
        <p class="recipes__featured-eyebrow">{{ 'recipes.featured.label' | t }}</p>
        <h2 class="recipes__featured-title">
          <button
            type="button"
            class="recipes__featured-title-button"
            (click)="recipeOpened.emit(featured)"
          >
            {{ featured.name }}
          </button>
        </h2>
        <p class="recipes__featured-description">{{ featured.description }}</p>
        <div class="recipes__featured-bottom">
          <div class="recipes__featured-meta">
            <span>{{ 'recipes.min' | t: { n: featured.totalTime } }}</span>
            <span>{{ 'recipes.porciones_n' | t: { n: featured.servings } }}</span>
            <app-badge [variant]="display.difficultyVariant(featured.difficulty)" size="sm">
              {{ display.difficultyLabel(featured.difficulty) }}
            </app-badge>
          </div>
          <app-button
            variant="primary"
            size="sm"
            data-test="recipe-featured-open"
            (onClick)="recipeOpened.emit(featured)"
          >
            {{ 'recipes.featured.open_cta' | t }}
            <app-icon name="chevron_right" [size]="16" [label]="null" />
          </app-button>
        </div>
      </div>
    </article>

    <div *ngIf="featuredRecipe" class="recipes__collection-heading" data-test="recipe-more-heading">
      <h2>{{ 'recipes.featured.more' | t }}</h2>
      <button
        type="button"
        class="recipes__show-all"
        data-test="recipe-mobile-show-all"
        [attr.aria-expanded]="showAllMobile"
        (click)="showAllMobileChange.emit(!showAllMobile)"
      >
        {{ (showAllMobile ? 'recipes.featured.show_less' : 'recipes.featured.show_all') | t }}
        <app-icon name="chevron_right" [size]="16" [label]="null" />
      </button>
    </div>

    <!-- Loading -->
    <app-loading *ngIf="loading" [message]="'recipes.loading' | t"></app-loading>

    <div
      *ngIf="loadError"
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
        (onClick)="retryRequested.emit()"
      >
        {{ 'recipes.retry_list_load' | t }}
      </app-button>
    </div>

    <!-- Recipes Grid -->
    <div
      class="recipes__grid"
      [class.recipes__grid--list]="viewMode === 'list'"
      data-test="recipe-results"
      *ngIf="!loading"
    >
      <article
        *ngFor="let recipe of recipes; let recipeIndex = index; trackBy: trackById"
        class="recipe-card"
        [class.recipe-card--list]="viewMode === 'list'"
        [class.recipe-card--featured-hidden]="featuredRecipe?.id === recipe.id"
        [class.recipe-card--collapsed-mobile]="featuredRecipe && !showAllMobile && recipeIndex > 1"
        data-test="recipe-card"
      >
        <button type="button" class="recipe-card__open" (click)="recipeOpened.emit(recipe)">
          <div
            class="recipe-card__image"
            [class.recipe-card__image--placeholder]="!display.imageUrl(recipe)"
          >
            <img
              *ngIf="display.imageUrl(recipe) as imageUrl; else noRecipeImage"
              [src]="imageUrl"
              [alt]="'recipes.book.cover_alt' | t: { name: recipe.name }"
              loading="lazy"
            />
            <ng-template #noRecipeImage>
              <span class="recipe-card__cover-fallback recipe-card__placeholder" aria-hidden="true">
                <app-icon name="menu_book" [size]="32" [label]="null" />
              </span>
            </ng-template>
          </div>

          <div class="recipe-card__content">
            <h3 class="recipe-card__name">{{ recipe.name }}</h3>
            <p class="recipe-card__description">{{ recipe.description }}</p>
            <div *ngIf="collection === 'book'" class="recipe-card__origin">
              <span *ngIf="recipe.countryCode">{{ display.countryLabel(recipe.countryCode) }}</span>
              <span *ngFor="let type of recipe.mealType">{{ display.mealTypeLabel(type) }}</span>
            </div>

            <div class="recipe-card__meta">
              <span class="recipe-card__time">{{
                'recipes.min' | t: { n: recipe.totalTime }
              }}</span>
              <app-badge [variant]="display.difficultyVariant(recipe.difficulty)" size="sm">
                {{ display.difficultyLabel(recipe.difficulty) }}
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
          (click)="favoriteToggled.emit(recipe)"
        >
          <app-icon
            [name]="recipe.isFavorite ? 'favorite' : 'favorite_border'"
            [size]="20"
            [label]="null"
          />
        </button>
      </article>

      <!-- Empty State -->
      <div *ngIf="recipes.length === 0 && !loadError" class="empty-state">
        <span class="empty-state__icon"
          ><app-icon name="menu_book" [size]="64" [label]="null"
        /></span>
        <h3 class="empty-state__title">
          {{
            collection === 'book' || hasActiveFilters
              ? ('recipes.book.no_results' | t)
              : ('recipes.none' | t)
          }}
        </h3>
        <p class="empty-state__text">
          {{
            collection === 'book' || hasActiveFilters
              ? ('recipes.book.no_results_desc' | t)
              : ('recipes.none.desc' | t)
          }}
        </p>
        <app-button
          *ngIf="collection !== 'book' && !hasActiveFilters"
          variant="primary"
          (onClick)="openAi.emit()"
        >
          {{ 'recipes.generar_con_ia' | t }}
        </app-button>
        <app-button
          *ngIf="hasActiveFilters || collection === 'book'"
          variant="outline"
          (onClick)="clearFiltersRequested.emit()"
        >
          {{ 'recipes.book.clear' | t }}
        </app-button>
      </div>
    </div>

    <nav
      *ngIf="total > 0 && !loading && !loadError"
      class="recipes__pagination"
      data-test="recipe-pagination"
      [attr.aria-label]="'recipes.pagination.label' | t"
    >
      <app-button variant="outline" [disabled]="page <= 1" (onClick)="pageChange.emit(page - 1)">
        <app-icon name="chevron_left" [size]="16" [label]="null" />
        <span class="recipes__pagination-label">{{ 'recipes.pagination.previous' | t }}</span>
      </app-button>
      <span aria-live="polite">{{
        'recipes.pagination.page' | t: { current: page, total: pageCount }
      }}</span>
      <app-button
        variant="outline"
        [disabled]="page >= pageCount"
        (onClick)="pageChange.emit(page + 1)"
      >
        <span class="recipes__pagination-label">{{ 'recipes.pagination.next' | t }}</span>
        <app-icon name="chevron_right" [size]="16" [label]="null" />
      </app-button>
    </nav>
  `,
  styleUrls: ['./recipe-catalog-results.component.css']
})
export class RecipeCatalogResultsComponent {
  @Input() collection: RecipeCollection = 'all';
  @Input() featuredRecipe: Recipe | null = null;
  @Input() recipes: Recipe[] = [];
  @Input() viewMode: RecipeViewMode = 'grid';
  @Input() showAllMobile = false;
  @Input() loading = false;
  @Input() loadError = false;
  @Input() total = 0;
  @Input() page = 1;
  @Input() pageCount = 1;
  @Input() hasActiveFilters = false;
  @Input() display!: RecipeCatalogDisplay;

  @Output() showAllMobileChange = new EventEmitter<boolean>();
  @Output() recipeOpened = new EventEmitter<Recipe>();
  @Output() favoriteToggled = new EventEmitter<Recipe>();
  @Output() openAi = new EventEmitter<void>();
  @Output() clearFiltersRequested = new EventEmitter<void>();
  @Output() retryRequested = new EventEmitter<void>();
  @Output() pageChange = new EventEmitter<number>();

  trackById(_index: number, recipe: Recipe): string {
    return recipe.id;
  }
}
