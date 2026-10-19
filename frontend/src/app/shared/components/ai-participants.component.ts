import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from './ui/icon/icon.component';
import type { AIGuestPreferences } from '../models/ai-config.model';
import type { HouseholdMember } from '../models/household.model';

type GuestListField = 'allergies' | 'intolerances' | 'diets' | 'likes' | 'dislikes';
interface PreferencePreset {
  value: string;
  emoji: string;
  labelKey: TranslationKey;
}

const FIELD_LABELS: Record<GuestListField, TranslationKey> = {
  allergies: 'ai_participants.allergies',
  intolerances: 'ai_participants.intolerances',
  diets: 'ai_participants.diets',
  likes: 'ai_participants.likes',
  dislikes: 'ai_participants.dislikes'
};

const PREFERENCE_PRESETS: Record<GuestListField, readonly PreferencePreset[]> = {
  allergies: [
    { value: 'gluten', emoji: '🌾', labelKey: 'ai_participants.preset_gluten' },
    { value: 'crustáceos', emoji: '🦐', labelKey: 'ai_participants.preset_crustaceans' },
    { value: 'huevo', emoji: '🥚', labelKey: 'ai_participants.preset_egg' },
    { value: 'pescado', emoji: '🐟', labelKey: 'ai_participants.preset_fish' },
    { value: 'cacahuetes', emoji: '🥜', labelKey: 'ai_participants.preset_peanuts' },
    { value: 'soja', emoji: '🫘', labelKey: 'ai_participants.preset_soy' },
    { value: 'leche', emoji: '🥛', labelKey: 'ai_participants.preset_milk' },
    { value: 'frutos secos', emoji: '🌰', labelKey: 'ai_participants.preset_tree_nuts' },
    { value: 'sésamo', emoji: '🌱', labelKey: 'ai_participants.preset_sesame' }
  ],
  intolerances: [
    { value: 'lactosa', emoji: '🥛', labelKey: 'ai_participants.preset_lactose' },
    { value: 'fructosa', emoji: '🍎', labelKey: 'ai_participants.preset_fructose' },
    { value: 'histamina', emoji: '🍷', labelKey: 'ai_participants.preset_histamine' },
    { value: 'gluten', emoji: '🌾', labelKey: 'ai_participants.preset_gluten' }
  ],
  diets: [
    { value: 'vegetariana', emoji: '🥕', labelKey: 'ai_participants.preset_vegetarian' },
    { value: 'vegana', emoji: '🌱', labelKey: 'ai_participants.preset_vegan' },
    { value: 'sin gluten', emoji: '🌾', labelKey: 'ai_participants.preset_gluten_free' },
    { value: 'sin lactosa', emoji: '🥛', labelKey: 'ai_participants.preset_lactose_free' },
    { value: 'pescetariana', emoji: '🐟', labelKey: 'ai_participants.preset_pescatarian' },
    { value: 'halal', emoji: '☪️', labelKey: 'ai_participants.preset_halal' },
    { value: 'kosher', emoji: '✡️', labelKey: 'ai_participants.preset_kosher' }
  ],
  likes: [
    { value: 'verduras', emoji: '🥦', labelKey: 'ai_participants.preset_vegetables' },
    { value: 'legumbres', emoji: '🫘', labelKey: 'ai_participants.preset_legumes' },
    { value: 'pescado', emoji: '🐟', labelKey: 'ai_participants.preset_fish' },
    { value: 'picante', emoji: '🌶️', labelKey: 'ai_participants.preset_spicy' },
    { value: 'ajo', emoji: '🧄', labelKey: 'ai_participants.preset_garlic' },
    { value: 'cítricos', emoji: '🍋', labelKey: 'ai_participants.preset_citrus' },
    { value: 'mediterránea', emoji: '🫒', labelKey: 'ai_participants.preset_mediterranean' }
  ],
  dislikes: [
    { value: 'cilantro', emoji: '🌿', labelKey: 'ai_participants.preset_cilantro' },
    { value: 'cebolla', emoji: '🧅', labelKey: 'ai_participants.preset_onion' },
    { value: 'ajo', emoji: '🧄', labelKey: 'ai_participants.preset_garlic' },
    { value: 'champiñones', emoji: '🍄', labelKey: 'ai_participants.preset_mushrooms' },
    { value: 'picante', emoji: '🌶️', labelKey: 'ai_participants.preset_spicy' },
    { value: 'pescado', emoji: '🐟', labelKey: 'ai_participants.preset_fish' },
    { value: 'texturas cremosas', emoji: '🥣', labelKey: 'ai_participants.preset_creamy' }
  ]
};

const EMPTY_GUEST: AIGuestPreferences = {
  allergies: [],
  intolerances: [],
  diets: [],
  likes: [],
  dislikes: [],
  notes: ''
};

@Component({
  selector: 'app-ai-participants',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <fieldset class="participants" data-test="ai-participants">
      <legend>{{ 'ai_participants.title' | t }}</legend>
      <p class="participants__safety-note" role="note" data-test="ai-participants-safety-note">
        {{ 'ai_participants.safety_note' | t }}
      </p>

      <div *ngIf="activeMembers.length > 0" class="participants__members">
        <span class="participants__label">{{ 'ai_participants.members' | t }}</span>
        <p class="participants__hint">{{ 'ai_participants.select_members' | t }}</p>
        <label
          *ngFor="let member of activeMembers; trackBy: trackMember"
          class="participants__member"
        >
          <input
            type="checkbox"
            [checked]="selectedMemberIds.includes(member.id)"
            [attr.data-test]="'ai-member-' + member.id"
            (change)="toggleMember(member.id, $any($event.target).checked)"
          />
          <span>{{ member.name }}</span>
        </label>
      </div>

      <p *ngIf="activeMembers.length === 0" class="participants__hint">
        {{ 'ai_participants.no_household' | t }}
      </p>

      <div class="participants__guest-heading">
        <span class="participants__label">{{ 'ai_participants.guests' | t }}</span>
        <button
          type="button"
          class="participants__add"
          [disabled]="guests.length >= 8"
          data-test="ai-add-guest"
          (click)="addGuest()"
        >
          {{ 'ai_participants.add_guest' | t }}
        </button>
      </div>

      <article
        *ngFor="let guest of guests; let index = index; trackBy: trackGuest"
        class="participants__guest"
        [attr.data-test]="'ai-guest-' + index"
      >
        <div class="participants__guest-title">
          <strong>{{ 'ai_participants.guest_number' | t: { number: index + 1 } }}</strong>
          <button
            type="button"
            class="participants__remove"
            [attr.aria-label]="'ai_participants.remove_guest' | t"
            [attr.data-test]="'ai-remove-guest-' + index"
            (click)="removeGuest(index)"
          >
            {{ 'ai_participants.remove_guest' | t }}
          </button>
        </div>
        <div class="participants__fields">
          <div *ngFor="let field of listFields" class="participants__field">
            <span [id]="preferenceLabelId(index, field)" class="participants__field-label">
              {{ fieldLabel(field) | t }}
              <span
                *ngIf="field === 'allergies' || field === 'intolerances'"
                class="participants__strict"
                >{{ 'ai_participants.strict' | t }}</span
              >
            </span>
            <div
              class="preference__selected"
              role="group"
              [attr.aria-labelledby]="preferenceLabelId(index, field)"
            >
              <ng-container *ngFor="let value of guest[field]">
                <button
                  type="button"
                  class="preference__chip"
                  [attr.aria-label]="
                    'ai_participants.remove_preference' | t: { value: preferenceText(field, value) }
                  "
                  [attr.data-test]="'ai-guest-' + index + '-' + field + '-selected'"
                  (click)="removePreference(index, field, value)"
                >
                  <ng-container *ngIf="presetFor(field, value) as preset; else customPreference">
                    {{ preset.emoji }} {{ preset.labelKey | t }}
                  </ng-container>
                  <ng-template #customPreference
                    ><app-icon name="star" [size]="14" [label]="null" /> {{ value }}</ng-template
                  >
                  <span aria-hidden="true">×</span>
                </button>
              </ng-container>
              <span *ngIf="guest[field].length === 0" class="participants__empty-choice">
                {{ 'ai_participants.none_selected' | t }}
              </span>
            </div>
            <button
              type="button"
              class="preference__toggle"
              [attr.aria-expanded]="isPickerOpen(index, field)"
              [attr.aria-controls]="
                isPickerOpen(index, field) ? preferencePickerId(index, field) : null
              "
              [attr.data-test]="'ai-guest-' + index + '-' + field + '-toggle'"
              (click)="togglePicker(index, field)"
            >
              {{
                (isPickerOpen(index, field)
                  ? 'ai_participants.close_choices'
                  : 'ai_participants.choose'
                ) | t
              }}
            </button>
            <div
              *ngIf="isPickerOpen(index, field)"
              [id]="preferencePickerId(index, field)"
              class="preference__picker"
              role="group"
              [attr.aria-labelledby]="preferenceLabelId(index, field)"
              [attr.data-test]="'ai-guest-' + index + '-' + field + '-picker'"
            >
              <div class="preference__options">
                <button
                  *ngFor="let option of presetOptions(field)"
                  type="button"
                  class="preference__option"
                  [attr.aria-pressed]="guest[field].includes(option.value)"
                  [disabled]="guest[field].length >= 20 && !guest[field].includes(option.value)"
                  [attr.data-test]="
                    'ai-guest-' + index + '-' + field + '-option-' + presetId(option.value)
                  "
                  (click)="togglePreference(index, field, option.value)"
                >
                  {{ option.emoji }} {{ option.labelKey | t }}
                </button>
              </div>
              <div class="preference__custom">
                <input
                  type="text"
                  maxlength="60"
                  [ngModel]="customDraft(index, field)"
                  [ngModelOptions]="{ standalone: true }"
                  [attr.aria-label]="'ai_participants.custom_placeholder' | t"
                  [attr.data-test]="'ai-guest-' + index + '-' + field + '-custom-input'"
                  (ngModelChange)="setCustomDraft(index, field, $event)"
                  (keydown.enter)="addCustomPreference(index, field); $event.preventDefault()"
                />
                <button
                  type="button"
                  class="participants__add-custom"
                  [disabled]="!customDraft(index, field).trim() || guest[field].length >= 20"
                  [attr.data-test]="'ai-guest-' + index + '-' + field + '-custom-add'"
                  (click)="addCustomPreference(index, field)"
                >
                  {{ 'ai_participants.add_custom' | t }}
                </button>
              </div>
              <p *ngIf="guest[field].length >= 20" class="participants__hint">
                {{ 'ai_participants.preference_limit' | t }}
              </p>
            </div>
          </div>
          <label class="participants__field participants__field--notes">
            <span>{{ 'ai_participants.notes' | t }}</span>
            <textarea
              rows="2"
              maxlength="300"
              [ngModel]="guest.notes"
              [ngModelOptions]="{ standalone: true }"
              [attr.aria-label]="'ai_participants.notes' | t"
              [attr.data-test]="'ai-guest-' + index + '-notes'"
              (ngModelChange)="updateNotes(index, $event)"
            ></textarea>
            <span class="participants__hint">{{ 'ai_participants.notes_hint' | t }}</span>
          </label>
        </div>
      </article>
    </fieldset>
  `,
  styles: [
    `
      .participants {
        min-width: 0;
        margin: 0;
        padding: 12px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
      }

      .participants legend,
      .participants__label {
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }

      .participants__safety-note {
        margin: 4px 0 12px;
        padding: 8px 10px;
        border-left: 2px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-tertiary);
        color: var(--text-primary);
        font-size: var(--text-xs);
      }

      .participants__members,
      .participants__guest-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
      }

      .participants__hint {
        flex-basis: 100%;
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .participants__member {
        display: inline-flex;
        min-height: 36px;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        font-size: var(--text-sm);
      }

      .participants__guest-heading {
        justify-content: space-between;
        margin-top: 12px;
      }

      .participants__add,
      .participants__remove {
        min-height: 36px;
        padding: 6px 10px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        font: inherit;
      }

      .participants__add:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .participants__guest {
        margin-top: 8px;
        padding: 10px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
      }

      .participants__guest-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-size: var(--text-sm);
      }

      .participants__fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 12px;
      }

      .participants__list-hint {
        grid-column: 1 / -1;
      }

      .participants__field {
        display: grid;
        min-width: 0;
        gap: 4px;
        font-size: var(--text-xs);
      }

      .participants__field textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 36px;
        padding: 7px 9px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .participants__field textarea {
        resize: vertical;
      }

      .participants__field-label {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-primary);
      }

      .participants__strict {
        color: var(--error);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
      }

      .preference__selected,
      .preference__options,
      .preference__custom {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }

      .preference__selected {
        min-height: 30px;
      }

      .participants__empty-choice {
        color: var(--text-tertiary);
      }

      .preference__toggle {
        justify-self: start;
        min-height: 36px;
        padding: 4px 8px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        font: inherit;
      }

      .preference__picker {
        display: grid;
        gap: 8px;
        padding: 8px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-tertiary);
      }

      .preference__chip,
      .preference__option,
      .participants__add-custom {
        min-height: 36px;
        padding: 5px 8px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        font: inherit;
      }

      .preference__chip,
      .preference__option[aria-pressed='true'] {
        border-color: var(--primary);
        background: var(--primary-subtle);
      }

      .preference__chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .preference__custom {
        flex-wrap: nowrap;
      }

      .preference__custom input {
        box-sizing: border-box;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 36px;
        padding: 7px 9px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .participants__add-custom:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .preference__option:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .participants__field--notes {
        grid-column: 1 / -1;
      }

      :where(
        .participants__member input,
        .participants__add,
        .participants__remove,
        .preference__toggle,
        .preference__chip,
        .preference__option,
        .preference__custom input,
        .participants__add-custom,
        .participants__field textarea
      ):focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      @media (max-width: 480px) {
        .participants__fields {
          grid-template-columns: minmax(0, 1fr);
        }

        .participants__field--notes {
          grid-column: auto;
        }
      }
    `
  ]
})
export class AiParticipantsComponent {
  @Input() members: HouseholdMember[] = [];
  @Input() selectedMemberIds: string[] = [];
  @Input() guests: AIGuestPreferences[] = [];

  @Output() selectedMemberIdsChange = new EventEmitter<string[]>();
  @Output() guestsChange = new EventEmitter<AIGuestPreferences[]>();

  readonly listFields: readonly GuestListField[] = [
    'allergies',
    'intolerances',
    'diets',
    'likes',
    'dislikes'
  ];

  private readonly customDrafts = new Map<string, string>();
  private openPicker: string | null = null;

  get activeMembers(): HouseholdMember[] {
    return this.members.filter((member) => member.isActive);
  }

  fieldLabel(field: GuestListField): TranslationKey {
    return FIELD_LABELS[field];
  }

  presetOptions(field: GuestListField): readonly PreferencePreset[] {
    return PREFERENCE_PRESETS[field];
  }

  presetId(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-');
  }

  preferenceLabelId(index: number, field: GuestListField): string {
    return `ai-guest-${index}-${field}-label`;
  }

  preferencePickerId(index: number, field: GuestListField): string {
    return `ai-guest-${index}-${field}-picker`;
  }

  presetFor(field: GuestListField, value: string): PreferencePreset | undefined {
    return PREFERENCE_PRESETS[field].find((option) => this.samePreference(option.value, value));
  }

  preferenceText(field: GuestListField, value: string): string {
    return value;
  }

  togglePicker(index: number, field: GuestListField): void {
    const key = this.preferenceKey(index, field);
    this.openPicker = this.openPicker === key ? null : key;
  }

  isPickerOpen(index: number, field: GuestListField): boolean {
    return this.openPicker === this.preferenceKey(index, field);
  }

  customDraft(index: number, field: GuestListField): string {
    return this.customDrafts.get(this.preferenceKey(index, field)) ?? '';
  }

  setCustomDraft(index: number, field: GuestListField, value: string): void {
    this.customDrafts.set(this.preferenceKey(index, field), value.slice(0, 60));
  }

  togglePreference(index: number, field: GuestListField, value: string): void {
    const current = this.guests[index]?.[field] ?? [];
    const selected = current.some((item) => this.samePreference(item, value));
    const next = selected
      ? current.filter((item) => !this.samePreference(item, value))
      : [...current, value].slice(0, 20);
    this.updateGuest(index, { [field]: next });
  }

  removePreference(index: number, field: GuestListField, value: string): void {
    const current = this.guests[index]?.[field] ?? [];
    this.updateGuest(index, {
      [field]: current.filter((item) => !this.samePreference(item, value))
    });
  }

  addCustomPreference(index: number, field: GuestListField, draft?: string): void {
    const key = this.preferenceKey(index, field);
    const value = (draft ?? this.customDrafts.get(key) ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!value) return;
    const current = this.guests[index]?.[field] ?? [];
    if (current.length >= 20) return;
    if (current.some((item) => this.samePreference(item, value))) {
      this.customDrafts.set(key, '');
      return;
    }
    this.updateGuest(index, { [field]: [...current, value] });
    this.customDrafts.set(key, '');
  }

  trackMember(_index: number, member: HouseholdMember): string {
    return member.id;
  }

  trackGuest(index: number): number {
    return index;
  }

  toggleMember(memberId: string, checked: boolean): void {
    const next = new Set(this.selectedMemberIds);
    if (checked) next.add(memberId);
    else next.delete(memberId);
    this.selectedMemberIdsChange.emit([...next]);
  }

  addGuest(): void {
    if (this.guests.length >= 8) return;
    this.guestsChange.emit([...this.guests, { ...EMPTY_GUEST }]);
  }

  removeGuest(index: number): void {
    this.customDrafts.clear();
    this.openPicker = null;
    this.guestsChange.emit(this.guests.filter((_guest, guestIndex) => guestIndex !== index));
  }

  updateNotes(index: number, notes: string): void {
    this.updateGuest(index, { notes: notes.slice(0, 300) });
  }

  private updateGuest(index: number, patch: Partial<AIGuestPreferences>): void {
    if (!this.guests[index]) return;
    this.guestsChange.emit(
      this.guests.map((guest, guestIndex) =>
        guestIndex === index ? { ...guest, ...patch } : guest
      )
    );
  }

  private preferenceKey(index: number, field: GuestListField): string {
    return `${index}:${field}`;
  }

  private samePreference(left: string, right: string): boolean {
    return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  }
}
