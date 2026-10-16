import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Injector,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, Subscription } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { PantryService } from '../../core/services/pantry.service';
import { AiActionAssistantService } from '../../core/services/ai-action-assistant.service';
import { AiActionAssistantExecutionService } from '../../core/services/ai-action-assistant-execution.service';
import { HouseholdService } from '../../core/services/household.service';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalEvent,
  HouseholdMealProposalRecipeReference
} from '../../core/services/household-meal-proposal.service';
import type {
  AssistantAction,
  AssistantActionCandidate,
  AssistantActionPlan,
  AssistantActionRefinementScope,
  AssistantActionStatus,
  AssistantBatchRefinementScope,
  AssistantRouteHint
} from '../models/ai-action-assistant.model';
import type { AIRecipeResponse, AIRecipeIngredient, AIRecipeStep } from '../models/ai-config.model';
import type { TranslationKey } from '../../core/i18n';
import { pantryCategoryLabel } from '../../core/i18n/labels';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { HouseholdMember } from '../models/household.model';
import { ButtonComponent } from './ui/button/button.component';
import { CheckboxComponent } from './ui/checkbox/checkbox.component';
import { IconComponent } from './ui/icon/icon.component';
import { ModalComponent } from './ui/modal/modal.component';
import { PickerComponent } from './ui/picker/picker.component';
import type { PickerOption } from './ui/picker/picker.component';

type AssistantStage = 'compose' | 'review' | 'refine' | 'confirm';
type AssistantFieldKind = 'text' | 'textarea' | 'number' | 'date' | 'time' | 'select' | 'checkbox';
type AssistantFieldValue = string | number | boolean | null;
type HouseholdMealType = HouseholdMealProposalEvent['mealType'];
type PantryIngredientChangeField =
  'name' | 'category' | 'quantity' | 'unit' | 'expirationDate' | 'location' | 'notes';
const PANTRY_CHANGE_FLAGS: Record<PantryIngredientChangeField, string> = {
  ['name']: 'setName',
  ['category']: 'setCategory',
  ['quantity']: 'setQuantity',
  ['unit']: 'setUnit',
  ['expirationDate']: 'setExpirationDate',
  ['location']: 'setLocation',
  ['notes']: 'setNotes'
};
const ACTION_REFINEMENT_SCOPE = '__action__';
const BATCH_REFINEMENT_SCOPE = '__batch__';
const GROUP_REFINEMENT_SCOPE = '__group__';

interface AssistantField {
  path: Array<string | number>;
  key: TranslationKey;
  kind: AssistantFieldKind;
  value: AssistantFieldValue;
  required?: boolean;
  choices?: Array<{ value: string; label: string }>;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  pause?: () => void;
  resume?: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const PANTRY_UNITS = [
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
type AssistantFieldKey =
  | 'name'
  | 'quantity'
  | 'unit'
  | 'category'
  | 'expirationDate'
  | 'location'
  | 'notes'
  | 'store'
  | 'listName'
  | 'title'
  | 'details'
  | 'scheduledDate'
  | 'weekStart'
  | 'instructions'
  | 'spaceName'
  | 'assignedMemberName'
  | 'kind'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'allDay'
  | 'sharedWithHousehold'
  | 'description'
  | 'difficulty'
  | 'cuisine'
  | 'totalTime'
  | 'prepTime'
  | 'cookTime'
  | 'restTime'
  | 'calories'
  | 'tags';

const FIELD_LABELS: Record<AssistantFieldKey, TranslationKey> = {
  name: 'ai_assistant.field.name',
  quantity: 'ai_assistant.field.quantity',
  unit: 'ai_assistant.field.unit',
  category: 'ai_assistant.field.category',
  expirationDate: 'ai_assistant.field.expirationDate',
  location: 'ai_assistant.field.location',
  notes: 'ai_assistant.field.notes',
  store: 'ai_assistant.field.store',
  listName: 'ai_assistant.field.listName',
  title: 'ai_assistant.field.title',
  details: 'ai_assistant.field.details',
  scheduledDate: 'ai_assistant.field.scheduledDate',
  weekStart: 'ai_assistant.field.weekStart',
  instructions: 'ai_assistant.field.instructions',
  spaceName: 'ai_assistant.field.spaceName',
  assignedMemberName: 'ai_assistant.field.assignedMemberName',
  kind: 'ai_assistant.field.kind',
  date: 'ai_assistant.field.date',
  startTime: 'ai_assistant.field.startTime',
  endTime: 'ai_assistant.field.endTime',
  allDay: 'ai_assistant.field.allDay',
  sharedWithHousehold: 'ai_assistant.field.sharedWithHousehold',
  description: 'ai_assistant.field.description',
  difficulty: 'ai_assistant.field.difficulty',
  cuisine: 'ai_assistant.field.cuisine',
  totalTime: 'ai_assistant.field.totalTime',
  prepTime: 'ai_assistant.field.prepTime',
  cookTime: 'ai_assistant.field.cookTime',
  restTime: 'ai_assistant.field.restTime',
  calories: 'ai_assistant.field.calories',
  tags: 'ai_assistant.field.tags'
};

const STATUS_LABELS: Record<AssistantActionStatus, TranslationKey> = {
  pending: 'ai_assistant.status.pending',
  succeeded: 'ai_assistant.status.succeeded',
  failed: 'ai_assistant.status.failed',
  blocked: 'ai_assistant.status.blocked'
};
const DOMAIN_LABELS: Record<AssistantAction['domain'], TranslationKey> = {
  pantry: 'ai_assistant.domain.pantry',
  shopping: 'ai_assistant.domain.shopping',
  household: 'ai_assistant.domain.household',
  calendar: 'ai_assistant.domain.calendar',
  recipes: 'ai_assistant.domain.recipes'
};
const ACTION_LABELS: Record<AssistantAction['actionType'], TranslationKey> = {
  add_ingredient: 'ai_assistant.action.add_ingredient',
  update_ingredient: 'ai_assistant.action.update_ingredient',
  create_list: 'ai_assistant.action.create_list',
  update_list: 'ai_assistant.action.update_list',
  add_item: 'ai_assistant.action.add_item',
  create_task: 'ai_assistant.action.create_task',
  update_task: 'ai_assistant.action.update_task',
  plan_meals: 'ai_assistant.action.plan_meals',
  create_event: 'ai_assistant.action.create_event',
  create_draft: 'ai_assistant.action.create_draft'
};
const EVENT_KINDS: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: 'appointment', labelKey: 'ai_assistant.event_kind.appointment' },
  { value: 'home', labelKey: 'ai_assistant.event_kind.home' },
  { value: 'shopping', labelKey: 'ai_assistant.event_kind.shopping' },
  { value: 'personal', labelKey: 'ai_assistant.event_kind.personal' },
  { value: 'other', labelKey: 'ai_assistant.event_kind.other' }
];
const DIFFICULTIES: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: 'easy', labelKey: 'ai_assistant.difficulty.easy' },
  { value: 'medium', labelKey: 'ai_assistant.difficulty.medium' },
  { value: 'hard', labelKey: 'ai_assistant.difficulty.hard' }
];

@Component({
  selector: 'app-ai-action-assistant-dialog',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    ButtonComponent,
    CheckboxComponent,
    IconComponent,
    ModalComponent,
    PickerComponent
  ],
  template: `
    <app-modal
      [isOpen]="modalOpen()"
      [title]="'ai_assistant.title' | t"
      size="lg"
      [closable]="!executing()"
      [closeOnOverlay]="!executing()"
      [showFooter]="true"
      (onClose)="requestClose()"
    >
      @switch (stage()) {
        @case ('compose') {
          <section class="assistant__compose" data-test="ai-assistant-compose">
            <header class="assistant__intro">
              <h2 #stageHeading tabindex="-1">{{ 'ai_assistant.compose_title' | t }}</h2>
              <p>{{ 'ai_assistant.compose_hint' | t }}</p>
            </header>

            <div class="assistant__voice-note" role="note">
              <app-icon name="help_outline" [size]="18" [label]="null" />
              <div>
                <strong>{{ 'ai_assistant.privacy_title' | t }}</strong>
                <p>{{ 'ai_assistant.privacy_copy' | t }}</p>
              </div>
            </div>

            <label class="assistant__consent">
              <input
                type="checkbox"
                [checked]="voiceConsent()"
                (change)="setVoiceConsent($any($event.target).checked)"
              />
              <span>{{ 'ai_assistant.voice_consent' | t }}</span>
            </label>

            <div class="assistant__input-group">
              <label for="ai-assistant-prompt">{{ 'ai_assistant.prompt_label' | t }}</label>
              <textarea
                id="ai-assistant-prompt"
                rows="5"
                maxlength="2000"
                [value]="prompt()"
                [placeholder]="'ai_assistant.prompt_placeholder' | t"
                [disabled]="loading()"
                aria-describedby="ai-assistant-prompt-help"
                [attr.aria-invalid]="promptError() ? 'true' : null"
                data-test="ai-assistant-prompt"
                (input)="updatePrompt($event)"
              ></textarea>
              <div class="assistant__input-meta">
                <span id="ai-assistant-prompt-help" class="assistant__hint">
                  {{ 'ai_assistant.compose_hint' | t }}
                </span>
                <span class="assistant__counter">{{ prompt().length }}/2000</span>
              </div>
              <p *ngIf="promptError() as promptErrorKey" class="assistant__error" role="alert">
                {{ promptErrorKey | t }}
              </p>
            </div>

            <div class="assistant__voice-controls" *ngIf="voiceSupported(); else voiceFallback">
              <app-button
                *ngIf="voiceState() !== 'listening' && voiceState() !== 'paused'"
                variant="outline"
                [touchTarget]="true"
                [disabled]="loading() || !voiceConsent()"
                data-test="ai-assistant-voice-start"
                (onClick)="startVoice()"
              >
                {{ 'ai_assistant.voice_start' | t }}
              </app-button>
              <app-button
                *ngIf="voiceState() === 'listening'"
                variant="secondary"
                [touchTarget]="true"
                (onClick)="stopVoice()"
              >
                {{ 'ai_assistant.voice_stop' | t }}
              </app-button>
              <app-button
                *ngIf="voiceState() === 'listening' && supportsPause()"
                variant="ghost"
                [touchTarget]="true"
                (onClick)="pauseVoice()"
                >{{ 'ai_assistant.voice_pause' | t }}</app-button
              >
              <app-button
                *ngIf="voiceState() === 'paused'"
                variant="secondary"
                [touchTarget]="true"
                (onClick)="resumeVoice()"
                >{{ 'ai_assistant.voice_resume' | t }}</app-button
              >
              <app-button
                *ngIf="voiceState() === 'listening' || voiceState() === 'paused'"
                variant="ghost"
                [touchTarget]="true"
                (onClick)="cancelVoice()"
                >{{ 'ai_assistant.cancel' | t }}</app-button
              >
            </div>
            <ng-template #voiceFallback>
              <p class="assistant__hint" role="note">{{ 'ai_assistant.voice_unsupported' | t }}</p>
            </ng-template>

            <p
              *ngIf="voiceState() === 'listening'"
              class="assistant__status"
              role="status"
              aria-live="polite"
            >
              {{ 'ai_assistant.listening' | t }}
            </p>
            <p *ngIf="voiceError() as voiceErrorKey" class="assistant__error" role="alert">
              {{ voiceErrorKey | t }}
            </p>
            <p
              *ngIf="errorKey() as errorMessageKey"
              class="assistant__error"
              role="alert"
              data-test="ai-assistant-error"
            >
              {{ errorMessageKey | t }}
            </p>
            <p *ngIf="loading()" class="assistant__status" role="status" aria-live="polite">
              <span class="assistant__spinner" aria-hidden="true"></span>
              {{ 'ai_assistant.processing' | t }}
            </p>
          </section>
        }

        @case ('review') {
          @if (plan(); as currentPlan) {
            <section class="assistant__review" data-test="ai-assistant-review">
              <header class="assistant__stage-heading">
                <div>
                  <h2 #stageHeading tabindex="-1">{{ 'ai_assistant.review_title' | t }}</h2>
                  <p class="assistant__summary-label">{{ 'ai_assistant.plan_summary' | t }}</p>
                  <p class="assistant__summary">{{ currentPlan.summary }}</p>
                </div>
                <app-button variant="ghost" [touchTarget]="true" (onClick)="returnToCompose()">
                  {{ 'ai_assistant.back_to_review' | t }}
                </app-button>
              </header>

              <section
                *ngIf="currentPlan.questions.length"
                class="assistant__questions"
                role="alert"
              >
                <h3>{{ 'ai_assistant.questions' | t }}</h3>
                <ul>
                  <li *ngFor="let question of currentPlan.questions">{{ question }}</li>
                </ul>
                <p>{{ 'ai_assistant.refine_needs_clarification' | t }}</p>
              </section>

              <div class="assistant__selection-tools">
                <span>{{ 'ai_assistant.selected_count' | t: { count: selectedCount() } }}</span>
                <div>
                  <app-button variant="outline" [touchTarget]="true" (onClick)="selectAll()">
                    {{ 'ai_assistant.select_all' | t }}
                  </app-button>
                  <app-button variant="ghost" [touchTarget]="true" (onClick)="selectNone()">
                    {{ 'ai_assistant.select_none' | t }}
                  </app-button>
                  <app-button
                    *ngIf="refinableActions().length > 1"
                    variant="ghost"
                    [touchTarget]="true"
                    [disabled]="loading()"
                    data-test="ai-assistant-refine-batch"
                    (onClick)="beginBatchRefine()"
                  >
                    {{ 'ai_assistant.refine_batch' | t }}
                  </app-button>
                </div>
              </div>

              <div
                *ngIf="refinableDomains().length"
                class="assistant__group-tools"
                data-test="ai-assistant-refine-groups"
              >
                <span>{{ 'ai_assistant.refine_groups_label' | t }}</span>
                <app-button
                  *ngFor="let domain of refinableDomains()"
                  variant="ghost"
                  [touchTarget]="true"
                  [disabled]="loading()"
                  data-test="ai-assistant-refine-group"
                  (onClick)="beginGroupRefine(domain)"
                >
                  {{ groupRefineLabel(domain) }}
                </app-button>
              </div>

              <div
                class="assistant__actions"
                [attr.aria-label]="'ai_assistant.proposals' | t"
                data-test="ai-assistant-actions"
              >
                <article
                  *ngFor="let action of currentPlan.actions; trackBy: trackAction"
                  class="assistant__action"
                  [class.assistant__action--selected]="action.selected"
                  [attr.data-action-id]="action.id"
                >
                  <header class="assistant__action-header">
                    <app-checkbox
                      [checked]="action.selected"
                      [label]="action.title"
                      [hint]="actionDomainLabel(action) | t"
                      (checkedChange)="setSelected(action.id, $event)"
                    />
                    <div class="assistant__action-controls">
                      <app-button
                        *ngIf="action.kind !== 'household.plan_meals'"
                        variant="ghost"
                        [touchTarget]="true"
                        [disabled]="loading() || action.status === 'succeeded'"
                        [attr.aria-label]="'ai_assistant.action_refine' | t"
                        data-test="ai-assistant-refine"
                        (onClick)="beginRefine(action.id)"
                      >
                        {{ 'ai_assistant.action_refine' | t }}
                      </app-button>
                      <app-button
                        variant="ghost"
                        [touchTarget]="true"
                        [disabled]="hasDependents(action.id) || loading()"
                        data-test="ai-assistant-remove"
                        (onClick)="omitAction(action.id)"
                      >
                        <app-icon name="close" [size]="18" [label]="null" />
                        <span>{{ 'ai_assistant.action_remove' | t }}</span>
                      </app-button>
                    </div>
                  </header>
                  <p class="assistant__action-summary">{{ action.summary }}</p>
                  <p
                    *ngIf="action.kind === 'household.update_task'"
                    class="assistant__action-summary"
                    data-test="ai-assistant-task-target"
                  >
                    {{
                      'ai_assistant.task_target'
                        | t
                          : {
                              title: action.executionTarget.snapshot.title,
                              date: action.executionTarget.snapshot.scheduledDate,
                              details: action.executionTarget.snapshot.details || '—'
                            }
                    }}
                  </p>
                  <p
                    *ngIf="action.kind === 'shopping.update_list'"
                    class="assistant__action-summary"
                    data-test="ai-assistant-shopping-target"
                  >
                    {{
                      'ai_assistant.shopping_list_target'
                        | t
                          : {
                              name: action.executionTarget.snapshot.name,
                              store: action.executionTarget.snapshot.store || '—'
                            }
                    }}
                  </p>
                  <p
                    *ngIf="action.kind === 'pantry.update_ingredient'"
                    class="assistant__action-summary"
                    data-test="ai-assistant-pantry-target"
                  >
                    {{
                      'ai_assistant.pantry_ingredient_target'
                        | t
                          : {
                              name: action.executionTarget.snapshot.name,
                              quantity: action.executionTarget.snapshot.quantity,
                              unit: action.executionTarget.snapshot.unit,
                              category: action.executionTarget.snapshot.category,
                              expirationDate: action.executionTarget.snapshot.expirationDate || '—',
                              location: pantryLocationLabel(
                                action.executionTarget.snapshot.location
                              ),
                              notes: action.executionTarget.snapshot.notes || '—'
                            }
                    }}
                  </p>
                  <span class="assistant__status-tag" [attr.data-status]="action.status">
                    {{ statusLabel(action.status) | t }}
                  </span>
                  <ul *ngIf="action.warnings.length" class="assistant__warnings">
                    <li *ngFor="let warning of action.warnings">
                      {{ 'ai_assistant.warning' | t: { message: warning } }}
                    </li>
                  </ul>
                  <ul *ngIf="action.dependsOn.length" class="assistant__dependencies">
                    <li *ngFor="let dependencyId of action.dependsOn">
                      {{ 'ai_assistant.dependency' | t: { title: actionTitle(dependencyId) } }}
                    </li>
                  </ul>
                  <p *ngIf="hasDependents(action.id)" class="assistant__hint">
                    {{ 'ai_assistant.dependency_required' | t }}
                  </p>

                  <details
                    class="assistant__details"
                    [attr.data-test]="'ai-assistant-action-details-' + action.id"
                  >
                    <summary>{{ 'ai_assistant.action_details' | t }}</summary>
                    <div class="assistant__fields">
                      <label
                        *ngFor="let field of editableFields(action); trackBy: trackField"
                        class="assistant__field"
                      >
                        <span>{{ field.key | t }}</span>
                        <app-picker
                          *ngIf="field.kind === 'select'"
                          [value]="field.value === null ? null : field.value.toString()"
                          [options]="field.choices ?? []"
                          [label]="field.key | t"
                          [disabled]="loading()"
                          [floatingPanel]="true"
                          (valueChange)="updateField(action.id, field.path, $event ?? '')"
                        ></app-picker>
                        <input
                          *ngIf="
                            field.kind !== 'select' &&
                            field.kind !== 'textarea' &&
                            field.kind !== 'checkbox'
                          "
                          [type]="field.kind"
                          [value]="field.value ?? ''"
                          [required]="field.required || false"
                          [min]="
                            field.kind === 'number' && field.required
                              ? action.kind === 'pantry.update_ingredient' &&
                                field.path[1] === 'quantity'
                                ? 0
                                : 0.01
                              : null
                          "
                          [step]="field.kind === 'number' ? 'any' : null"
                          [disabled]="loading()"
                          (input)="
                            updateField(
                              action.id,
                              field.path,
                              $any($event.target).value,
                              field.kind
                            )
                          "
                        />
                        <textarea
                          *ngIf="field.kind === 'textarea'"
                          rows="2"
                          [value]="field.value ?? ''"
                          [required]="field.required || false"
                          [disabled]="loading()"
                          (input)="updateField(action.id, field.path, $any($event.target).value)"
                        ></textarea>
                        <input
                          *ngIf="field.kind === 'checkbox'"
                          type="checkbox"
                          [checked]="field.value === true"
                          [disabled]="loading()"
                          (change)="updateField(action.id, field.path, $any($event.target).checked)"
                        />
                        <small
                          *ngIf="fieldError(action, field)"
                          class="assistant__field-error"
                          role="alert"
                        >
                          {{ 'ai_assistant.field_invalid' | t }}
                        </small>
                      </label>

                      <ng-container *ngIf="action.kind === 'recipes.create_draft'">
                        <fieldset class="assistant__recipe-section">
                          <legend>{{ 'ai_assistant.field.ingredients' | t }}</legend>
                          <div
                            *ngFor="let ingredient of recipeIngredients(action); let index = index"
                            class="assistant__recipe-row"
                          >
                            <label class="assistant__field">
                              <span>{{ 'ai_assistant.field.ingredient_name' | t }}</span>
                              <input
                                [value]="ingredient.name"
                                (input)="
                                  updateField(
                                    action.id,
                                    ['recipe', 'ingredients', index, 'name'],
                                    $any($event.target).value
                                  )
                                "
                              />
                            </label>
                            <label class="assistant__field">
                              <span>{{ 'ai_assistant.field.quantity' | t }}</span>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                [value]="ingredient.quantity"
                                (input)="
                                  updateField(
                                    action.id,
                                    ['recipe', 'ingredients', index, 'quantity'],
                                    $any($event.target).value,
                                    'number'
                                  )
                                "
                              />
                            </label>
                            <label class="assistant__field">
                              <span>{{ 'ai_assistant.field.unit' | t }}</span>
                              <app-picker
                                [value]="ingredient.unit"
                                [options]="pantryUnitOptions"
                                [label]="'ai_assistant.field.unit' | t"
                                [disabled]="loading()"
                                [floatingPanel]="true"
                                (valueChange)="
                                  updateField(
                                    action.id,
                                    ['recipe', 'ingredients', index, 'unit'],
                                    $event ?? ''
                                  )
                                "
                              ></app-picker>
                            </label>
                            <label class="assistant__field">
                              <span>{{ 'ai_assistant.field.preparation' | t }}</span>
                              <input
                                [value]="ingredient.preparation ?? ''"
                                (input)="
                                  updateField(
                                    action.id,
                                    ['recipe', 'ingredients', index, 'preparation'],
                                    $any($event.target).value
                                  )
                                "
                              />
                            </label>
                          </div>
                        </fieldset>
                        <fieldset class="assistant__recipe-section">
                          <legend>{{ 'ai_assistant.field.instructionsByLevel' | t }}</legend>
                          <section
                            *ngFor="let level of recipeLevels"
                            class="assistant__recipe-level"
                          >
                            <h4>{{ levelLabel(level) }}</h4>
                            <label
                              *ngFor="let step of recipeSteps(action, level); let index = index"
                              class="assistant__field"
                            >
                              <span>{{
                                'ai_assistant.field.step' | t: { number: index + 1 }
                              }}</span>
                              <textarea
                                rows="2"
                                [value]="step.instruction"
                                (input)="
                                  updateField(
                                    action.id,
                                    ['recipe', 'instructionsByLevel', level, index, 'instruction'],
                                    $any($event.target).value
                                  )
                                "
                              ></textarea>
                            </label>
                          </section>
                        </fieldset>
                      </ng-container>
                    </div>
                  </details>
                  <section
                    *ngIf="action.kind === 'household.plan_meals'"
                    class="assistant__meal-planner"
                    [attr.data-test]="'ai-assistant-meals-' + action.id"
                  >
                    <h3>{{ 'ai_assistant.meals.heading' | t }}</h3>
                    <p class="assistant__hint">{{ 'ai_assistant.meals.participants' | t }}</p>
                    <p *ngIf="!mealParticipants().length" class="assistant__error" role="alert">
                      {{ 'ai_assistant.meals.no_members' | t }}
                    </p>
                    <div class="assistant__meal-participants">
                      <label *ngFor="let member of mealParticipants(); trackBy: trackMember">
                        <input
                          type="checkbox"
                          [checked]="isMealParticipantSelected(action.id, member.id)"
                          [disabled]="mealProposalBusy(action.id) || executing()"
                          (change)="
                            toggleMealParticipant(action.id, member.id, $any($event.target).checked)
                          "
                        />
                        <span>{{ member.name }}</span>
                      </label>
                    </div>
                    <app-button
                      variant="outline"
                      [touchTarget]="true"
                      [loading]="mealProposalBusy(action.id)"
                      [disabled]="!canGenerateMealProposal(action) || loading() || executing()"
                      data-test="ai-assistant-meals-generate"
                      (onClick)="generateMealProposal(action)"
                    >
                      {{ 'ai_assistant.meals.generate' | t }}
                    </app-button>
                    <p
                      *ngIf="mealProposalFor(action.id) as mealPlan"
                      class="assistant__status"
                      role="status"
                      data-test="ai-assistant-meals-preview-ready"
                    >
                      {{ 'ai_assistant.meals.preview_ready' | t }}
                    </p>
                    <ng-container *ngIf="mealProposalFor(action.id) as mealPlan">
                      <details class="assistant__meal-preview" open>
                        <summary>{{ mealPlan.weekStart }} · {{ mealPlan.events.length }}</summary>
                        <ol>
                          <li *ngFor="let event of mealPlan.events; trackBy: trackMealEvent">
                            <strong>{{ event.date }} · {{ mealTypeLabel(event.mealType) }}</strong>
                            <ng-container *ngIf="event.status === 'scheduled'; else unresolvedMeal">
                              <p>{{ mealRecipeName(mealPlan, event) }}</p>
                              <label class="assistant__field assistant__meal-servings">
                                <span>
                                  {{ 'ai_assistant.meals.servings' | t }} ·
                                  {{ mealRecipeName(mealPlan, event) }}
                                </span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  step="1"
                                  [value]="event.servings"
                                  [disabled]="mealProposalBusy(action.id) || executing()"
                                  (change)="
                                    updateMealServings(action.id, event, $any($event.target))
                                  "
                                />
                              </label>
                              <details
                                *ngIf="mealRecipe(mealPlan, event) as recipe"
                                class="assistant__meal-recipe"
                              >
                                <summary>
                                  {{ recipe.recipe.name }} ·
                                  {{ 'ai_assistant.meals.ingredients' | t }}
                                </summary>
                                <p>{{ recipe.recipe.description }}</p>
                                <ul>
                                  <li *ngFor="let ingredient of recipe.recipe.ingredients">
                                    {{ ingredient.name }} · {{ ingredient.quantity }}
                                    {{ ingredient.unit }}
                                  </li>
                                </ul>
                              </details>
                            </ng-container>
                            <ng-template #unresolvedMeal>
                              <p class="assistant__hint">
                                {{ 'ai_assistant.meals.unresolved' | t: { reason: event.reason } }}
                              </p>
                            </ng-template>
                          </li>
                        </ol>
                      </details>
                      <label class="assistant__meal-refinement">
                        <span>{{ 'ai_assistant.meals.refine_label' | t }}</span>
                        <textarea
                          rows="2"
                          maxlength="1000"
                          [value]="mealRefinementText(action.id)"
                          [disabled]="mealProposalBusy(action.id) || executing()"
                          [placeholder]="'ai_assistant.meals.refine_placeholder' | t"
                          (input)="setMealRefinementText(action.id, $any($event.target).value)"
                        ></textarea>
                      </label>
                      <app-button
                        variant="ghost"
                        [touchTarget]="true"
                        [loading]="mealProposalBusy(action.id)"
                        [disabled]="!canRefineMealProposal(action) || loading() || executing()"
                        data-test="ai-assistant-meals-refine"
                        (onClick)="refineMealProposal(action)"
                      >
                        {{ 'ai_assistant.meals.refine' | t }}
                      </app-button>
                    </ng-container>
                    <p *ngIf="errorKey() as errorMessageKey" class="assistant__error" role="alert">
                      {{ errorMessageKey | t }}
                    </p>
                  </section>
                  <p
                    *ngIf="action.selected && !isActionValid(action)"
                    class="assistant__error"
                    role="alert"
                  >
                    {{ 'ai_assistant.action_invalid' | t }}
                  </p>
                  <p
                    *ngIf="action.selected && hasUnselectedDependency(action)"
                    class="assistant__error"
                    role="alert"
                  >
                    {{ 'ai_assistant.dependency_unselected' | t }}
                  </p>
                </article>
              </div>
              <p *ngIf="!currentPlan.actions.length" class="assistant__empty" role="status">
                {{ 'ai_assistant.no_actions' | t }}
              </p>
            </section>
          }
        }

        @case ('refine') {
          <section class="assistant__refine" data-test="ai-assistant-refine-stage">
            <h2 #stageHeading tabindex="-1">{{ 'ai_assistant.refine_title' | t }}</h2>
            <p>{{ 'ai_assistant.refine_hint' | t }}</p>
            <p
              *ngIf="refinementBatchScope(); else singleActionRefinement"
              class="assistant__refine-target"
            >
              {{ batchRefinementScopeLabel() }}
            </p>
            <ng-template #singleActionRefinement>
              <p *ngIf="refiningAction() as action" class="assistant__refine-target">
                {{ action.title }}
              </p>
              <label for="ai-assistant-refine-scope">{{
                'ai_assistant.refine_scope_label' | t
              }}</label>
              <app-picker
                id="ai-assistant-refine-scope"
                data-test="ai-assistant-refine-scope"
                [value]="refinementScopeValue()"
                [options]="refinementScopeOptions(refiningAction())"
                [label]="'ai_assistant.refine_scope_label' | t"
                [disabled]="loading()"
                [floatingPanel]="true"
                (valueChange)="chooseRefinementScope($event)"
              ></app-picker>
            </ng-template>
            <label for="ai-assistant-refine-input">{{ 'ai_assistant.refine_label' | t }}</label>
            <textarea
              id="ai-assistant-refine-input"
              rows="4"
              maxlength="1000"
              [value]="refinementPrompt()"
              [placeholder]="'ai_assistant.refine_placeholder' | t"
              [disabled]="loading()"
              (input)="refinementPrompt.set($any($event.target).value)"
            ></textarea>
            <p *ngIf="refinementQuestions().length" class="assistant__questions" role="alert">
              {{ refinementQuestions().join(' ') }}
            </p>
            <p *ngIf="errorKey() as errorMessageKey" class="assistant__error" role="alert">
              {{ errorMessageKey | t }}
            </p>
            <p *ngIf="loading()" class="assistant__status" role="status" aria-live="polite">
              <span class="assistant__spinner" aria-hidden="true"></span>
              {{ 'ai_assistant.processing' | t }}
            </p>
          </section>
        }

        @case ('confirm') {
          @if (plan(); as currentPlan) {
            <section class="assistant__confirm" data-test="ai-assistant-confirm">
              <h2 #stageHeading tabindex="-1">{{ 'ai_assistant.confirm_title' | t }}</h2>
              <p>{{ 'ai_assistant.confirm_copy' | t }}</p>
              <ul class="assistant__confirm-list">
                <li *ngFor="let action of selectedActions()">
                  <strong>
                    {{ actionDomainLabel(action) | t }} · {{ actionLabel(action) | t }}
                  </strong>
                  <span class="assistant__confirm-status">{{
                    statusLabel(action.status) | t
                  }}</span>
                  <p
                    *ngIf="action.kind === 'household.update_task'"
                    class="assistant__action-summary"
                  >
                    {{
                      'ai_assistant.task_target'
                        | t
                          : {
                              title: action.executionTarget.snapshot.title,
                              date: action.executionTarget.snapshot.scheduledDate,
                              details: action.executionTarget.snapshot.details || '—'
                            }
                    }}
                  </p>
                  <p
                    *ngIf="action.kind === 'shopping.update_list'"
                    class="assistant__action-summary"
                    data-test="ai-assistant-shopping-target-confirm"
                  >
                    {{
                      'ai_assistant.shopping_list_target'
                        | t
                          : {
                              name: action.executionTarget.snapshot.name,
                              store: action.executionTarget.snapshot.store || '—'
                            }
                    }}
                  </p>
                  <p
                    *ngIf="action.kind === 'pantry.update_ingredient'"
                    class="assistant__action-summary"
                    data-test="ai-assistant-pantry-target-confirm"
                  >
                    {{
                      'ai_assistant.pantry_ingredient_target'
                        | t
                          : {
                              name: action.executionTarget.snapshot.name,
                              quantity: action.executionTarget.snapshot.quantity,
                              unit: action.executionTarget.snapshot.unit,
                              category: action.executionTarget.snapshot.category,
                              expirationDate: action.executionTarget.snapshot.expirationDate || '—',
                              location: pantryLocationLabel(
                                action.executionTarget.snapshot.location
                              ),
                              notes: action.executionTarget.snapshot.notes || '—'
                            }
                    }}
                  </p>
                  <dl class="assistant__confirm-fields" data-test="ai-assistant-confirm-fields">
                    <div
                      *ngFor="let field of editableFields(action); trackBy: trackField"
                      class="assistant__confirm-field"
                    >
                      <dt>{{ field.key | t }}</dt>
                      <dd>{{ confirmationFieldValue(field) }}</dd>
                    </div>
                    <ng-container *ngIf="action.kind === 'recipes.create_draft'">
                      <div class="assistant__confirm-field">
                        <dt>{{ 'ai_assistant.field.ingredients' | t }}</dt>
                        <dd>
                          <ul>
                            <li *ngFor="let ingredient of recipeIngredients(action)">
                              {{ ingredient.name }} — {{ ingredient.quantity }}
                              {{ ingredient.unit }}
                              <span *ngIf="ingredient.preparation">
                                ({{ ingredient.preparation }})
                              </span>
                            </li>
                          </ul>
                        </dd>
                      </div>
                      <div *ngFor="let level of recipeLevels" class="assistant__confirm-field">
                        <dt>
                          {{ 'ai_assistant.field.instructionsByLevel' | t }} —
                          {{ levelLabel(level) }}
                        </dt>
                        <dd>
                          <ol>
                            <li *ngFor="let step of recipeSteps(action, level)">
                              {{ step.instruction }}
                            </li>
                          </ol>
                        </dd>
                      </div>
                    </ng-container>
                  </dl>
                  <section
                    *ngIf="mealProposalFor(action.id) as mealPlan"
                    class="assistant__meal-confirmation"
                    data-test="ai-assistant-meals-confirmation"
                  >
                    <p>
                      {{
                        'ai_assistant.meals.confirm_summary'
                          | t: { count: confirmableMealCount(mealPlan), week: mealPlan.weekStart }
                      }}
                    </p>
                    <ul>
                      <li *ngFor="let event of mealPlan.events; trackBy: trackMealEvent">
                        {{ event.date }} · {{ mealTypeLabel(event.mealType) }} ·
                        {{ mealRecipeName(mealPlan, event) }} · {{ event.servings }}
                        {{ 'ai_assistant.meals.servings' | t }}
                      </li>
                    </ul>
                  </section>
                  <span
                    *ngIf="action.kind === 'calendar.create_event'"
                    class="assistant__confirm-status"
                  >
                    {{
                      action.payload.sharedWithHousehold
                        ? ('ai_assistant.event_shared' | t)
                        : ('ai_assistant.event_private' | t)
                    }}
                  </span>
                </li>
              </ul>
              <p *ngIf="errorKey() as errorMessageKey" class="assistant__error" role="alert">
                {{ errorMessageKey | t }}
              </p>
              <p
                *ngIf="executionMessage()"
                class="assistant__status"
                role="status"
                aria-live="polite"
              >
                {{ executionMessage()! | t: { count: completedCount() } }}
              </p>
            </section>
          }
        }
      }

      <div footer class="assistant__footer">
        <app-button
          variant="ghost"
          [touchTarget]="true"
          [disabled]="loading()"
          (onClick)="requestClose()"
        >
          {{ 'ai_assistant.close' | t }}
        </app-button>
        @switch (stage()) {
          @case ('compose') {
            <app-button
              variant="primary"
              [touchTarget]="true"
              [loading]="loading()"
              [disabled]="loading() || !prompt().trim()"
              data-test="ai-assistant-submit"
              (onClick)="propose()"
              >{{ 'ai_assistant.send' | t }}</app-button
            >
          }
          @case ('review') {
            <app-button
              variant="primary"
              [touchTarget]="true"
              [disabled]="!canContinue() || loading()"
              data-test="ai-assistant-continue"
              (onClick)="goToConfirmation()"
              >{{ 'ai_assistant.continue' | t }}</app-button
            >
          }
          @case ('refine') {
            <app-button
              variant="outline"
              [touchTarget]="true"
              [disabled]="loading()"
              (onClick)="cancelRefine()"
            >
              {{ 'ai_assistant.back_to_review' | t }}
            </app-button>
            <app-button
              variant="primary"
              [touchTarget]="true"
              [loading]="loading()"
              [disabled]="loading() || !refinementPrompt().trim()"
              (onClick)="refineCurrentAction()"
              >{{ 'ai_assistant.refine_submit' | t }}</app-button
            >
          }
          @case ('confirm') {
            <app-button variant="outline" [touchTarget]="true" (onClick)="returnToReview()">
              {{ 'ai_assistant.back_to_review' | t }}
            </app-button>
            <app-button
              variant="primary"
              [touchTarget]="true"
              [loading]="loading()"
              [disabled]="loading() || !canExecuteSelected()"
              data-test="ai-assistant-confirm-submit"
              (onClick)="executeSelected()"
              >{{ 'ai_assistant.confirm_action' | t }}</app-button
            >
          }
        }
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        --primary: var(--color-primary-700);
        --primary-dark: var(--color-primary-800);
      }

      .assistant__compose,
      .assistant__review,
      .assistant__refine,
      .assistant__confirm {
        display: grid;
        gap: var(--space-4);
        min-width: 0;
      }

      .assistant__intro h2,
      .assistant__stage-heading h2,
      .assistant__refine h2,
      .assistant__confirm h2 {
        margin: 0;
        color: var(--text-primary);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        line-height: var(--leading-tight);
      }

      .assistant__intro p,
      .assistant__refine > p,
      .assistant__confirm > p {
        margin: var(--space-2) 0 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
      }

      .assistant__voice-note,
      .assistant__questions {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        color: var(--text-primary);
      }

      .assistant__voice-note > div {
        min-width: 0;
      }

      .assistant__voice-note strong,
      .assistant__summary-label {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }

      .assistant__voice-note p,
      .assistant__questions p {
        margin: var(--space-1) 0 0;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }

      .assistant__consent {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
        min-height: 44px;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }

      .assistant__consent input,
      .assistant__field input[type='checkbox'] {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        margin: 0;
        accent-color: var(--primary);
      }

      .assistant__input-group,
      .assistant__field {
        display: grid;
        gap: var(--space-2);
        min-width: 0;
      }

      .assistant__input-group > label,
      .assistant__field > span,
      .assistant__refine > label {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .assistant__input-group textarea,
      .assistant__refine textarea,
      .assistant__field input,
      .assistant__field textarea,
      .assistant__field select {
        box-sizing: border-box;
        width: 100%;
        min-height: var(--button-control-height);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        padding: var(--space-3);
        font: inherit;
        font-size: var(--text-sm);
      }

      .assistant__input-group textarea,
      .assistant__refine textarea,
      .assistant__field textarea {
        min-height: 76px;
        resize: vertical;
        line-height: var(--leading-normal);
      }

      .assistant__input-group textarea:focus-visible,
      .assistant__refine textarea:focus-visible,
      .assistant__field input:focus-visible,
      .assistant__field textarea:focus-visible,
      .assistant__field select:focus-visible,
      .assistant__consent input:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .assistant__input-meta,
      .assistant__selection-tools,
      .assistant__selection-tools > div,
      .assistant__action-header,
      .assistant__action-controls,
      .assistant__stage-heading,
      .assistant__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        min-width: 0;
      }

      .assistant__counter,
      .assistant__hint,
      .assistant__selection-tools,
      .assistant__summary-label {
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }

      .assistant__counter {
        flex: 0 0 auto;
        font-variant-numeric: tabular-nums;
      }

      .assistant__voice-controls,
      .assistant__footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-2);
      }

      .assistant__status,
      .assistant__error,
      .assistant__empty {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: 0;
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
      }

      .assistant__status {
        color: var(--text-secondary);
      }

      .assistant__error,
      .assistant__field-error {
        color: var(--error);
      }

      .assistant__spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--border-default);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: assistant-spin 0.7s linear infinite;
      }

      .assistant__stage-heading {
        align-items: flex-start;
      }

      .assistant__summary-label {
        display: block;
        margin: var(--space-3) 0 var(--space-1);
      }

      .assistant__summary,
      .assistant__action-summary {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-normal);
        overflow-wrap: anywhere;
      }

      .assistant__questions {
        display: block;
        border-color: color-mix(in srgb, var(--warning) 45%, var(--border-default));
      }

      .assistant__questions h3 {
        margin: 0;
        font-size: var(--text-sm);
      }

      .assistant__questions ul {
        margin: var(--space-2) 0 0;
        padding-left: var(--space-5);
        color: var(--text-primary);
        font-size: var(--text-sm);
      }

      .assistant__selection-tools {
        flex-wrap: wrap;
        padding-bottom: var(--space-2);
        border-bottom: 1px solid var(--border-default);
      }

      .assistant__selection-tools > div {
        flex-wrap: wrap;
      }

      .assistant__group-tools {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
        min-width: 0;
        padding-bottom: var(--space-2);
      }

      .assistant__group-tools > span {
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .assistant__actions {
        display: grid;
        gap: var(--space-3);
        min-width: 0;
      }

      .assistant__action {
        display: grid;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-primary);
      }

      .assistant__action--selected {
        border-color: color-mix(in srgb, var(--primary) 65%, var(--border-default));
        box-shadow: inset 3px 0 0 var(--primary);
      }

      .assistant__action-header {
        align-items: flex-start;
      }

      .assistant__action-controls {
        flex: 0 0 auto;
      }

      .assistant__status-tag {
        justify-self: start;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-full);
        background: var(--bg-secondary);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .assistant__warnings,
      .assistant__dependencies {
        margin: 0;
        padding-left: var(--space-5);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .assistant__details {
        border-top: 1px solid var(--border-default);
        padding-top: var(--space-2);
      }

      .assistant__details > summary {
        min-height: 44px;
        display: flex;
        align-items: center;
        color: var(--primary-dark);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        cursor: pointer;
      }

      .assistant__fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-3);
        padding-top: var(--space-3);
      }

      .assistant__meal-planner,
      .assistant__meal-confirmation {
        display: grid;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
      }

      .assistant__meal-planner h3,
      .assistant__meal-planner p,
      .assistant__meal-confirmation p {
        margin: 0;
      }

      .assistant__meal-participants {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-1) var(--space-3);
      }

      .assistant__meal-participants label {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: 44px;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .assistant__meal-preview,
      .assistant__meal-recipe {
        min-width: 0;
        padding-top: var(--space-2);
        border-top: 1px solid var(--border-default);
      }

      .assistant__meal-preview > summary,
      .assistant__meal-recipe > summary {
        min-height: 44px;
        display: flex;
        align-items: center;
        color: var(--primary-dark);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .assistant__meal-preview ol,
      .assistant__meal-confirmation ul {
        display: grid;
        gap: var(--space-3);
        margin: var(--space-2) 0 0;
        padding-left: var(--space-5);
      }

      .assistant__meal-preview li,
      .assistant__meal-recipe li {
        overflow-wrap: anywhere;
      }

      .assistant__meal-servings {
        max-width: 260px;
        margin-top: var(--space-2);
      }

      .assistant__meal-refinement {
        display: grid;
        gap: var(--space-2);
        min-width: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .assistant__meal-refinement textarea {
        width: 100%;
        min-height: 76px;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
        font-weight: var(--font-normal);
        line-height: var(--leading-normal);
        resize: vertical;
      }

      .assistant__meal-servings input:focus-visible,
      .assistant__meal-participants input:focus-visible,
      .assistant__meal-refinement textarea:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .assistant__field-error {
        font-size: var(--text-xs);
      }

      .assistant__recipe-section {
        display: grid;
        grid-column: 1 / -1;
        gap: var(--space-3);
        min-width: 0;
        margin: 0;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
      }

      .assistant__recipe-section legend,
      .assistant__recipe-level h4 {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }

      .assistant__recipe-row {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr 2fr;
        gap: var(--space-2);
        min-width: 0;
      }

      .assistant__recipe-level {
        display: grid;
        gap: var(--space-2);
      }

      .assistant__recipe-level h4 {
        margin: 0;
      }

      .assistant__refine-target {
        margin: 0 !important;
        padding: var(--space-3);
        border-left: 3px solid var(--primary);
        background: var(--bg-secondary);
        color: var(--text-primary) !important;
        overflow-wrap: anywhere;
      }

      .assistant__confirm-list {
        display: grid;
        gap: var(--space-3);
        margin: 0;
        padding-left: var(--space-5);
        color: var(--text-primary);
      }

      .assistant__confirm-fields {
        display: grid;
        gap: var(--space-2);
        margin: var(--space-2) 0 0;
      }

      .assistant__confirm-field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: var(--space-2);
        min-width: 0;
      }

      .assistant__confirm-field dt {
        color: var(--text-secondary);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
      }

      .assistant__confirm-field dd {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
      }

      .assistant__confirm-field ul,
      .assistant__confirm-field ol {
        margin: 0;
        padding-left: var(--space-4);
      }

      .assistant__confirm-status {
        display: block;
        margin-top: var(--space-1);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      @keyframes assistant-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 640px) {
        .assistant__stage-heading,
        .assistant__action-header {
          align-items: flex-start;
          flex-direction: column;
        }

        .assistant__fields,
        .assistant__recipe-row,
        .assistant__confirm-field,
        .assistant__meal-participants {
          grid-template-columns: minmax(0, 1fr);
        }

        .assistant__action-controls {
          width: 100%;
          justify-content: flex-start;
          flex-wrap: wrap;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .assistant__spinner {
          animation: none;
        }
      }
    `
  ]
})
export class AiActionAssistantDialogComponent implements OnDestroy {
  @ViewChild('stageHeading') private stageHeading?: ElementRef<HTMLElement>;

  @Input() routeHint: AssistantRouteHint | undefined;
  @Output() readonly dismiss = new EventEmitter<void>();

  private readonly assistant = inject(AiActionAssistantService);
  private readonly execution = inject(AiActionAssistantExecutionService);
  private readonly household = inject(HouseholdService);
  private readonly mealProposalService = inject(HouseholdMealProposalService);
  private readonly confirmService = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly pantry = inject(PantryService);
  private readonly injector = inject(Injector);
  private requestSubscription: Subscription | null = null;
  private mealRequestSubscriptions: Subscription[] = [];
  private recognition: SpeechRecognitionLike | null = null;

  readonly stage = signal<AssistantStage>('compose');
  readonly modalOpen = signal(true);
  readonly prompt = signal('');
  readonly promptError = signal<TranslationKey | null>(null);
  readonly plan = signal<AssistantActionPlan | null>(null);
  readonly loading = signal(false);
  readonly executing = signal(false);
  readonly errorKey = signal<TranslationKey | null>(null);
  readonly refinementPrompt = signal('');
  readonly refinementQuestions = signal<string[]>([]);
  readonly refiningActionId = signal<string | null>(null);
  readonly refiningActionIds = signal<string[]>([]);
  readonly refinementBatchScope = signal<AssistantBatchRefinementScope | null>(null);
  readonly refinementScopeValue = signal(ACTION_REFINEMENT_SCOPE);
  readonly voiceConsent = signal(false);
  readonly voiceState = signal<'idle' | 'listening' | 'paused' | 'error'>('idle');
  readonly voiceError = signal<TranslationKey | null>(null);
  readonly executionMessage = signal<TranslationKey | null>(null);
  readonly completedCount = signal(0);
  readonly mealParticipantSelections = signal<Record<string, string[]>>({});
  readonly mealProposals = signal<Record<string, HouseholdMealProposal>>({});
  readonly mealManualServings = signal<Record<string, Record<string, number>>>({});
  readonly mealRefinementInstructions = signal<Record<string, string>>({});
  readonly mealProposalLoading = signal<Record<string, boolean>>({});
  private proposalHouseholdId: string | null = null;

  readonly selectedActions = computed(
    () => this.plan()?.actions.filter((action) => action.selected) ?? []
  );
  readonly selectedCount = computed(() => this.selectedActions().length);
  readonly refinableActions = computed(
    () =>
      this.plan()?.actions.filter(
        (action) => action.status !== 'succeeded' && action.kind !== 'household.plan_meals'
      ) ?? []
  );
  readonly refinableDomains = computed(() => {
    const counts = new Map<AssistantAction['domain'], number>();
    for (const action of this.refinableActions()) {
      counts.set(action.domain, (counts.get(action.domain) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([domain]) => domain);
  });
  readonly refiningActions = computed(() => {
    const targetIds = new Set(this.refiningActionIds());
    return this.plan()?.actions.filter((action) => targetIds.has(action.id)) ?? [];
  });
  readonly refiningAction = computed(
    () => this.plan()?.actions.find((action) => action.id === this.refiningActionId()) ?? null
  );
  readonly voiceSupported = computed(() => Boolean(this.speechRecognitionConstructor()));
  readonly supportsPause = signal(false);
  readonly pantryUnitOptions: PickerOption[] = PANTRY_UNITS.map((value) => ({
    value,
    label: value
  }));
  readonly recipeLevels = ['basic', 'intermediate', 'expert'] as const;
  private bodyOverflowBeforeLock: string | null = null;

  constructor() {
    this.pantry.loadCategories();
    effect(() => {
      if (this.modalOpen()) this.lockBodyScroll();
      else this.restoreBodyScroll();
    });
  }

  ngOnDestroy(): void {
    this.requestSubscription?.unsubscribe();
    this.mealRequestSubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.cancelVoice();
    this.restoreBodyScroll();
  }

  updatePrompt(event: Event): void {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
    this.promptError.set(null);
    this.errorKey.set(null);
  }

  propose(): void {
    const prompt = this.prompt().trim();
    if (!prompt) {
      this.promptError.set('ai_assistant.prompt_required');
      return;
    }
    this.stopVoice();
    this.proposalHouseholdId = this.household.activeHouseholdId();
    this.errorKey.set(null);
    this.loading.set(true);
    this.requestSubscription = this.assistant
      .propose({ prompt, ...(this.routeHint ? { route: this.routeHint } : {}) })
      .subscribe({
        next: (plan) => {
          this.plan.set(plan);
          this.mealParticipantSelections.set(
            Object.fromEntries(
              plan.actions
                .filter((action) => action.kind === 'household.plan_meals')
                .map((action) => [action.id, []])
            )
          );
          this.mealProposals.set({});
          this.mealManualServings.set({});
          this.mealRefinementInstructions.set({});
          this.mealProposalLoading.set({});
          this.setStage('review');
          this.loading.set(false);
          this.requestSubscription = null;
        },
        error: (error: unknown) => {
          this.errorKey.set(this.mapError(error));
          this.loading.set(false);
          this.requestSubscription = null;
        }
      });
  }

  returnToCompose(): void {
    this.setStage('compose');
    this.errorKey.set(null);
  }

  returnToReview(): void {
    this.setStage('review');
  }

  selectAll(): void {
    this.updateActions((actions) => actions.map((action) => ({ ...action, selected: true })));
  }

  selectNone(): void {
    this.updateActions((actions) => actions.map((action) => ({ ...action, selected: false })));
  }

  setSelected(id: string, selected: boolean): void {
    this.updateActions((actions) =>
      actions.map((action) => (action.id === id ? { ...action, selected } : action))
    );
  }

  omitAction(id: string): void {
    if (this.hasDependents(id)) return;
    this.invalidateMealProposalDraft(id);
    this.updateActions((actions) => actions.filter((action) => action.id !== id));
  }

  hasDependents(id: string): boolean {
    return this.plan()?.actions.some((action) => action.dependsOn.includes(id)) ?? false;
  }

  hasUnselectedDependency(action: AssistantAction): boolean {
    const selectedIds = new Set(this.selectedActions().map((item) => item.id));
    const succeededIds = new Set(
      this.plan()
        ?.actions.filter((item) => item.status === 'succeeded')
        .map((item) => item.id) ?? []
    );
    return action.dependsOn.some((id) => !selectedIds.has(id) && !succeededIds.has(id));
  }

  actionTitle(id: string): string {
    return this.plan()?.actions.find((action) => action.id === id)?.title ?? id;
  }

  canContinue(): boolean {
    const selected = this.selectedActions();
    const currentPlan = this.plan();
    return Boolean(
      currentPlan &&
      selected.length > 0 &&
      currentPlan.questions.length === 0 &&
      selected.every(
        (action) =>
          (action.status === 'succeeded' ||
            (this.isActionValid(action) && this.isSpecializedProposalReady(action))) &&
          !this.hasUnselectedDependency(action)
      )
    );
  }

  mealParticipants(): HouseholdMember[] {
    const household = this.household.household();
    if (!this.proposalHouseholdId || household?.id !== this.proposalHouseholdId) return [];
    return household.members.filter(
      (member) => member.isActive && member.permissions?.calendar?.view === true
    );
  }

  selectedMealParticipantIds(actionId: string): string[] {
    return this.mealParticipantSelections()[actionId] ?? [];
  }

  isMealParticipantSelected(actionId: string, memberId: string): boolean {
    return this.selectedMealParticipantIds(actionId).includes(memberId);
  }

  toggleMealParticipant(actionId: string, memberId: string, checked: boolean): void {
    if (
      this.mealProposalBusy(actionId) ||
      !this.mealParticipants().some((member) => member.id === memberId)
    ) {
      return;
    }
    const current = new Set(this.selectedMealParticipantIds(actionId));
    if (checked) current.add(memberId);
    else current.delete(memberId);
    this.mealParticipantSelections.update((selections) => ({
      ...selections,
      [actionId]: [...current]
    }));
    this.invalidateMealProposalDraft(actionId);
  }

  mealProposalFor(actionId: string): HouseholdMealProposal | null {
    return this.mealProposals()[actionId] ?? null;
  }

  mealProposalBusy(actionId: string): boolean {
    return this.mealProposalLoading()[actionId] === true;
  }

  mealRefinementText(actionId: string): string {
    return this.mealRefinementInstructions()[actionId] ?? '';
  }

  setMealRefinementText(actionId: string, value: string): void {
    this.mealRefinementInstructions.update((instructions) => ({
      ...instructions,
      [actionId]: value.slice(0, 1000)
    }));
  }

  canGenerateMealProposal(action: AssistantAction): boolean {
    return (
      action.kind === 'household.plan_meals' &&
      this.isActionValid(action) &&
      Boolean(this.proposalHouseholdId) &&
      this.household.activeHouseholdId() === this.proposalHouseholdId &&
      this.selectedMealParticipantIds(action.id).length > 0 &&
      !this.mealProposalBusy(action.id)
    );
  }

  generateMealProposal(action: AssistantAction): void {
    if (action.kind !== 'household.plan_meals') return;
    const householdId = this.proposalHouseholdId;
    const householdMemberIds = this.selectedMealParticipantIds(action.id);
    if (!householdMemberIds.length) {
      this.errorKey.set('ai_assistant.meals.error_members');
      return;
    }
    if (!this.canGenerateMealProposal(action) || !householdId) return;

    this.errorKey.set(null);
    this.setMealProposalLoading(action.id, true);
    const subscription = this.mealProposalService
      .createAssistantProposal(householdId, {
        weekStart: action.payload.weekStart,
        householdMemberIds,
        instructions: action.payload.instructions
      })
      .pipe(finalize(() => this.setMealProposalLoading(action.id, false)))
      .subscribe({
        next: (proposal) => {
          if (!this.isMealProposalResponseCurrent(action, proposal, householdMemberIds)) {
            this.errorKey.set('ai_assistant.meals.error_stale');
            return;
          }
          this.mealProposals.update((proposals) => ({ ...proposals, [action.id]: proposal }));
        },
        error: (error: unknown) => this.errorKey.set(this.mapError(error))
      });
    this.mealRequestSubscriptions.push(subscription);
  }

  canRefineMealProposal(action: AssistantAction): boolean {
    return (
      action.kind === 'household.plan_meals' &&
      this.isMealProposalCurrent(action) &&
      Boolean(this.mealRefinementText(action.id).trim()) &&
      !this.mealProposalBusy(action.id)
    );
  }

  refineMealProposal(action: AssistantAction): void {
    if (action.kind !== 'household.plan_meals' || !this.canRefineMealProposal(action)) return;
    const householdId = this.proposalHouseholdId;
    const proposal = this.mealProposalFor(action.id);
    if (!householdId || !proposal) return;

    this.errorKey.set(null);
    this.setMealProposalLoading(action.id, true);
    const subscription = this.mealProposalService
      .refineAssistantProposal(householdId, {
        proposalId: proposal.proposalId,
        weekStart: proposal.weekStart,
        householdMemberIds: [...this.selectedMealParticipantIds(action.id)],
        recipes: proposal.recipes,
        events: proposal.events,
        instructions: this.mealRefinementText(action.id).trim()
      })
      .pipe(finalize(() => this.setMealProposalLoading(action.id, false)))
      .subscribe({
        next: (refined) => {
          if (
            !this.isMealProposalResponseCurrent(
              action,
              refined,
              this.selectedMealParticipantIds(action.id)
            )
          ) {
            this.errorKey.set('ai_assistant.meals.error_stale');
            return;
          }
          const instruction = this.mealRefinementText(action.id).trim();
          const overrides = this.mealManualServings()[action.id] ?? {};
          const nextProposal = this.refinementChangesServings(instruction)
            ? refined
            : this.applyMealServingsOverrides(refined, overrides);
          this.mealProposals.update((proposals) => ({ ...proposals, [action.id]: nextProposal }));
          if (this.refinementChangesServings(instruction)) {
            this.mealManualServings.update((current) => ({ ...current, [action.id]: {} }));
          }
          this.setMealRefinementText(action.id, '');
        },
        error: (error: unknown) => this.errorKey.set(this.mapError(error))
      });
    this.mealRequestSubscriptions.push(subscription);
  }

  updateMealServings(
    actionId: string,
    event: HouseholdMealProposalEvent,
    input: HTMLInputElement
  ): void {
    const servings = Number(input.value);
    if (!Number.isInteger(servings) || servings < 1 || servings > 100) {
      input.value = String(event.servings);
      return;
    }
    this.mealProposals.update((proposals) => {
      const proposal = proposals[actionId];
      if (!proposal) return proposals;
      return {
        ...proposals,
        [actionId]: {
          ...proposal,
          events: proposal.events.map((candidate) =>
            candidate.id === event.id ? { ...candidate, servings } : candidate
          )
        }
      };
    });
    this.mealManualServings.update((overrides) => ({
      ...overrides,
      [actionId]: {
        ...(overrides[actionId] ?? {}),
        [this.mealEventIdentity(event)]: servings
      }
    }));
  }

  mealRecipe(
    proposal: HouseholdMealProposal,
    event: HouseholdMealProposalEvent
  ): HouseholdMealProposalRecipeReference | null {
    return event.recipeAlias
      ? (proposal.recipes.find((recipe) => recipe.alias === event.recipeAlias) ?? null)
      : null;
  }

  mealRecipeName(proposal: HouseholdMealProposal, event: HouseholdMealProposalEvent): string {
    return this.mealRecipe(proposal, event)?.recipe.name ?? '—';
  }

  mealTypeLabel(mealType: HouseholdMealType): string {
    const key: Record<HouseholdMealType, TranslationKey> = {
      breakfast: 'ai_assistant.meals.breakfast',
      lunch: 'ai_assistant.meals.lunch',
      dinner: 'ai_assistant.meals.dinner',
      snack: 'ai_assistant.meals.snack'
    };
    return this.i18n.t(key[mealType]);
  }

  confirmableMealCount(proposal: HouseholdMealProposal): number {
    return proposal.events.filter((event) => event.status === 'scheduled').length;
  }

  trackMember(_index: number, member: HouseholdMember): string {
    return member.id;
  }

  trackMealEvent(_index: number, event: HouseholdMealProposalEvent): string {
    return event.id;
  }

  canExecuteSelected(): boolean {
    return (
      this.canContinue() &&
      this.selectedActions().some((action) =>
        ['pending', 'failed', 'blocked'].includes(action.status)
      )
    );
  }

  private isSpecializedProposalReady(action: AssistantAction): boolean {
    return action.kind !== 'household.plan_meals' || this.isMealProposalCurrent(action);
  }

  private isMealProposalCurrent(action: AssistantAction): boolean {
    if (action.kind !== 'household.plan_meals') return false;
    const proposal = this.mealProposalFor(action.id);
    const selectedIds = this.selectedMealParticipantIds(action.id);
    if (
      !proposal ||
      !this.proposalHouseholdId ||
      this.household.activeHouseholdId() !== this.proposalHouseholdId ||
      proposal.weekStart !== action.payload.weekStart ||
      !this.sameIds(
        selectedIds,
        proposal.participants.map((member) => member.householdMemberId)
      ) ||
      this.confirmableMealCount(proposal) === 0
    ) {
      return false;
    }
    const aliases = new Set(proposal.participants.map((participant) => participant.alias));
    return proposal.events.every((event) =>
      event.status === 'unresolved'
        ? event.servings === 0 && event.recipeAlias === null
        : Number.isInteger(event.servings) &&
          event.servings >= 1 &&
          event.servings <= 100 &&
          Boolean(this.mealRecipe(proposal, event)) &&
          event.participantAliases.every((alias) => aliases.has(alias))
    );
  }

  private isMealProposalResponseCurrent(
    action: Extract<AssistantAction, { kind: 'household.plan_meals' }>,
    proposal: HouseholdMealProposal,
    expectedMemberIds: string[]
  ): boolean {
    return (
      this.household.activeHouseholdId() === this.proposalHouseholdId &&
      proposal.weekStart === action.payload.weekStart &&
      this.sameIds(expectedMemberIds, this.selectedMealParticipantIds(action.id)) &&
      this.sameIds(
        expectedMemberIds,
        proposal.participants.map((participant) => participant.householdMemberId)
      )
    );
  }

  private sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id) => right.includes(id));
  }

  private setMealProposalLoading(actionId: string, loading: boolean): void {
    this.mealProposalLoading.update((states) => ({ ...states, [actionId]: loading }));
  }

  private invalidateMealProposalDraft(actionId: string): void {
    this.mealProposals.update((proposals) => {
      if (!Object.prototype.hasOwnProperty.call(proposals, actionId)) return proposals;
      const next = { ...proposals };
      delete next[actionId];
      return next;
    });
    this.mealManualServings.update((overrides) => {
      if (!Object.prototype.hasOwnProperty.call(overrides, actionId)) return overrides;
      const next = { ...overrides };
      delete next[actionId];
      return next;
    });
    this.mealRefinementInstructions.update((instructions) => ({ ...instructions, [actionId]: '' }));
  }

  private mealEventIdentity(event: HouseholdMealProposalEvent): string {
    return JSON.stringify([event.date, event.mealType, [...event.participantAliases].sort()]);
  }

  private refinementChangesServings(instruction: string): boolean {
    return /\b(servings?|portions?|raciones?|porciones?)\b/i.test(instruction);
  }

  private applyMealServingsOverrides(
    proposal: HouseholdMealProposal,
    overrides: Record<string, number>
  ): HouseholdMealProposal {
    return {
      ...proposal,
      events: proposal.events.map((event) => {
        const servings = overrides[this.mealEventIdentity(event)];
        return event.status === 'scheduled' && servings !== undefined
          ? { ...event, servings }
          : event;
      })
    };
  }

  goToConfirmation(): void {
    if (this.canContinue()) this.setStage('confirm');
  }

  beginRefine(id: string): void {
    const action = this.plan()?.actions.find((candidate) => candidate.id === id);
    if (!action || action.status === 'succeeded') return;
    this.refiningActionId.set(id);
    this.refiningActionIds.set([id]);
    this.refinementBatchScope.set(null);
    this.refinementPrompt.set('');
    this.refinementScopeValue.set(ACTION_REFINEMENT_SCOPE);
    this.refinementQuestions.set([]);
    this.errorKey.set(null);
    this.setStage('refine');
  }

  beginBatchRefine(): void {
    const actions = this.refinableActions();
    if (actions.length < 2) return;
    this.refiningActionId.set(null);
    this.refiningActionIds.set(actions.map((action) => action.id));
    this.refinementBatchScope.set({ kind: 'batch' });
    this.refinementScopeValue.set(BATCH_REFINEMENT_SCOPE);
    this.refinementPrompt.set('');
    this.refinementQuestions.set([]);
    this.errorKey.set(null);
    this.setStage('refine');
  }

  beginGroupRefine(domain: AssistantAction['domain']): void {
    const actions = this.domainGroupActions(domain);
    if (actions.length < 2) return;
    this.refiningActionId.set(null);
    this.refiningActionIds.set(actions.map((action) => action.id));
    this.refinementBatchScope.set({ kind: 'group', domain });
    this.refinementScopeValue.set(GROUP_REFINEMENT_SCOPE);
    this.refinementPrompt.set('');
    this.refinementQuestions.set([]);
    this.errorKey.set(null);
    this.setStage('refine');
  }

  domainGroupActions(domain: AssistantAction['domain']): AssistantAction[] {
    return this.refinableActions().filter((action) => action.domain === domain);
  }

  groupRefineLabel(domain: AssistantAction['domain']): string {
    return this.i18n.t('ai_assistant.refine_group_button', {
      domain: this.i18n.t(DOMAIN_LABELS[domain])
    });
  }

  batchRefinementScopeLabel(): string {
    const scope = this.refinementBatchScope();
    const count = this.refiningActions().length;
    return scope?.kind === 'group'
      ? this.i18n.t('ai_assistant.refine_group_scope', {
          domain: this.i18n.t(DOMAIN_LABELS[scope.domain]),
          count
        })
      : this.i18n.t('ai_assistant.refine_batch_scope', { count });
  }

  cancelRefine(): void {
    this.setStage('review');
    this.refinementPrompt.set('');
    this.refinementQuestions.set([]);
    this.refiningActionId.set(null);
    this.refiningActionIds.set([]);
    this.refinementBatchScope.set(null);
    this.refinementScopeValue.set(ACTION_REFINEMENT_SCOPE);
    this.errorKey.set(null);
  }

  refinementScopeOptions(action: AssistantAction | null): PickerOption[] {
    const options: PickerOption[] = [
      {
        value: ACTION_REFINEMENT_SCOPE,
        label: this.i18n.t('ai_assistant.refine_scope_action')
      }
    ];
    if (!action) return options;

    const paths = this.editableFields(action).map((field) => ({
      path: field.path,
      label: this.i18n.t('ai_assistant.refine_scope_field', {
        field: this.i18n.t(field.key)
      })
    }));
    if (action.kind === 'recipes.create_draft') {
      paths.unshift(
        {
          path: ['recipe', 'ingredients'],
          label: this.i18n.t('ai_assistant.refine_scope_group', {
            field: this.i18n.t('ai_assistant.field.ingredients')
          })
        },
        {
          path: ['recipe', 'instructionsByLevel'],
          label: this.i18n.t('ai_assistant.refine_scope_group', {
            field: this.i18n.t('ai_assistant.field.instructionsByLevel')
          })
        }
      );
    }
    const seen = new Set<string>();
    for (const { path, label } of paths) {
      const value = JSON.stringify(path);
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label });
    }
    return options;
  }

  chooseRefinementScope(value: string | null): void {
    const action = this.refiningAction();
    const selectedValue = value ?? ACTION_REFINEMENT_SCOPE;
    if (
      action &&
      this.refinementScopeOptions(action).some((option) => option.value === selectedValue)
    ) {
      this.refinementScopeValue.set(selectedValue);
      this.refinementQuestions.set([]);
    }
  }

  refineCurrentAction(): void {
    const actions = this.refiningActions();
    const instruction = this.refinementPrompt().trim();
    if (!actions.length || !instruction) return;
    this.loading.set(true);
    this.errorKey.set(null);
    const batchScope = this.refinementBatchScope();
    if (batchScope) {
      this.requestSubscription = this.assistant
        .refineBatch({
          instruction,
          scope: batchScope,
          actions: actions.map((action) => ({
            actionId: action.id,
            action: this.toCandidate(action)
          }))
        })
        .subscribe({
          next: (result) => {
            const expectedIds = new Set(actions.map((action) => action.id));
            const replacementIds = result.replacements.map(({ actionId }) => actionId);
            if (
              result.questions.length > 0 ||
              result.replacements.length !== actions.length ||
              new Set(replacementIds).size !== replacementIds.length ||
              replacementIds.some((id) => !expectedIds.has(id))
            ) {
              this.refinementQuestions.set(result.questions);
              if (result.questions.length === 0) this.errorKey.set('ai_assistant.error_general');
              this.loading.set(false);
              this.requestSubscription = null;
              return;
            }

            const replacements = new Map(
              result.replacements.map(({ actionId, replacement }) => [actionId, replacement])
            );
            this.updateActions(
              (currentActions) =>
                currentActions.map((current) => {
                  const replacement = replacements.get(current.id);
                  return replacement ? this.applyRefinedAction(current, replacement) : current;
                }),
              result.summary,
              result.questions
            );
            this.finishRefinement();
          },
          error: (error: unknown) => {
            this.errorKey.set(this.mapError(error));
            this.loading.set(false);
            this.requestSubscription = null;
          }
        });
      return;
    }

    const action = actions[0];
    if (!action) {
      this.loading.set(false);
      return;
    }
    const candidate = this.toCandidate(action);
    const scope: AssistantActionRefinementScope =
      this.refinementScopeValue() === ACTION_REFINEMENT_SCOPE
        ? { kind: 'action' }
        : { kind: 'field', path: JSON.parse(this.refinementScopeValue()) };
    this.requestSubscription = this.assistant
      .refine({ actionId: action.id, instruction, action: candidate, scope })
      .subscribe({
        next: (result) => {
          if (!result.replacement) {
            this.refinementQuestions.set(result.questions);
            this.loading.set(false);
            this.requestSubscription = null;
            return;
          }
          this.updateActions(
            (currentActions) =>
              currentActions.map((current) =>
                current.id === action.id
                  ? this.applyRefinedAction(
                      current,
                      result.replacement as AssistantActionCandidate,
                      scope.kind === 'field' ? scope.path : undefined
                    )
                  : current
              ),
            result.summary,
            result.questions
          );
          this.finishRefinement();
        },
        error: (error: unknown) => {
          this.errorKey.set(this.mapError(error));
          this.loading.set(false);
          this.requestSubscription = null;
        }
      });
  }

  private finishRefinement(): void {
    this.setStage('review');
    this.refinementQuestions.set([]);
    this.refiningActionId.set(null);
    this.refiningActionIds.set([]);
    this.refinementBatchScope.set(null);
    this.refinementScopeValue.set(ACTION_REFINEMENT_SCOPE);
    this.loading.set(false);
    this.requestSubscription = null;
  }

  private applyRefinedAction(
    current: AssistantAction,
    replacement: AssistantActionCandidate,
    overrideManualPath?: Array<string | number>
  ): AssistantAction {
    let payload: unknown = replacement.payload;
    const manualFields = current.manualFields ?? [];
    for (const serializedPath of manualFields) {
      const path = JSON.parse(serializedPath) as Array<string | number>;
      if (overrideManualPath && this.pathStartsWith(path, overrideManualPath)) continue;
      const manualValue = this.readPath(current.payload, path);
      if (manualValue !== undefined) payload = this.writePath(payload, path, manualValue);
    }
    const remainingManualFields = manualFields.filter((serializedPath) => {
      if (!overrideManualPath) return true;
      const path = JSON.parse(serializedPath) as Array<string | number>;
      return !this.pathStartsWith(path, overrideManualPath);
    });
    return {
      ...current,
      ...replacement,
      id: current.id,
      domain: current.domain,
      actionType: current.actionType,
      payload,
      dependsOn: current.dependsOn,
      selected: current.selected,
      status: 'pending',
      manualFields: remainingManualFields
    } as AssistantAction;
  }

  editableFields(action: AssistantAction): AssistantField[] {
    switch (action.kind) {
      case 'pantry.add_ingredient':
        return [
          this.field('name', ['name'], action.payload.name, 'text', true),
          this.field('quantity', ['quantity'], action.payload.quantity, 'number', true),
          this.field(
            'unit',
            ['unit'],
            action.payload.unit,
            'select',
            true,
            PANTRY_UNITS.map((value) => ({ value, label: value }))
          ),
          this.field('category', ['category'], action.payload.category, 'text', true),
          this.field('expirationDate', ['expirationDate'], action.payload.expirationDate, 'date'),
          this.field('location', ['location'], action.payload.location, 'select', true, [
            { value: 'pantry', label: this.i18n.t('ai_assistant.location.pantry') },
            { value: 'fridge', label: this.i18n.t('ai_assistant.location.fridge') },
            { value: 'freezer', label: this.i18n.t('ai_assistant.location.freezer') },
            { value: 'counter', label: this.i18n.t('ai_assistant.location.counter') }
          ]),
          this.field('notes', ['notes'], action.payload.notes, 'textarea')
        ];
      case 'pantry.update_ingredient': {
        const { changes } = action.payload;
        const snapshot = action.executionTarget.snapshot;
        return [
          this.field(
            'name',
            ['changes', 'name'],
            changes.setName ? changes.name : snapshot.name,
            'text',
            true
          ),
          this.field(
            'category',
            ['changes', 'category'],
            changes.setCategory ? changes.category : snapshot.category,
            'select',
            true,
            this.pantryCategoryChoices(
              snapshot.category,
              changes.setCategory ? changes.category : null
            )
          ),
          this.field(
            'quantity',
            ['changes', 'quantity'],
            changes.setQuantity ? changes.quantity : snapshot.quantity,
            'number',
            true
          ),
          this.field(
            'unit',
            ['changes', 'unit'],
            changes.setUnit ? changes.unit : snapshot.unit,
            'select',
            true,
            PANTRY_UNITS.map((value) => ({ value, label: value }))
          ),
          this.field(
            'expirationDate',
            ['changes', 'expirationDate'],
            changes.setExpirationDate
              ? changes.expirationDate
              : (snapshot.expirationDate?.slice(0, 10) ?? null),
            'date'
          ),
          this.field(
            'location',
            ['changes', 'location'],
            changes.setLocation ? changes.location : snapshot.location,
            'select',
            false,
            [
              { value: 'pantry', label: this.i18n.t('ai_assistant.location.pantry') },
              { value: 'fridge', label: this.i18n.t('ai_assistant.location.fridge') },
              { value: 'freezer', label: this.i18n.t('ai_assistant.location.freezer') },
              { value: 'counter', label: this.i18n.t('ai_assistant.location.counter') }
            ]
          ),
          this.field(
            'notes',
            ['changes', 'notes'],
            changes.setNotes ? changes.notes : snapshot.notes,
            'textarea'
          )
        ];
      }
      case 'shopping.create_list':
        return [
          this.field('name', ['name'], action.payload.name, 'text', true),
          this.field('store', ['store'], action.payload.store, 'text')
        ];
      case 'shopping.update_list':
        return [
          this.field(
            'name',
            ['changes', 'name'],
            action.payload.changes.setName
              ? action.payload.changes.name
              : action.executionTarget.snapshot.name,
            'text',
            true
          ),
          this.field(
            'store',
            ['changes', 'store'],
            action.payload.changes.setStore
              ? action.payload.changes.store
              : action.executionTarget.snapshot.store,
            'text'
          )
        ];
      case 'shopping.add_item':
        return [
          this.field('listName', ['listName'], action.payload.listName, 'text', true),
          this.field('name', ['name'], action.payload.name, 'text', true),
          this.field('quantity', ['quantity'], action.payload.quantity, 'number'),
          this.field('unit', ['unit'], action.payload.unit, 'text'),
          this.field('category', ['category'], action.payload.category, 'text')
        ];
      case 'household.plan_meals':
        return [
          this.field('weekStart', ['weekStart'], action.payload.weekStart, 'date', true),
          this.field('instructions', ['instructions'], action.payload.instructions, 'textarea')
        ];
      case 'household.create_task':
        return [
          this.field('title', ['title'], action.payload.title, 'text', true),
          this.field('details', ['details'], action.payload.details, 'textarea'),
          this.field(
            'scheduledDate',
            ['scheduledDate'],
            action.payload.scheduledDate,
            'date',
            true
          ),
          this.field('spaceName', ['spaceName'], action.payload.spaceName, 'text'),
          this.field(
            'assignedMemberName',
            ['assignedMemberName'],
            action.payload.assignedMemberName,
            'text'
          )
        ];
      case 'household.update_task':
        return [
          this.field('title', ['changes', 'title'], action.payload.changes.title, 'text'),
          this.field('details', ['changes', 'details'], action.payload.changes.details, 'textarea'),
          this.field(
            'scheduledDate',
            ['changes', 'scheduledDate'],
            action.payload.changes.scheduledDate,
            'date'
          ),
          this.field(
            'spaceName',
            ['changes', 'spaceName'],
            action.payload.changes.spaceName,
            'text'
          ),
          this.field(
            'assignedMemberName',
            ['changes', 'assignedMemberName'],
            action.payload.changes.assignedMemberName,
            'text'
          )
        ];
      case 'calendar.create_event':
        return [
          this.field('title', ['title'], action.payload.title, 'text', true),
          this.field(
            'kind',
            ['kind'],
            action.payload.kind,
            'select',
            true,
            EVENT_KINDS.map(({ value, labelKey }) => ({ value, label: this.i18n.t(labelKey) }))
          ),
          this.field('date', ['date'], action.payload.date, 'date', true),
          this.field('startTime', ['startTime'], action.payload.startTime, 'time'),
          this.field('endTime', ['endTime'], action.payload.endTime, 'time'),
          this.field('allDay', ['allDay'], action.payload.allDay, 'checkbox'),
          this.field(
            'sharedWithHousehold',
            ['sharedWithHousehold'],
            action.payload.sharedWithHousehold,
            'checkbox'
          ),
          this.field('location', ['location'], action.payload.location, 'text'),
          this.field('notes', ['notes'], action.payload.notes, 'textarea')
        ];
      case 'recipes.create_draft': {
        const recipe = action.payload.recipe;
        return [
          this.field('name', ['recipe', 'name'], recipe.name, 'text', true),
          this.field(
            'description',
            ['recipe', 'description'],
            recipe.description,
            'textarea',
            true
          ),
          this.field(
            'difficulty',
            ['recipe', 'difficulty'],
            recipe.difficulty,
            'select',
            true,
            DIFFICULTIES.map(({ value, labelKey }) => ({ value, label: this.i18n.t(labelKey) }))
          ),
          this.field('cuisine', ['recipe', 'cuisine'], recipe.cuisine, 'text'),
          this.field('totalTime', ['recipe', 'totalTime'], recipe.totalTime, 'number', true),
          this.field('prepTime', ['recipe', 'prepTime'], recipe.prepTime, 'number', true),
          this.field('cookTime', ['recipe', 'cookTime'], recipe.cookTime, 'number', true),
          this.field('restTime', ['recipe', 'restTime'], recipe.restTime, 'number'),
          this.field('calories', ['recipe', 'calories'], recipe.calories, 'number'),
          this.field('tags', ['recipe', 'tags'], recipe.tags.join(', '), 'text')
        ];
      }
    }
  }

  recipeIngredients(action: AssistantAction): AIRecipeIngredient[] {
    return action.kind === 'recipes.create_draft' ? action.payload.recipe.ingredients : [];
  }

  recipeSteps(action: AssistantAction, level: (typeof this.recipeLevels)[number]): AIRecipeStep[] {
    return action.kind === 'recipes.create_draft'
      ? action.payload.recipe.instructionsByLevel[level]
      : [];
  }

  levelLabel(level: string): string {
    return level === 'basic'
      ? this.i18n.t('ai_assistant.level.basic')
      : level === 'intermediate'
        ? this.i18n.t('ai_assistant.level.intermediate')
        : this.i18n.t('ai_assistant.level.expert');
  }

  pantryLocationLabel(location: string | null): string {
    if (location === 'pantry') return this.i18n.t('ai_assistant.location.pantry');
    if (location === 'fridge') return this.i18n.t('ai_assistant.location.fridge');
    if (location === 'freezer') return this.i18n.t('ai_assistant.location.freezer');
    if (location === 'counter') return this.i18n.t('ai_assistant.location.counter');
    return location || '—';
  }

  confirmationFieldValue(field: AssistantField): string {
    if (field.value === null || field.value === '') return '—';
    if (typeof field.value === 'boolean') {
      return this.i18n.t(field.value ? 'ai_assistant.value.yes' : 'ai_assistant.value.no');
    }
    if (field.kind === 'select') {
      return (
        field.choices?.find((choice) => choice.value === String(field.value))?.label ??
        String(field.value)
      );
    }
    return String(field.value);
  }

  fieldError(action: AssistantAction, field: AssistantField): boolean {
    if (!field.required) return false;
    return field.value === null || field.value === undefined || String(field.value).trim() === '';
  }

  isActionValid(action: AssistantAction): boolean {
    if (this.editableFields(action).some((field) => this.fieldError(action, field))) return false;
    if (action.kind === 'pantry.add_ingredient') {
      return (
        action.payload.quantity > 0 &&
        action.payload.quantity <= 100000 &&
        action.payload.category.trim().length <= 64 &&
        (action.payload.expirationDate === null || this.isIsoDate(action.payload.expirationDate))
      );
    }
    if (action.kind === 'pantry.update_ingredient') {
      const { changes } = action.payload;
      const target = action.executionTarget;
      const changed =
        (changes.setName && changes.name !== target.snapshot.name) ||
        (changes.setCategory && changes.category !== target.snapshot.category) ||
        (changes.setQuantity && changes.quantity !== target.snapshot.quantity) ||
        (changes.setUnit && changes.unit !== target.snapshot.unit) ||
        (changes.setExpirationDate && changes.expirationDate !== target.snapshot.expirationDate) ||
        (changes.setLocation && changes.location !== target.snapshot.location) ||
        (changes.setNotes && changes.notes !== target.snapshot.notes);
      return (
        target.kind === 'pantry-ingredient' &&
        target.id.length > 0 &&
        this.comparablePantryName(action.payload.targetName) ===
          this.comparablePantryName(target.snapshot.name) &&
        changes.setName === (changes.name !== null) &&
        (changes.name === null ||
          (changes.name.trim().length > 0 && changes.name.trim().length <= 3000)) &&
        changes.setCategory === (changes.category !== null) &&
        (changes.category === null ||
          (changes.category.trim().length > 0 &&
            changes.category.trim().length <= 64 &&
            (!changes.setCategory ||
              changes.category === target.snapshot.category ||
              this.pantry.categories().some((category) => category.key === changes.category)))) &&
        changes.setQuantity === (changes.quantity !== null) &&
        (changes.quantity === null ||
          (Number.isFinite(changes.quantity) &&
            changes.quantity >= 0 &&
            changes.quantity <= 100000)) &&
        changes.setUnit === (changes.unit !== null) &&
        (changes.unit === null || PANTRY_UNITS.includes(changes.unit)) &&
        (changes.setExpirationDate || changes.expirationDate === null) &&
        (changes.expirationDate === null || this.isIsoDate(changes.expirationDate)) &&
        changes.setLocation === (changes.location !== null) &&
        (changes.location === null ||
          ['fridge', 'freezer', 'pantry', 'counter'].includes(changes.location)) &&
        (changes.setNotes || changes.notes === null) &&
        (changes.notes === null || changes.notes.length <= 500) &&
        changed
      );
    }
    if (action.kind === 'shopping.create_list') {
      return (
        action.payload.name.trim().length <= 80 &&
        (action.payload.store === null || action.payload.store.length <= 80)
      );
    }
    if (action.kind === 'shopping.update_list') {
      const { changes } = action.payload;
      const target = action.executionTarget;
      const nameChanged =
        changes.setName && changes.name !== null && changes.name !== target.snapshot.name;
      const storeChanged = changes.setStore && changes.store !== target.snapshot.store;
      return (
        target.kind === 'shopping-list' &&
        target.id.length > 0 &&
        target.version > 0 &&
        this.comparableName(action.payload.targetName) ===
          this.comparableName(target.snapshot.name) &&
        changes.setName === (changes.name !== null) &&
        (changes.setStore || changes.store === null) &&
        (changes.name === null ||
          (changes.name.trim().length > 0 && changes.name.trim().length <= 80)) &&
        (changes.store === null ||
          (changes.store.trim().length > 0 && changes.store.trim().length <= 80)) &&
        (nameChanged || storeChanged)
      );
    }
    if (action.kind === 'shopping.add_item') {
      return (
        action.payload.listName.trim().length <= 80 &&
        action.payload.name.trim().length <= 200 &&
        (action.payload.quantity === null ||
          (action.payload.quantity > 0 && action.payload.quantity <= 100000)) &&
        (action.payload.unit === null || action.payload.unit.length <= 48) &&
        (action.payload.category === null || action.payload.category.length <= 48)
      );
    }
    if (action.kind === 'household.plan_meals') {
      return (
        this.isIsoDate(action.payload.weekStart) &&
        new Date(`${action.payload.weekStart}T00:00:00.000Z`).getUTCDay() === 1 &&
        action.payload.instructions.length <= 1000
      );
    }
    if (action.kind === 'household.create_task') {
      return (
        this.isIsoDate(action.payload.scheduledDate) &&
        action.payload.title.trim().length <= 160 &&
        (action.payload.details === null || action.payload.details.length <= 500) &&
        (action.payload.spaceName === null || action.payload.spaceName.length <= 120) &&
        (action.payload.assignedMemberName === null ||
          action.payload.assignedMemberName.length <= 120)
      );
    }
    if (action.kind === 'household.update_task') {
      const { changes } = action.payload;
      const newDate = changes.scheduledDate ?? action.executionTarget.snapshot.scheduledDate;
      return (
        action.executionTarget.kind === 'household-task' &&
        this.isIsoDate(action.executionTarget.snapshot.scheduledDate) &&
        this.isIsoDate(newDate) &&
        this.mondayOf(newDate) === action.executionTarget.weekStart &&
        (changes.title === null || changes.title.trim().length <= 160) &&
        (changes.details === null || changes.details.length <= 500) &&
        (changes.spaceName === null || changes.spaceName.length <= 120) &&
        (changes.assignedMemberName === null || changes.assignedMemberName.length <= 120) &&
        Object.values(changes).some((value) => value !== null && value !== '')
      );
    }
    if (action.kind === 'calendar.create_event') {
      if (
        !this.isIsoDate(action.payload.date) ||
        action.payload.title.trim().length > 120 ||
        (action.payload.location !== null && action.payload.location.length > 120) ||
        (action.payload.notes !== null && action.payload.notes.length > 500) ||
        (action.payload.sharedWithHousehold && !this.proposalHouseholdId)
      ) {
        return false;
      }
      if (
        (action.payload.startTime !== null && !this.isValidTime(action.payload.startTime)) ||
        (action.payload.endTime !== null && !this.isValidTime(action.payload.endTime)) ||
        (action.payload.startTime &&
          action.payload.endTime &&
          action.payload.endTime < action.payload.startTime)
      )
        return false;
    }
    if (action.kind === 'recipes.create_draft') {
      const recipe = action.payload.recipe;
      return (
        recipe.name.trim().length <= 120 &&
        recipe.description.trim().length > 0 &&
        recipe.difficulty !== undefined &&
        Number.isInteger(recipe.totalTime) &&
        recipe.totalTime > 0 &&
        recipe.totalTime <= 1440 &&
        Number.isInteger(recipe.prepTime) &&
        recipe.prepTime > 0 &&
        recipe.prepTime <= 1440 &&
        Number.isInteger(recipe.cookTime) &&
        recipe.cookTime >= 0 &&
        recipe.cookTime <= 1440 &&
        (recipe.restTime === null ||
          (Number.isInteger(recipe.restTime) && recipe.restTime >= 0 && recipe.restTime <= 1440)) &&
        (recipe.calories === null || recipe.calories > 0) &&
        recipe.ingredients.length > 0 &&
        recipe.ingredients.length <= 80 &&
        recipe.instructionsByLevel.basic.length > 0 &&
        recipe.instructionsByLevel.intermediate.length > 0 &&
        recipe.instructionsByLevel.expert.length > 0 &&
        [
          ...recipe.instructionsByLevel.basic,
          ...recipe.instructionsByLevel.intermediate,
          ...recipe.instructionsByLevel.expert
        ].every((step) => Boolean(step.instruction.trim())) &&
        recipe.ingredients.every(
          (ingredient) =>
            ingredient.name.trim() &&
            ingredient.name.trim().length <= 120 &&
            ingredient.quantity > 0 &&
            ingredient.quantity <= 1000000
        )
      );
    }
    return true;
  }

  updateField(
    actionId: string,
    path: Array<string | number>,
    rawValue: string | number | boolean,
    kind?: AssistantFieldKind
  ): void {
    const currentAction = this.plan()?.actions.find((action) => action.id === actionId);
    if (
      currentAction?.kind === 'shopping.update_list' &&
      path[0] === 'changes' &&
      (path[1] === 'name' || path[1] === 'store')
    ) {
      const field = path[1];
      const rawText = typeof rawValue === 'string' ? rawValue : String(rawValue);
      const normalizedText = rawText.trim();
      const nextValue = field === 'store' && normalizedText === '' ? null : normalizedText;
      const beforeValue = currentAction.executionTarget.snapshot[field];
      const changed = nextValue !== beforeValue;
      const serializedPath = JSON.stringify(path);
      this.updateActions((actions) =>
        actions.map((action) => {
          if (action.id !== actionId || action.kind !== 'shopping.update_list') return action;
          const changes =
            field === 'name'
              ? {
                  ...action.payload.changes,
                  name: changed ? (nextValue as string) : null,
                  setName: changed
                }
              : {
                  ...action.payload.changes,
                  store: changed ? nextValue : null,
                  setStore: changed
                };
          return {
            ...action,
            payload: { ...action.payload, changes },
            manualFields: [...new Set([...(action.manualFields ?? []), serializedPath])]
          };
        })
      );
      return;
    }

    if (
      currentAction?.kind === 'pantry.update_ingredient' &&
      path[0] === 'changes' &&
      typeof path[1] === 'string' &&
      Object.prototype.hasOwnProperty.call(PANTRY_CHANGE_FLAGS, path[1])
    ) {
      const field = path[1] as PantryIngredientChangeField;
      let nextValue: AssistantFieldValue = rawValue;
      if (field === 'quantity') nextValue = rawValue === '' ? null : Number(rawValue);
      else if (field === 'expirationDate' || field === 'notes') {
        nextValue = rawValue === '' ? null : String(rawValue);
      } else {
        nextValue = String(rawValue).trim();
      }
      const beforeValue = currentAction.executionTarget.snapshot[field];
      const changed = nextValue !== beforeValue;
      const serializedPath = JSON.stringify(path);
      const flagPath = JSON.stringify(['changes', PANTRY_CHANGE_FLAGS[field]]);
      this.updateActions((actions) =>
        actions.map((action) => {
          if (action.id !== actionId || action.kind !== 'pantry.update_ingredient') return action;
          const changes = {
            ...action.payload.changes,
            [field]: changed ? nextValue : null,
            [PANTRY_CHANGE_FLAGS[field]]: changed
          };
          return {
            ...action,
            payload: { ...action.payload, changes },
            manualFields: [...new Set([...(action.manualFields ?? []), serializedPath, flagPath])]
          } as AssistantAction;
        })
      );
      return;
    }

    if (
      this.plan()?.actions.some(
        (action) => action.id === actionId && action.kind === 'household.plan_meals'
      )
    ) {
      this.invalidateMealProposalDraft(actionId);
    }
    let value: unknown = rawValue;
    if (kind === 'number') value = rawValue === '' ? null : Number(rawValue);
    if (
      rawValue === '' &&
      ((path[0] === 'expirationDate' && path.length === 1) ||
        ((path[0] === 'startTime' || path[0] === 'endTime') && path.length === 1) ||
        (path[0] === 'recipe' && path[1] === 'restTime'))
    ) {
      value = null;
    }
    if (rawValue === '' && path[0] === 'changes') value = null;
    if (path[0] === 'recipe' && path[1] === 'tags' && typeof rawValue === 'string') {
      value = rawValue
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    const serializedPath = JSON.stringify(path);
    this.updateActions((actions) =>
      actions.map((action) =>
        action.id === actionId
          ? ({
              ...action,
              payload: this.writePath(action.payload, path, value),
              manualFields: [...new Set([...(action.manualFields ?? []), serializedPath])]
            } as AssistantAction)
          : action
      )
    );
  }

  toggleRecipeIngredientOptional(actionId: string, index: number, checked: boolean): void {
    this.updateField(actionId, ['recipe', 'ingredients', index, 'isOptional'], checked);
  }

  statusLabel(status: AssistantActionStatus): TranslationKey {
    return STATUS_LABELS[status];
  }

  domainLabel(domain: AssistantAction['domain']): TranslationKey {
    return DOMAIN_LABELS[domain];
  }

  actionDomainLabel(action: AssistantAction): TranslationKey {
    return action.kind === 'household.plan_meals'
      ? 'ai_assistant.domain.meals'
      : this.domainLabel(action.domain);
  }

  actionLabel(action: AssistantAction): TranslationKey {
    return ACTION_LABELS[action.actionType];
  }

  fieldKey(key: AssistantFieldKey): TranslationKey {
    return FIELD_LABELS[key];
  }

  trackAction(_index: number, action: AssistantAction): string {
    return action.id;
  }

  trackField(_index: number, field: AssistantField): string {
    return field.path.join('.');
  }

  private field(
    key: AssistantFieldKey,
    path: Array<string | number>,
    value: AssistantFieldValue,
    kind: AssistantFieldKind,
    required = false,
    choices?: AssistantField['choices']
  ): AssistantField {
    return { key: this.fieldKey(key), path, value, kind, required, choices };
  }

  private updateActions(
    mutate: (actions: AssistantAction[]) => AssistantAction[],
    summary?: string,
    questions?: string[]
  ): void {
    const current = this.plan();
    if (!current) return;
    this.plan.set({
      ...current,
      ...(summary ? { summary } : {}),
      ...(questions ? { questions } : {}),
      actions: mutate(current.actions)
    });
  }

  private setActionStatus(id: string, status: AssistantActionStatus): void {
    this.updateActions((actions) =>
      actions.map((action) => (action.id === id ? { ...action, status } : action))
    );
  }

  private readPath(root: unknown, path: Array<string | number>): unknown {
    let current = root;
    for (const segment of path) {
      if (Array.isArray(current) && typeof segment === 'number' && segment < current.length) {
        current = current[segment];
      } else if (
        current !== null &&
        typeof current === 'object' &&
        typeof segment === 'string' &&
        Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }
    return current;
  }

  private pathStartsWith(path: Array<string | number>, prefix: Array<string | number>): boolean {
    return (
      prefix.length <= path.length && prefix.every((segment, index) => segment === path[index])
    );
  }

  private writePath(root: unknown, path: Array<string | number>, value: unknown): unknown {
    if (path.length === 0 || !root || typeof root !== 'object') return root;
    const [head, ...tail] = path;
    if (Array.isArray(root)) {
      const copy = [...root];
      const index = Number(head);
      copy[index] = tail.length ? this.writePath(copy[index], tail, value) : value;
      return copy;
    }
    const copy: Record<string, unknown> = { ...(root as Record<string, unknown>) };
    const key = String(head);
    copy[key] = tail.length ? this.writePath(copy[key], tail, value) : value;
    return copy;
  }

  private toCandidate(action: AssistantAction): AssistantActionCandidate {
    const {
      id: _id,
      domain: _domain,
      actionType: _actionType,
      selected: _selected,
      status: _status,
      manualFields: _manualFields,
      executionTarget: _executionTarget,
      ...candidate
    } = action;
    return { ...candidate, dependsOn: [] } as AssistantActionCandidate;
  }

  private isIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }

  private comparableName(value: string): string {
    return value.normalize('NFC').trim().toLocaleLowerCase();
  }

  private comparablePantryName(value: string): string {
    return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private pantryCategoryChoices(...keys: Array<string | null>): PickerOption[] {
    const options = new Map<string, PickerOption>();
    const label = (category: { key: string; name?: string | null } | string) =>
      pantryCategoryLabel(category, (key) => this.i18n.t(key));
    for (const category of this.pantry.categories()) {
      options.set(category.key, { value: category.key, label: label(category) });
    }
    for (const key of keys) {
      if (key && !options.has(key)) options.set(key, { value: key, label: label(key) });
    }
    return [...options.values()];
  }

  private mondayOf(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    const offset = (value.getUTCDay() + 6) % 7;
    value.setUTCDate(value.getUTCDate() - offset);
    return value.toISOString().slice(0, 10);
  }

  private isValidTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  private lockBodyScroll(): void {
    if (typeof document === 'undefined' || this.bodyOverflowBeforeLock !== null) return;
    this.bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  private restoreBodyScroll(): void {
    if (typeof document === 'undefined' || this.bodyOverflowBeforeLock === null) return;
    document.body.style.overflow = this.bodyOverflowBeforeLock;
    this.bodyOverflowBeforeLock = null;
  }

  private mapError(error: unknown): TranslationKey {
    if (error instanceof HttpErrorResponse) {
      const code = error.error?.code;
      if (code === 'AI_NOT_CONFIGURED') return 'ai_assistant.error_not_configured';
      if (code === 'AI_PROVIDER_NOT_CONFIGURED') return 'ai_assistant.error_not_configured';
      if (code === 'ASSISTANT_BUSY') return 'ai_assistant.error_busy';
      if (code === 'AI_TIMEOUT') return 'ai_assistant.error_timeout';
      if (code === 'AI_PROVIDER_TIMEOUT') return 'ai_assistant.error_timeout';
      if (code === 'INVALID_AI_RESULT') return 'ai_assistant.error_invalid';
      if (code === 'AI_PROVIDER_ERROR') return 'ai_assistant.error_provider';
      if (
        code === 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED' ||
        code === 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED'
      ) {
        return 'ai_assistant.error_permission';
      }
      if (
        code === 'HOUSEHOLD_CONTEXT_CHANGED' ||
        code === 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED' ||
        code === 'MEAL_PROPOSAL_RECIPE_CHANGED'
      ) {
        return 'ai_assistant.error_context_changed';
      }
    }
    return 'ai_assistant.error_general';
  }

  private speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;
    const voiceWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition ?? null;
  }

  setVoiceConsent(consented: boolean): void {
    this.voiceConsent.set(consented);
    if (!consented) {
      this.cancelVoice();
      this.voiceError.set(null);
    }
  }

  startVoice(): void {
    if (!this.voiceConsent()) return;
    const Recognition = this.speechRecognitionConstructor();
    if (!Recognition) {
      this.voiceError.set('ai_assistant.voice_unsupported');
      return;
    }
    this.voiceError.set(null);
    try {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.i18n.resolved() === 'es' ? 'es-ES' : 'en-GB';
      recognition.onresult = (event) => {
        if (this.recognition !== recognition || !this.voiceConsent()) return;
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? '')
          .join(' ')
          .trimStart();
        this.prompt.set(transcript);
      };
      recognition.onerror = (event) => {
        if (this.recognition !== recognition || !this.voiceConsent()) return;
        this.voiceError.set(
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'ai_assistant.voice_permission'
            : 'ai_assistant.voice_error'
        );
        this.voiceState.set('error');
        this.recognition = null;
      };
      recognition.onend = () => {
        if (this.voiceState() === 'listening' || this.voiceState() === 'paused') {
          this.voiceState.set('idle');
        }
        this.supportsPause.set(false);
        if (this.recognition === recognition) this.recognition = null;
      };
      this.recognition = recognition;
      this.supportsPause.set(Boolean(recognition.pause && recognition.resume));
      recognition.start();
      this.voiceState.set('listening');
    } catch {
      this.voiceError.set('ai_assistant.voice_permission');
      this.voiceState.set('error');
      this.recognition = null;
    }
  }

  stopVoice(): void {
    if (!this.recognition) return;
    const recognition = this.recognition;
    this.recognition = null;
    this.voiceState.set('idle');
    recognition.stop();
  }

  pauseVoice(): void {
    this.recognition?.pause?.();
    if (this.recognition?.pause) this.voiceState.set('paused');
  }

  resumeVoice(): void {
    this.recognition?.resume?.();
    if (this.recognition?.resume) this.voiceState.set('listening');
  }

  cancelVoice(): void {
    const recognition = this.recognition;
    this.recognition = null;
    this.voiceState.set('idle');
    this.supportsPause.set(false);
    recognition?.abort();
  }

  private setStage(stage: AssistantStage): void {
    this.stage.set(stage);
    afterNextRender(() => this.stageHeading?.nativeElement.focus(), {
      injector: this.injector
    });
  }

  async requestClose(): Promise<void> {
    this.cancelVoice();
    if (!this.prompt().trim() && !this.plan()) {
      this.modalOpen.set(false);
      this.dismiss.emit();
      return;
    }
    const hasExecutionResults =
      this.plan()?.actions.some((action) => action.status !== 'pending') ?? false;
    this.modalOpen.set(false);
    const discard = await this.confirmService.confirm({
      title: this.i18n.t(
        hasExecutionResults
          ? 'ai_assistant.close_after_execution_title'
          : 'ai_assistant.discard_title'
      ),
      message: this.i18n.t(
        hasExecutionResults
          ? 'ai_assistant.close_after_execution_copy'
          : 'ai_assistant.discard_copy'
      ),
      confirmText: this.i18n.t(
        hasExecutionResults ? 'ai_assistant.close_action' : 'ai_assistant.discard_action'
      ),
      cancelText: this.i18n.t('ai_assistant.cancel'),
      variant: hasExecutionResults ? 'primary' : 'danger'
    });
    if (discard) {
      this.requestSubscription?.unsubscribe();
      this.mealRequestSubscriptions.forEach((subscription) => subscription.unsubscribe());
      this.dismiss.emit();
    } else {
      this.modalOpen.set(true);
    }
  }

  async executeSelected(): Promise<void> {
    if (!this.canExecuteSelected() || this.executing()) return;
    this.errorKey.set(null);
    this.loading.set(true);
    this.executing.set(true);
    let hadFailure = false;

    try {
      for (const action of this.selectedActions()) {
        if (!['pending', 'failed', 'blocked'].includes(action.status)) continue;
        const dependencies = action.dependsOn.map(
          (id) => this.plan()?.actions.find((candidate) => candidate.id === id) ?? null
        );
        if (dependencies.some((dependency) => dependency?.status !== 'succeeded')) {
          this.setActionStatus(action.id, 'blocked');
          hadFailure = true;
          continue;
        }

        try {
          await this.execution.execute(
            action,
            this.proposalHouseholdId,
            action.kind === 'household.plan_meals'
              ? (this.mealProposalFor(action.id) ?? undefined)
              : undefined
          );
          this.setActionStatus(action.id, 'succeeded');
        } catch (error) {
          this.setActionStatus(action.id, 'failed');
          this.errorKey.set(this.mapExecutionError(error));
          hadFailure = true;
        }
      }

      this.completedCount.set(
        this.selectedActions().filter((action) => action.status === 'succeeded').length
      );
      this.executionMessage.set(
        hadFailure ? 'ai_assistant.execution_partial' : 'ai_assistant.execution_complete'
      );
    } finally {
      this.loading.set(false);
      this.executing.set(false);
    }
  }

  private mapExecutionError(error: unknown): TranslationKey {
    if (error instanceof Error) {
      if (error.message === 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED') {
        return 'ai_assistant.error_context_changed';
      }
      if (error.message === 'ASSISTANT_ACTION_ALREADY_ATTEMPTED') {
        return 'ai_assistant.error_no_retry';
      }
      if (error.message === 'ASSISTANT_ACTION_PAYLOAD_CHANGED_AFTER_ATTEMPT') {
        return 'ai_assistant.error_action_changed_after_attempt';
      }
      if (error.message === 'ASSISTANT_SHOPPING_LIST_NOT_UNIQUE') {
        return 'ai_assistant.error_list_ambiguous';
      }
      if (error.message === 'ASSISTANT_TASK_SPACE_NOT_UNIQUE') {
        return 'ai_assistant.error_space_ambiguous';
      }
      if (error.message === 'ASSISTANT_TASK_MEMBER_NOT_UNIQUE') {
        return 'ai_assistant.error_member_ambiguous';
      }
      if (error.message === 'ASSISTANT_TASK_ID_CONFLICT') {
        return 'ai_assistant.error_task_conflict';
      }
      if (error.message === 'ASSISTANT_TASK_STALE' || error.message === 'TASK_TARGET_CHANGED') {
        return 'ai_assistant.error_task_stale';
      }
      if (error.message === 'ASSISTANT_TASK_CROSS_WEEK') {
        return 'ai_assistant.error_task_cross_week';
      }
    }
    const httpError =
      error instanceof HttpErrorResponse
        ? error
        : ((error as { original?: HttpErrorResponse } | null)?.original ?? null);
    if (httpError?.error?.code === 'ASSISTANT_INGREDIENT_STALE') {
      return 'ai_assistant.error_ingredient_stale';
    }
    if (httpError?.error?.code === 'ASSISTANT_INGREDIENT_NAME_CONFLICT') {
      return 'ai_assistant.error_ingredient_name_conflict';
    }
    if (httpError?.status === 403) return 'ai_assistant.error_permission';
    if (httpError && httpError.status >= 400 && httpError.status < 500) {
      return 'ai_assistant.error_domain_rejected';
    }
    return 'ai_assistant.error_execution_uncertain';
  }
}
