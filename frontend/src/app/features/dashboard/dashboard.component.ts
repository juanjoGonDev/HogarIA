import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RecipeService } from '../../core/services/recipe.service';
import { PantryService } from '../../core/services/pantry.service';
import { CalendarService } from '../../core/services/calendar.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { DashboardPreferencesService } from '../../core/services/dashboard-preferences.service';
import { AiService } from '../../core/services/ai.service';
import { AiQueueService } from '../../core/services/ai-queue.service';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import type { CalendarMeal, MealType } from '../../shared/models/calendar.model';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import type { AiQueueJob } from '../../shared/models/ai-queue.model';
import type { CaducidadRow } from '../../shared/models/caducidades.model';
import { formatShortDay } from '../../core/time';
import { Subscription } from 'rxjs';
import {
  localIsoDate,
  localIsoDateOffset,
  mealTypeLabel as translateMealTypeLabel,
  nextPendingMeal,
  pendingMealsForDate
} from './dashboard-meals.util';
import { expiringWithinDays } from './dashboard-expiry.util';

interface QuickStat {
  icon: IconName;
  labelKey: TranslationKey;
  value: string | number;
  color: string;
}

interface SuggestedRecipe {
  id: string;
  name: string;
  time: number;
  difficulty: string;
  image?: string;
}

interface DashboardAiQueueRow {
  configId: string;
  providerName: string;
  queued: number;
  running: number;
  failed: number;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, BadgeComponent, IconComponent, TranslatePipe],
  template: `
    <div class="dashboard">
      <!-- Welcome Section -->
      <section class="dashboard__welcome">
        <div class="dashboard__greeting">
          <h1 class="page-heading dashboard__title">
            {{ 'dashboard.greeting' | t: { name: userName() } }}
          </h1>
          <p class="dashboard__subtitle">{{ 'dashboard.subtitle' | t }}</p>
        </div>
      </section>

      <!-- Quick Stats -->
      <section class="dashboard__stats">
        <div class="stat-card" *ngFor="let stat of quickStats()">
          <span class="stat-card__icon" [style.color]="stat.color">
            <app-icon [name]="stat.icon" [size]="24" [label]="null" />
          </span>
          <div class="stat-card__content">
            <span class="stat-card__value">{{ stat.value }}</span>
            <span class="stat-card__label">{{ stat.labelKey | t }}</span>
          </div>
        </div>
      </section>

      <!-- Quick Actions -->
      <section class="dashboard__actions">
        <a routerLink="/recipes" fragment="ai" class="action-card action-card--primary">
          <span class="action-card__icon"
            ><app-icon name="smart_toy" [size]="28" [label]="null"
          /></span>
          <span class="action-card__label">{{ 'dashboard.genAI' | t }}</span>
        </a>
        <a routerLink="/pantry" class="action-card action-card--secondary">
          <span class="action-card__icon"
            ><app-icon name="inventory_2" [size]="28" [label]="null"
          /></span>
          <span class="action-card__label">{{ 'dashboard.pantry' | t }}</span>
        </a>
        <a routerLink="/calendar" class="action-card action-card--accent">
          <span class="action-card__icon"
            ><app-icon name="calendar_today" [size]="28" [label]="null"
          /></span>
          <span class="action-card__label">{{ 'dashboard.plan' | t }}</span>
        </a>
      </section>

      <!-- Expiries -->
      <section
        class="dashboard__section"
        data-test="dashboard-expiry"
        [attr.aria-busy]="expiryLoading()"
      >
        <div class="dashboard__section-header">
          <h2 class="dashboard__section-title">{{ 'dashboard.expiryTitle' | t }}</h2>
          <div class="expiry-preview__heading-actions">
            <span
              *ngIf="expiringItems().length > 0 && !expiryLoading() && !expiryError()"
              class="expiry-preview__count"
              [attr.aria-label]="
                'dashboard.expiryCountShown' | t: { count: expiringItems().length }
              "
            >
              {{ expiringItems().length }}
            </span>
            <a
              routerLink="/pantry/caducidades"
              class="dashboard__section-link expiry-preview__all-link"
            >
              {{ 'dashboard.expiryViewAll' | t }}
            </a>
          </div>
        </div>

        <div
          *ngIf="expiryLoading()"
          class="meal-status"
          role="status"
          data-test="dashboard-expiry-loading"
        >
          {{ 'common.loading' | t }}
        </div>

        <div
          *ngIf="!expiryLoading() && expiryError()"
          class="expiry-preview__error"
          role="alert"
          data-test="dashboard-expiry-error"
        >
          <p>{{ 'dashboard.expiryLoadError' | t }}</p>
          <button
            type="button"
            class="meal-error__retry"
            data-test="dashboard-expiry-retry"
            (click)="retryExpiries()"
          >
            {{ 'dashboard.expiryRetry' | t }}
          </button>
        </div>

        <div
          *ngIf="!expiryLoading() && !expiryError() && expiringItems().length === 0"
          class="empty-state"
          data-test="dashboard-expiry-empty"
        >
          <span class="empty-state__icon"
            ><app-icon name="event_busy" [size]="36" [label]="null"
          /></span>
          <p class="empty-state__text">{{ 'dashboard.expiryEmpty' | t }}</p>
        </div>

        <div
          *ngIf="!expiryLoading() && !expiryError() && expiringItems().length > 0"
          class="expiry-list"
        >
          <article
            *ngFor="let item of expiringItems()"
            class="expiry-card"
            data-test="dashboard-expiry-row"
          >
            <span class="expiry-card__icon"
              ><app-icon name="event_busy" [size]="20" [label]="null"
            /></span>
            <span class="expiry-card__name">{{ item.name }}</span>
            <span class="expiry-card__status">{{ expiryStatus(item.daysLeft) }}</span>
          </article>
        </div>
      </section>

      <!-- Pending AI jobs (only for personal users and household settings managers) -->
      <section
        *ngIf="aiQueueSectionVisible()"
        class="dashboard__section"
        data-test="dashboard-ai-queue"
        [attr.aria-busy]="aiQueueBusy()"
      >
        <div class="dashboard__section-header">
          <h2 class="dashboard__section-title">{{ 'dashboard.aiQueueTitle' | t }}</h2>
        </div>

        <p
          *ngIf="aiQueueConfigLoading()"
          class="meal-status"
          role="status"
          data-test="dashboard-ai-queue-config-loading"
        >
          {{ 'dashboard.aiQueueLoading' | t }}
        </p>

        <div
          *ngIf="aiQueueConfigError()"
          class="expiry-preview__error"
          role="alert"
          data-test="dashboard-ai-queue-config-error"
        >
          <p>{{ 'dashboard.aiQueueLoadError' | t }}</p>
          <button
            class="meal-error__retry"
            type="button"
            data-test="dashboard-ai-queue-config-retry"
            (click)="retryAiQueueSummary()"
          >
            {{ 'dashboard.aiQueueRetry' | t }}
          </button>
        </div>

        <div class="expiry-list">
          <ng-container *ngFor="let row of aiQueueRows()">
            <a
              *ngIf="row.queued + row.running + row.failed > 0"
              class="expiry-card ai-queue-card"
              [routerLink]="['/ai-config', row.configId, 'queue']"
              [attr.aria-label]="
                'dashboard.aiQueueProviderSummary'
                  | t
                    : {
                        provider: row.providerName,
                        queued: row.queued,
                        running: row.running,
                        failed: row.failed
                      }
              "
              data-test="dashboard-ai-queue-link"
            >
              <span class="expiry-card__icon">
                <app-icon name="schedule" [size]="20" [label]="null" />
              </span>
              <span class="ai-queue-card__content">
                <span class="expiry-card__name">{{ row.providerName }}</span>
                <span class="expiry-card__status">
                  {{
                    'dashboard.aiQueueCounts'
                      | t: { queued: row.queued, running: row.running, failed: row.failed }
                  }}
                </span>
              </span>
            </a>

            <p
              *ngIf="row.loading && row.queued + row.running + row.failed === 0"
              class="meal-status"
              role="status"
              data-test="dashboard-ai-queue-provider-loading"
            >
              {{ 'dashboard.aiQueueProviderLoading' | t: { provider: row.providerName } }}
            </p>

            <div
              *ngIf="row.error"
              class="expiry-preview__error"
              role="alert"
              data-test="dashboard-ai-queue-provider-error"
            >
              <p>{{ 'dashboard.aiQueueProviderLoadError' | t: { provider: row.providerName } }}</p>
              <button
                class="meal-error__retry"
                type="button"
                [attr.data-test]="'dashboard-ai-queue-provider-retry-' + row.configId"
                (click)="retryAiQueueProvider(row.configId)"
              >
                {{ 'dashboard.aiQueueRetry' | t }}
              </button>
            </div>
          </ng-container>
        </div>
      </section>

      <!-- Today's Meals -->
      <section class="dashboard__section">
        <div class="dashboard__section-header">
          <h2 class="dashboard__section-title">{{ 'dashboard.todayMeals' | t }}</h2>
          <a routerLink="/calendar" class="dashboard__section-link">{{
            'dashboard.viewAll' | t
          }}</a>
        </div>

        <div class="meals-list">
          <div
            *ngFor="let meal of upcomingMeals()"
            class="meal-card"
            [class.meal-card--next]="nextMealToday()?.id === meal.id"
            data-test="today-meal"
          >
            <span class="meal-card__icon"
              ><app-icon name="event_note" [size]="24" [label]="null"
            /></span>
            <div class="meal-card__content">
              <span *ngIf="nextMealToday()?.id === meal.id" class="meal-card__next">
                {{ 'dashboard.nextMealBadge' | t }}
              </span>
              <span class="meal-card__type">{{ mealTypeLabel(meal.mealType) }}</span>
              <span class="meal-card__name">{{ meal.title }}</span>
            </div>
            <time *ngIf="meal.time as time" class="meal-card__time" [attr.datetime]="time">
              {{ time }}
            </time>
          </div>

          <div
            *ngIf="calendarLoading()"
            class="meal-status"
            role="status"
            data-test="today-meals-loading"
          >
            {{ 'common.loading' | t }}
          </div>

          <div
            *ngIf="!calendarLoading() && calendarError() as error"
            class="meal-error"
            role="alert"
            data-test="today-meals-error"
          >
            <p class="meal-error__message">{{ error }}</p>
            <button
              class="meal-error__retry"
              type="button"
              data-test="today-meals-retry"
              (click)="retryTodayMeals()"
            >
              {{ 'calendar.reintentar' | t }}
            </button>
          </div>

          <div
            *ngIf="
              calendarReady() &&
              !calendarLoading() &&
              !calendarError() &&
              upcomingMeals().length === 0
            "
            class="empty-state"
            data-test="today-meals-empty"
          >
            <span class="empty-state__icon"
              ><app-icon name="event_note" [size]="40" [label]="null"
            /></span>
            <p class="empty-state__text">{{ 'dashboard.noMeals' | t }}</p>
            <a routerLink="/calendar" class="empty-state__link">{{ 'dashboard.planNow' | t }}</a>
          </div>
        </div>

        <section
          *ngIf="!nextMealToday()"
          class="next-meal-preview"
          data-test="next-meal"
          [attr.aria-busy]="nextMealLoading()"
        >
          <h3 class="next-meal-preview__title">{{ 'dashboard.nextMealTitle' | t }}</h3>

          <div
            *ngIf="nextMealLoading()"
            class="meal-status"
            role="status"
            data-test="next-meal-loading"
          >
            {{ 'common.loading' | t }}
          </div>

          <div
            *ngIf="!nextMealLoading() && nextMealError()"
            class="meal-error"
            role="alert"
            data-test="next-meal-error"
          >
            <p class="meal-error__message">{{ 'dashboard.nextMealLoadError' | t }}</p>
            <button
              class="meal-error__retry"
              type="button"
              data-test="next-meal-retry"
              (click)="retryNextMeal()"
            >
              {{ 'calendar.reintentar' | t }}
            </button>
          </div>

          <div
            *ngIf="!nextMealLoading() && !nextMealError() && !nextPlannedMeal()"
            class="empty-state"
            data-test="next-meal-empty"
          >
            <p class="empty-state__text">{{ 'dashboard.nextMealEmpty' | t }}</p>
            <a routerLink="/calendar" class="empty-state__link">{{ 'dashboard.planNow' | t }}</a>
          </div>

          <a
            *ngIf="!nextMealLoading() && !nextMealError() && nextPlannedMeal() as meal"
            routerLink="/calendar"
            class="meal-card next-meal-card"
            data-test="next-meal-card"
          >
            <span class="meal-card__icon"
              ><app-icon name="event_note" [size]="24" [label]="null"
            /></span>
            <span class="meal-card__content">
              <span class="meal-card__type">{{ mealTypeLabel(meal.mealType) }}</span>
              <span class="meal-card__name">{{ meal.title }}</span>
            </span>
            <span class="next-meal-card__schedule">
              <time [attr.datetime]="meal.date">{{ formatMealDate(meal.date) }}</time>
              <time *ngIf="meal.time" [attr.datetime]="meal.time">{{ meal.time }}</time>
            </span>
          </a>
        </section>
      </section>

      <!-- Suggested Recipes -->
      <section class="dashboard__section">
        <div class="dashboard__section-header">
          <h2 class="dashboard__section-title">{{ 'dashboard.suggested' | t }}</h2>
          <a routerLink="/recipes" class="dashboard__section-link">{{ 'dashboard.viewAll' | t }}</a>
        </div>

        <div class="recipes-grid">
          <a
            *ngFor="let recipe of suggestedRecipes()"
            routerLink="/recipes"
            [queryParams]="{ recipe: recipe.id }"
            class="recipe-card"
          >
            <div class="recipe-card__image">
              <span *ngIf="!recipe.image" class="recipe-card__placeholder">
                <app-icon name="kitchen" [size]="36" [label]="null" />
              </span>
            </div>
            <div class="recipe-card__content">
              <span class="recipe-card__name">{{ recipe.name }}</span>
              <div class="recipe-card__meta">
                <span class="recipe-card__time">{{
                  'dashboard.minutes_short' | t: { time: recipe.time }
                }}</span>
                <app-badge [variant]="getDifficultyVariant(recipe.difficulty)" size="sm">
                  {{ recipe.difficulty }}
                </app-badge>
              </div>
            </div>
          </a>

          <div *ngIf="suggestedRecipes().length === 0 && !isLoading()" class="empty-state">
            <span class="empty-state__icon"
              ><app-icon name="menu_book" [size]="40" [label]="null"
            /></span>
            <p class="empty-state__text">{{ 'dashboard.noSuggested' | t }}</p>
            <a routerLink="/recipes" fragment="ai" class="empty-state__link">{{
              'dashboard.genAI' | t
            }}</a>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .dashboard {
        padding-block: var(--container-padding);
        max-width: 800px;
        margin: 0 auto;
      }

      .dashboard__welcome {
        margin-bottom: var(--space-6);
      }

      .dashboard__subtitle {
        font-size: var(--text-lg);
        color: var(--text-secondary);
      }

      .dashboard__stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-3);
        margin-bottom: var(--space-6);
      }

      @media (min-width: 600px) {
        .dashboard__stats {
          grid-template-columns: repeat(4, 1fr);
        }
      }

      .stat-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-4);
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-default);
      }

      .stat-card__icon {
        display: inline-flex;
      }
      .stat-card__content {
        display: flex;
        flex-direction: column;
      }

      .stat-card__value {
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
      }

      .stat-card__label {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .dashboard__actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
        gap: var(--space-3);
        margin-bottom: var(--space-8);
      }

      .action-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        padding: var(--space-4);
        border-radius: var(--radius-xl);
        text-decoration: none;
        transition: var(--transition-fast);
        &:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
      }
      .action-card--primary {
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }
      .action-card--secondary {
        background: var(--secondary-subtle);
        color: var(--secondary-dark);
      }
      .action-card--accent {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .action-card__icon {
        display: inline-flex;
      }
      .action-card__label {
        max-width: 100%;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        overflow-wrap: anywhere;
        text-align: center;
      }

      .dashboard__section {
        margin-bottom: var(--space-8);
      }

      .dashboard__section-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
      }

      .dashboard__section-title {
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }

      .dashboard__section-link {
        font-size: var(--text-sm);
        color: var(--primary);
        text-decoration: none;
        &:hover {
          color: var(--primary-dark);
        }
      }

      .expiry-preview__heading-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-left: auto;
      }

      .expiry-preview__all-link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        white-space: nowrap;
      }

      .expiry-preview__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        min-height: 24px;
        padding-inline: var(--space-1);
        border-radius: var(--radius-full);
        background: var(--warning-subtle);
        color: var(--color-warning-700);
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        font-variant-numeric: tabular-nums;
      }

      .expiry-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .expiry-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-3);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
      }

      .expiry-card__icon {
        display: inline-flex;
        flex: none;
        color: var(--color-warning-700);
      }

      .expiry-card__name {
        flex: 1;
        min-width: 0;
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        overflow-wrap: anywhere;
      }

      .expiry-card__status {
        flex: none;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        white-space: nowrap;
      }

      .ai-queue-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        text-decoration: none;
      }

      .ai-queue-card:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .ai-queue-card .expiry-card__icon {
        grid-row: 1;
      }

      .ai-queue-card__content {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: var(--space-1);
      }

      .ai-queue-card .expiry-card__status {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .expiry-preview__error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }

      .expiry-preview__error p {
        flex: 1;
        min-width: 0;
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .meals-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .meal-status {
        display: flex;
        align-items: center;
        min-height: 44px;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .meal-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }

      .meal-error__message {
        flex: 1;
        min-width: 0;
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .meal-error__retry {
        min-height: 44px;
        padding: var(--space-2) var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        cursor: pointer;
      }

      .meal-error__retry:hover {
        background: var(--bg-tertiary);
      }

      .meal-error__retry:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .meal-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        background: var(--bg-secondary);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-default);
      }

      .meal-card--next {
        border-color: var(--primary);
      }

      .meal-card__next {
        color: var(--primary);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
      }

      .next-meal-preview {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin-top: var(--space-3);
      }

      .next-meal-preview__title {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .next-meal-card {
        color: inherit;
        text-decoration: none;
      }

      .next-meal-card:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .next-meal-card__schedule {
        display: flex;
        flex: none;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--space-1);
        color: var(--text-secondary);
        font-size: var(--text-xs);
        text-align: right;
      }

      .meal-card__icon {
        display: inline-flex;
        flex: none;
        color: var(--text-secondary);
      }
      .meal-card__content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .meal-card__type {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
      }
      .meal-card__name {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .meal-card__time {
        flex: none;
        font-size: var(--text-xs);
        color: var(--text-secondary);
        white-space: nowrap;
      }

      .recipes-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-3);
      }

      @media (min-width: 480px) {
        .recipes-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      .recipe-card {
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-default);
        overflow: hidden;
        text-decoration: none;
        transition: var(--transition-fast);
        &:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
      }

      .recipe-card__image {
        aspect-ratio: 16/10;
        background: var(--bg-tertiary);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .recipe-card__placeholder {
        display: inline-flex;
        color: var(--text-secondary);
      }
      .recipe-card__content {
        padding: var(--space-4);
      }

      .recipe-card__name {
        font-family: var(--font-display);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        display: block;
        margin-bottom: var(--space-1);
      }

      .recipe-card__meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        font-size: var(--text-xs);
      }

      @media (max-width: 760px) {
        .recipe-card__content {
          padding: var(--space-2);
        }

        .recipe-card__name {
          margin-bottom: 0;
        }

        .recipe-card__meta {
          gap: var(--space-2);
        }
      }

      .recipe-card__time {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .empty-state {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-8);
        text-align: center;
      }

      .empty-state__icon {
        display: inline-flex;
        margin-bottom: var(--space-3);
        color: var(--text-secondary);
      }

      .empty-state__text {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-4);
      }

      .empty-state__link {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--primary);
        text-decoration: none;
        &:hover {
          color: var(--primary-dark);
        }
      }
    `
  ]
})
export class DashboardComponent implements OnDestroy, OnInit {
  private authService = inject(AuthService);
  private recipeService = inject(RecipeService);
  private pantryService = inject(PantryService);
  private dashboardPreferences = inject(DashboardPreferencesService);
  private calendarService = inject(CalendarService);
  private householdService = inject(HouseholdService);
  private aiService = inject(AiService);
  private aiQueueService = inject(AiQueueService);
  private i18n = inject(I18nService);
  private nextMealSubscription: Subscription | null = null;
  private nextMealRequestId = 0;
  private aiQueueMembershipSubscription: Subscription | null = null;
  private aiQueueConfigsSubscription: Subscription | null = null;
  private aiQueueRetrySubscriptions: Subscription[] = [];
  private aiQueueWatchStops: Array<() => void> = [];
  private aiQueueGeneration = 0;
  private aiQueueProviders = signal<AIProviderConfig[]>([]);
  private aiQueueAccessAllowed = signal(false);
  private aiQueueContextRevision = signal<number | null>(null);
  readonly aiQueueConfigLoading = signal(false);
  readonly aiQueueConfigError = signal(false);
  readonly aiQueueRows = computed<DashboardAiQueueRow[]>(() => {
    if (
      !this.aiQueueAccessAllowed() ||
      this.aiQueueContextRevision() !== this.householdService.contextRevision()
    ) {
      return [];
    }
    return this.aiQueueProviders()
      .map((config) => {
        const state = this.aiQueueService.stateFor(config.id)();
        const jobs: AiQueueJob[] = state.snapshot?.jobs ?? [];
        return {
          configId: config.id,
          providerName: config.name,
          queued: jobs.filter((job) => job.status === 'queued').length,
          running: jobs.filter((job) => job.status === 'running').length,
          failed: jobs.filter((job) => job.status === 'failed').length,
          loading: state.loading,
          error: state.loadError
        };
      })
      .filter((row) => row.queued + row.running + row.failed > 0 || row.loading || row.error);
  });
  readonly aiQueueBusy = computed(
    () => this.aiQueueConfigLoading() || this.aiQueueRows().some((row) => row.loading)
  );
  readonly aiQueueSectionVisible = computed(
    () =>
      this.aiQueueAccessAllowed() &&
      (this.aiQueueConfigLoading() || this.aiQueueConfigError() || this.aiQueueRows().length > 0)
  );
  private readonly aiQueueContextEffect = effect(() => {
    const currentRevision = this.householdService.contextRevision();
    const loadedRevision = this.aiQueueContextRevision();
    if (loadedRevision !== null && loadedRevision !== currentRevision) {
      this.loadAiQueueSummary();
    }
  });

  userName = signal('');

  readonly todayIso = localIsoDate(new Date());
  readonly upcomingMeals = computed(() =>
    pendingMealsForDate(this.calendarService.meals(), this.todayIso)
  );
  readonly calendarLoading = this.calendarService.isLoading;
  readonly calendarError = this.calendarService.error;
  readonly calendarReady = computed(() => {
    const range = this.calendarService.range();
    return range?.start === this.todayIso && range.end === this.todayIso;
  });
  private readonly nextMealMeals = signal<CalendarMeal[]>([]);
  private readonly nextMealNow = signal(new Date());
  readonly nextMealLoading = signal(false);
  readonly nextMealError = signal(false);
  readonly nextPlannedMeal = computed(() =>
    nextPendingMeal(this.nextMealMeals(), this.nextMealNow())
  );
  readonly nextMealToday = computed(() => {
    const meal = this.nextPlannedMeal();
    return meal?.date === this.todayIso ? meal : null;
  });
  readonly expiringItems = computed(() =>
    expiringWithinDays(
      this.pantryService.caducidades(),
      this.dashboardPreferences.expiryHorizonDays()
    )
  );
  readonly expiryLoading = this.pantryService.cargandoCaducidades;
  readonly expiryError = this.pantryService.caducidadesError;

  /** Recetas sugeridas: las 6 mas recientes del listado. */
  suggestedRecipes = computed<SuggestedRecipe[]>(() =>
    this.recipeService
      .recipes()
      .slice(0, 6)
      .map((r) => ({
        id: r.id,
        name: r.name,
        time: r.totalTime ?? 0,
        difficulty: r.difficulty,
        image: r.image
      }))
  );

  /**
   * Tarjetas de resumen. Son `computed` de las senales de los servicios, de
   * modo que se actualizan solas cuando cambian los datos (antes se
   * calculaban una unica vez tras un `setTimeout`, con lo que cualquier
   * peticion lenta dejaba el dashboard con valores obsoletos o a cero).
   */
  quickStats = computed<QuickStat[]>(() => [
    {
      icon: 'inventory_2',
      // Ojo: `pantryService.total()` es el total del listado de ingredientes
      // y cuenta tambien los ~68 sembrados como sugerencia con cantidad 0.
      // Lo que hay "en despensa" es stats.totalItems (quantity > 0).
      labelKey: 'dashboard.ingredients',
      value: this.pantryService.stats()?.totalItems ?? 0,
      color: 'var(--primary)'
    },
    {
      icon: 'menu_book',
      labelKey: 'nav.recipes',
      value: this.recipeService.total(),
      color: 'var(--secondary)'
    },
    {
      icon: 'group',
      labelKey: 'dashboard.members',
      value: this.householdService.household()?.members?.length ?? 0,
      color: 'var(--info)'
    },
    {
      icon: 'kitchen',
      // Sin registro de comidas cocinadas por usuario todavia
      labelKey: 'dashboard.cooked',
      value: 0,
      color: 'var(--warning)'
    }
  ]);

  isLoading = computed(() => this.pantryService.isLoading() || this.recipeService.isLoading());

  ngOnInit(): void {
    this.userName.set(this.authService.userName() || 'Chef');
    this.loadDashboardData();
    this.loadAiQueueSummary();
  }

  private loadDashboardData(): void {
    // Ingredientes y estadisticas de la despensa
    this.pantryService.loadIngredients();
    this.pantryService.loadStats();
    this.pantryService.loadCaducidades();

    // Recetas (la rejilla muestra las 6 primeras)
    this.recipeService.loadRecipes();

    // Comidas de hoy: el rango y el estado de error vienen del calendario compartido.
    this.calendarService.loadRange(this.todayIso, this.todayIso);
    this.loadNextMealPreview();

    // El hogar es best-effort; el dashboard no debe romperse si falla.
    try {
      this.householdService.loadHousehold();
    } catch {
      /* ignore */
    }
  }

  mealTypeLabel(mealType: MealType): string {
    return translateMealTypeLabel(mealType, (key) => this.i18n.t(key));
  }

  formatMealDate(date: string): string {
    return formatShortDay(date);
  }

  retryTodayMeals(): void {
    this.calendarService.loadRange(this.todayIso, this.todayIso, true);
  }

  retryNextMeal(): void {
    this.loadNextMealPreview();
  }

  ngOnDestroy(): void {
    this.nextMealRequestId += 1;
    this.nextMealSubscription?.unsubscribe();
    this.nextMealSubscription = null;
    this.aiQueueGeneration += 1;
    this.aiQueueMembershipSubscription?.unsubscribe();
    this.aiQueueMembershipSubscription = null;
    this.aiQueueConfigsSubscription?.unsubscribe();
    this.aiQueueConfigsSubscription = null;
    this.releaseAiQueueWatchers();
    this.aiQueueRetrySubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.aiQueueRetrySubscriptions = [];
  }

  retryAiQueueSummary(): void {
    if (!this.aiQueueAccessAllowed()) return;
    this.loadAiQueueConfigs(this.aiQueueGeneration, this.householdService.contextRevision());
  }

  retryAiQueueProvider(configId: string): void {
    if (
      !this.aiQueueAccessAllowed() ||
      this.aiQueueContextRevision() !== this.householdService.contextRevision() ||
      !this.aiQueueProviders().some((provider) => provider.id === configId)
    ) {
      return;
    }
    const generation = this.aiQueueGeneration;
    const contextRevision = this.householdService.contextRevision();
    const subscription = this.aiQueueService.refreshQueue(configId).subscribe(() => {
      if (!this.isCurrentAiQueueRead(generation, contextRevision)) return;
    });
    this.aiQueueRetrySubscriptions.push(subscription);
  }

  private loadNextMealPreview(): void {
    this.nextMealSubscription?.unsubscribe();
    const requestId = ++this.nextMealRequestId;
    const now = new Date();
    this.nextMealMeals.set([]);
    this.nextMealNow.set(now);
    this.nextMealLoading.set(true);
    this.nextMealError.set(false);

    this.nextMealSubscription = this.calendarService
      .getMealsForRange(this.todayIso, localIsoDateOffset(now, 6))
      .subscribe({
        next: (meals) => {
          if (requestId !== this.nextMealRequestId) return;
          this.nextMealMeals.set(meals);
          this.nextMealNow.set(new Date());
          this.nextMealLoading.set(false);
        },
        error: () => {
          if (requestId !== this.nextMealRequestId) return;
          this.nextMealError.set(true);
          this.nextMealLoading.set(false);
        }
      });
  }

  private loadAiQueueSummary(): void {
    const generation = ++this.aiQueueGeneration;
    this.aiQueueMembershipSubscription?.unsubscribe();
    this.aiQueueConfigsSubscription?.unsubscribe();
    this.aiQueueRetrySubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.aiQueueRetrySubscriptions = [];
    this.releaseAiQueueWatchers();
    this.aiQueueProviders.set([]);
    this.aiQueueAccessAllowed.set(false);
    this.aiQueueConfigLoading.set(false);
    this.aiQueueConfigError.set(false);
    this.aiQueueContextRevision.set(this.householdService.contextRevision());

    this.aiQueueMembershipSubscription = this.householdService
      .ensureMemberships()
      .subscribe((memberships) => {
        if (generation !== this.aiQueueGeneration) return;
        const contextRevision = this.householdService.contextRevision();
        this.aiQueueContextRevision.set(contextRevision);
        if (this.householdService.membershipsFailed()) return;

        // Membership discovery can change the active home and clear a previously loaded snapshot.
        // Load that home again after resolving the selection instead of racing the initial GET.
        this.householdService.ensureHousehold();

        const activeHouseholdId = this.householdService.activeHouseholdId();
        const allowed =
          memberships.length === 0
            ? activeHouseholdId === null
            : memberships.some(
                (membership) =>
                  membership.id === activeHouseholdId && membership.permissions?.settings === true
              );
        if (!allowed) return;

        this.aiQueueAccessAllowed.set(true);
        this.loadAiQueueConfigs(generation, contextRevision);
      });
  }

  private loadAiQueueConfigs(generation: number, contextRevision: number): void {
    this.aiQueueConfigsSubscription?.unsubscribe();
    this.aiQueueConfigLoading.set(true);
    this.aiQueueConfigError.set(false);
    this.aiQueueConfigsSubscription = this.aiService.loadConfigsSnapshot().subscribe((configs) => {
      if (!this.isCurrentAiQueueRead(generation, contextRevision)) return;
      this.aiQueueConfigLoading.set(false);
      if (!configs) {
        this.aiQueueConfigError.set(true);
        return;
      }

      const providers = configs.filter((config) => Number(config.concurrency) > 0);
      this.aiQueueProviders.set(providers);
      this.aiQueueWatchStops = providers.map((provider) => this.aiQueueService.watch(provider.id));
    });
  }

  private isCurrentAiQueueRead(generation: number, contextRevision: number): boolean {
    return (
      generation === this.aiQueueGeneration &&
      contextRevision === this.householdService.contextRevision() &&
      contextRevision === this.aiQueueContextRevision()
    );
  }

  private releaseAiQueueWatchers(): void {
    this.aiQueueWatchStops.forEach((stop) => stop());
    this.aiQueueWatchStops = [];
  }

  retryExpiries(): void {
    this.pantryService.loadCaducidades();
  }

  expiryStatus(daysLeft: CaducidadRow['daysLeft']): string {
    if (daysLeft === null) return '';
    if (daysLeft < 0) return this.i18n.t('dashboard.expiryStatusExpired');
    if (daysLeft === 0) return this.i18n.t('dashboard.expiryStatusToday');
    return this.i18n.t('dashboard.expiryStatusDays', { days: daysLeft });
  }

  getDifficultyVariant(difficulty: string): 'success' | 'warning' | 'error' {
    const d = (difficulty || '').toLowerCase();
    if (d === 'easy' || d === 'fácil') return 'success';
    if (d === 'hard' || d === 'difícil' || d === 'expert') return 'error';
    return 'warning';
  }
}
