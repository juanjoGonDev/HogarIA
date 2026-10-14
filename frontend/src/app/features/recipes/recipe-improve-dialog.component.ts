import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { AIRecipeImproveResponse, RecipeImproveScope } from '../../shared/models/ai-config.model';
import { I18nService } from '../../core/services/i18n.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { RecipeEditDraft } from './recipe-edit.util';
import {
  RecipeImprovementChange,
  recipeImprovementChanges,
  recipeImprovementInput
} from './recipe-improve.util';

interface RecipeImprovementReviewGroup {
  scope: RecipeImproveScope;
  label: TranslationKey;
  changes: RecipeImprovementChange[];
}

const IMPROVEMENT_SCOPE_LABELS: Record<RecipeImproveScope, TranslationKey> = {
  details: 'recipes.improve.scope.details',
  ingredients: 'recipes.improve.scope.ingredients',
  timing: 'recipes.improve.scope.timing',
  preparation: 'recipes.improve.scope.preparation',
  guidance: 'recipes.improve.scope.guidance',
  nutrition: 'recipes.improve.scope.nutrition',
  storage: 'recipes.improve.scope.storage'
};

const IMPROVEMENT_SCOPE_DESCRIPTIONS: Record<RecipeImproveScope, TranslationKey> = {
  details: 'recipes.improve.scope.details_description',
  ingredients: 'recipes.improve.scope.ingredients_description',
  timing: 'recipes.improve.scope.timing_description',
  preparation: 'recipes.improve.scope.preparation_description',
  guidance: 'recipes.improve.scope.guidance_description',
  nutrition: 'recipes.improve.scope.nutrition_description',
  storage: 'recipes.improve.scope.storage_description'
};

const IMPROVEMENT_SCOPES = Object.keys(IMPROVEMENT_SCOPE_LABELS) as RecipeImproveScope[];

@Component({
  selector: 'app-recipe-improve-dialog',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent, ModalComponent, TranslatePipe],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="'recipes.improve.title' | t"
      size="lg"
      [showFooter]="true"
      (onClose)="cancel.emit()"
    >
      <ng-container *ngIf="!response; else reviewProposal">
        <p class="recipe-improve__intro">{{ 'recipes.improve.intro' | t }}</p>
        <fieldset class="recipe-improve__scopes">
          <legend>{{ 'recipes.improve.choose_scopes' | t }}</legend>
          <label *ngFor="let scope of availableScopes" class="recipe-improve__scope">
            <input
              type="checkbox"
              [checked]="selectedScopes.includes(scope)"
              [disabled]="loading"
              (change)="toggleScope(scope, $event)"
            />
            <span class="recipe-improve__scope-copy">
              <strong>{{ scopeLabel(scope) | t }}</strong>
              <span>{{ scopeDescription(scope) | t }}</span>
            </span>
          </label>
        </fieldset>
        <label class="recipe-improve__media-option">
          <input
            type="checkbox"
            [checked]="includeMedia"
            [disabled]="loading"
            (change)="toggleMediaSearch($event)"
          />
          <span>
            <strong>{{ 'recipes.improve.include_media' | t }}</strong>
            <span>{{ 'recipes.improve.include_media_description' | t }}</span>
          </span>
        </label>
        <p *ngIf="!canImprove" class="recipe-improve__notice" role="note">
          {{ 'recipes.improve.complete_first' | t }}
        </p>
        <p *ngIf="errorKey" class="recipe-improve__error" role="alert">{{ errorKey | t }}</p>
        <p *ngIf="loading" class="recipe-improve__progress" role="status" aria-live="polite">
          <app-icon name="smart_toy" [size]="18" [label]="null" />
          {{ 'recipes.improve.progress' | t }}
        </p>
      </ng-container>

      <ng-template #reviewProposal>
        <p class="recipe-improve__intro">{{ 'recipes.improve.review_intro' | t }}</p>
        <div *ngIf="reviewGroups.length; else noChanges" class="recipe-improve__groups">
          <section *ngFor="let group of reviewGroups" class="recipe-improve__group">
            <h3>{{ group.label | t }}</h3>
            <article *ngFor="let change of group.changes" class="recipe-improve__change">
              <h4>{{ change.label | t }}</h4>
              <div class="recipe-improve__comparison">
                <div class="recipe-improve__value">
                  <h5>{{ 'recipes.improve.before' | t }}</h5>
                  <pre>{{ change.before || ('recipes.improve.empty' | t) }}</pre>
                </div>
                <div class="recipe-improve__value recipe-improve__value--proposed">
                  <h5>{{ 'recipes.improve.after' | t }}</h5>
                  <pre>{{ change.after || ('recipes.improve.empty' | t) }}</pre>
                </div>
              </div>
            </article>
          </section>
        </div>
        <ng-template #noChanges>
          <p class="recipe-improve__notice" role="status">{{ 'recipes.improve.no_changes' | t }}</p>
        </ng-template>
      </ng-template>

      <div footer class="recipe-improve__actions">
        <ng-container *ngIf="response; else selectionActions">
          <app-button variant="outline" [fullWidth]="true" (onClick)="revise.emit()">
            {{ 'recipes.improve.change_scopes' | t }}
          </app-button>
          <app-button
            variant="primary"
            [fullWidth]="true"
            [disabled]="reviewGroups.length === 0"
            (onClick)="apply.emit({ patch: response.patch, scopes: response.scopes, includeMedia })"
          >
            {{ 'recipes.improve.apply_draft' | t }}
          </app-button>
        </ng-container>
        <ng-template #selectionActions>
          <app-button variant="outline" [fullWidth]="true" (onClick)="cancel.emit()">
            {{ 'recipes.editor.cancel' | t }}
          </app-button>
          <app-button
            variant="primary"
            [fullWidth]="true"
            [loading]="loading"
            [disabled]="loading || !canImprove || selectedScopes.length === 0"
            [attr.data-test]="errorKey ? 'recipe-improve-retry' : 'recipe-improve-submit'"
            (onClick)="requestImprovements()"
          >
            {{
              (loading
                ? 'recipes.improve.progress'
                : errorKey
                  ? 'recipes.improve.retry'
                  : 'recipes.improve.request'
              ) | t
            }}
          </app-button>
        </ng-template>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .recipe-improve__intro {
        margin: 0 0 var(--space-4);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
      }
      .recipe-improve__scopes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-2);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .recipe-improve__scopes legend {
        margin-bottom: var(--space-2);
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .recipe-improve__scope {
        min-width: 0;
        min-height: 64px;
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
      }
      .recipe-improve__scope:has(input:checked) {
        border-color: var(--primary);
        background: var(--bg-primary);
      }
      .recipe-improve__scope input {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        margin: 1px 0 0;
        accent-color: var(--primary);
      }
      .recipe-improve__media-option {
        min-width: 0;
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        margin-top: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        color: var(--text-primary);
        cursor: pointer;
      }
      .recipe-improve__media-option input {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        margin: 1px 0 0;
        accent-color: var(--primary);
      }
      .recipe-improve__media-option > span {
        min-width: 0;
        display: grid;
        gap: var(--space-1);
      }
      .recipe-improve__media-option strong {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .recipe-improve__media-option span span {
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }
      .recipe-improve__scope-copy {
        min-width: 0;
        display: grid;
        gap: var(--space-1);
      }
      .recipe-improve__scope-copy strong {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .recipe-improve__scope-copy > span {
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }
      .recipe-improve__notice,
      .recipe-improve__error,
      .recipe-improve__progress {
        margin: var(--space-3) 0 0;
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
      }
      .recipe-improve__notice {
        padding: var(--space-3);
        border-inline-start: 3px solid var(--border-strong);
        background: var(--bg-tertiary);
        color: var(--text-secondary);
      }
      .recipe-improve__error {
        color: var(--error);
      }
      .recipe-improve__progress {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
      }
      .recipe-improve__groups {
        display: grid;
        gap: var(--space-4);
      }
      .recipe-improve__group {
        min-width: 0;
        display: grid;
        gap: var(--space-3);
      }
      .recipe-improve__group > h3,
      .recipe-improve__change > h4 {
        margin: 0;
        color: var(--text-primary);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
      }
      .recipe-improve__change {
        min-width: 0;
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-default);
      }
      .recipe-improve__change > h4 {
        margin-bottom: var(--space-2);
        font-size: var(--text-sm);
      }
      .recipe-improve__comparison {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-3);
      }
      .recipe-improve__value {
        min-width: 0;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }
      .recipe-improve__value--proposed {
        border-color: color-mix(in srgb, var(--success) 48%, var(--border-default));
      }
      .recipe-improve__value h5 {
        margin: 0 0 var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
      }
      .recipe-improve__value pre {
        max-height: 180px;
        overflow: auto;
        margin: 0;
        color: var(--text-primary);
        font-family: inherit;
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .recipe-improve__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-2);
      }
      @media (max-width: 600px) {
        .recipe-improve__scopes,
        .recipe-improve__comparison {
          grid-template-columns: minmax(0, 1fr);
        }
        .recipe-improve__actions app-button {
          flex: 1 1 0;
        }
      }
    `
  ]
})
export class RecipeImproveDialogComponent implements OnChanges, AfterViewChecked {
  private readonly i18n = inject(I18nService);
  @ViewChild(ModalComponent) private modal?: ModalComponent;
  private resetReviewScroll = false;
  @Input() isOpen = false;
  @Input() draft: RecipeEditDraft | null = null;
  @Input() loading = false;
  @Input() errorKey: TranslationKey | null = null;
  @Input() response: AIRecipeImproveResponse | null = null;

  @Output() request = new EventEmitter<{
    scopes: RecipeImproveScope[];
    includeMedia: boolean;
  }>();
  @Output() apply = new EventEmitter<{
    patch: AIRecipeImproveResponse['patch'];
    scopes: RecipeImproveScope[];
    includeMedia: boolean;
  }>();
  @Output() cancel = new EventEmitter<void>();
  @Output() revise = new EventEmitter<void>();

  readonly availableScopes = IMPROVEMENT_SCOPES;
  selectedScopes: RecipeImproveScope[] = [];
  includeMedia = false;
  reviewGroups: RecipeImprovementReviewGroup[] = [];

  get canImprove(): boolean {
    return this.draft !== null && recipeImprovementInput(this.draft) !== null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['response']?.currentValue && !changes['response'].previousValue) {
      this.resetReviewScroll = true;
    }

    if (changes['isOpen']?.currentValue === true && changes['isOpen'].previousValue !== true) {
      this.selectedScopes = [];
      this.includeMedia = false;
      this.reviewGroups = [];
    }
    if (changes['response'] || changes['draft']) this.buildReviewGroups();
  }

  toggleScope(scope: RecipeImproveScope, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedScopes = checked
      ? this.selectedScopes.includes(scope)
        ? this.selectedScopes
        : [...this.selectedScopes, scope]
      : this.selectedScopes.filter((selected) => selected !== scope);
  }

  requestImprovements(): void {
    if (!this.loading && this.canImprove && this.selectedScopes.length > 0) {
      this.request.emit({ scopes: [...this.selectedScopes], includeMedia: this.includeMedia });
    }
  }

  ngAfterViewChecked(): void {
    if (!this.resetReviewScroll) return;
    this.resetReviewScroll = false;
    this.modal?.resetBodyScroll();
  }

  toggleMediaSearch(event: Event): void {
    this.includeMedia = (event.target as HTMLInputElement).checked;
  }

  scopeLabel(scope: RecipeImproveScope): TranslationKey {
    return IMPROVEMENT_SCOPE_LABELS[scope];
  }

  scopeDescription(scope: RecipeImproveScope): TranslationKey {
    return IMPROVEMENT_SCOPE_DESCRIPTIONS[scope];
  }

  private buildReviewGroups(): void {
    if (!this.draft || !this.response) {
      this.reviewGroups = [];
      return;
    }
    const changes = recipeImprovementChanges(
      this.draft,
      this.response.patch,
      this.response.scopes,
      (key, params) => this.i18n.t(key, params)
    );
    this.reviewGroups = this.response.scopes
      .map((scope) => ({
        scope,
        label: this.scopeLabel(scope),
        changes: changes.filter((change) => change.scope === scope)
      }))
      .filter((group) => group.changes.length > 0);
  }
}
