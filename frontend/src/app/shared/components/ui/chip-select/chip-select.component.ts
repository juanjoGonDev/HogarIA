import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../button/button.component';
import { ChipOption } from '../../../models/taste-profile';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { tasteLabelKey } from '../../../../core/i18n/labels';
import { I18nService } from '../../../../core/services/i18n.service';
import { IconComponent } from '../icon/icon.component';

const MAX_SELECTIONS = 60;
const MAX_VALUE_LENGTH = 60;

/**
 * Lista de opciones en formato chip, de una o varias selecciones, con hueco
 * para escribir lo que no esté en la lista.
 *
 * Los valores son texto plano (lo que se envía a la IA tal cual), así que
 * «Frutos secos» vale tanto si viene del catálogo de alérgenos como si lo ha
 * escrito el usuario.
 */
@Component({
  selector: 'app-chip-select',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <div class="chip-select" role="group" [attr.aria-label]="label">
      <div class="chip-select__list">
        <button
          *ngFor="let option of choices; trackBy: trackOption"
          type="button"
          class="chip-select__chip"
          [class.chip-select__chip--on]="isSelected(option.value)"
          [attr.aria-pressed]="isSelected(option.value)"
          (click)="toggle(option.value)"
        >
          <span class="chip-select__icon" *ngIf="option.icon && !isCustom(option.value)" aria-hidden="true">
            {{ option.icon }}
          </span>
          <span class="chip-select__icon" *ngIf="isCustom(option.value)" aria-hidden="true">
            <app-icon name="edit" [size]="16" />
          </span>
          <span class="chip-select__text">{{ labelDe(option) }}</span>
          <span class="chip-select__x" *ngIf="isCustom(option.value)" aria-hidden="true">×</span>
        </button>
      </div>

      <div class="chip-select__add" *ngIf="allowCustom">
        <input
          type="text"
          class="chip-select__input"
          name="chip-select-custom"
          [placeholder]="placeholderText"
          [attr.aria-label]="labelText"
          [ngModel]="customText"
          (ngModelChange)="customText = $event; onCustomTextChange()"
          [attr.aria-describedby]="describedBy"
          [attr.aria-invalid]="validationError === 'max_length' ? 'true' : null"
          (keyup.enter)="$event.preventDefault(); addCustom()"
        />
        <app-button variant="ghost" size="sm" (onClick)="addCustom()">{{ 'ui.anadir' | t }}</app-button>
      </div>

      <p *ngIf="validationError" class="chip-select__error" [id]="errorId" role="alert">
        {{ (validationError === 'max_length' ? 'ui.custom_option_max_length' : 'ui.custom_options_max_selected') | t }}
      </p>
      <p class="chip-select__hint" *ngIf="hint" [id]="hintId">{{ hint }}</p>
    </div>
  `,
  styles: [
    `
      .chip-select {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .chip-select__list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .chip-select__chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: var(--space-1) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-secondary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: var(--transition-fast);
        user-select: none;
        &:hover {
          border-color: var(--border-strong);
          color: var(--text-primary);
        }
        &--on {
          background: var(--primary-subtle);
          border-color: var(--primary);
          color: var(--primary-dark);
          font-weight: var(--font-medium);
        }
      }
      .chip-select__icon {
        font-size: var(--text-base);
        line-height: 1;
        display: inline-flex;
        align-items: center;
      }
      .chip-select__x {
        font-size: var(--text-xs);
        opacity: 0.7;
      }
      .chip-select__add {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .chip-select__input {
        flex: 1;
        min-width: 0;
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
      .chip-select__hint {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .chip-select__error {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--error);
      }
    `
  ]
})
export class ChipSelectComponent {
  private readonly i18n = inject(I18nService);
  private static nextInstanceId = 0;
  readonly instanceId = ChipSelectComponent.nextInstanceId++;
  readonly hintId = `chip-select-hint-${this.instanceId}`;
  readonly errorId = `chip-select-error-${this.instanceId}`;

  /** El valor del catalogo, traducido; lo que escribio la persona, tal cual. */
  labelDe(option: ChipOption): string {
    const clave = tasteLabelKey(option.value);
    return clave ? this.i18n.t(clave) : option.value;
  }


  /** Opciones propuestas (las ya elegidas se muestran aunque no estén aquí). */
  @Input() options: ChipOption[] = [];
  @Input() value: string[] = [];
  @Output() valueChange = new EventEmitter<string[]>();

  @Input() label = '';
  @Input() hint = '';
  @Input() allowCustom = true;
  /**
   * Sin literal por defecto en la declaracion: un campo se evalua una vez al construir el componente y no
   * se entera de que cambio el idioma. El valor de fabrica vive en el diccionario y se resuelve al
   * renderizar (HOGARIA-SPEC 12s-B).
   */
  @Input() customPlaceholder?: string;
  @Input() customLabel?: string;

  get placeholderText(): string {
    return this.customPlaceholder ?? this.i18n.t('ui.escribe_el_tuyo');
  }

  get labelText(): string {
    return this.customLabel ?? this.i18n.t('ui.add_custom_option');
  }

  customText = '';
  validationError: 'max_length' | 'max_selected' | null = null;

  get describedBy(): string | null {
    const ids = [this.hint ? this.hintId : null, this.validationError ? this.errorId : null].filter(
      (id): id is string => id !== null
    );
    return ids.length ? ids.join(' ') : null;
  }

  onCustomTextChange(): void {
    if (this.validationError === 'max_length' && this.customText.trim().length <= MAX_VALUE_LENGTH) {
      this.validationError = null;
    }
  }

  /** Predefinidas + las que haya escrito el usuario. */
  /**
   * Opciones deduplicadas + las escritas a mano, con **identidad estable** mientras `options` y
   * `value` sean los mismos objetos.
   *
   * Un getter que devuelve una array nueva en cada ciclo hace que `*ngFor` tire y vuelva a montar
   * todas las chips: se pierden el hover, el foco y las animaciones, y si dentro de la fila hubiera
   * un `ngModel` el bucle no para (es lo que congelo `app-meal-hours` en la ronda 19 —aqui no hay
   * inputs dentro del bucle, asi que el daño era el parpadeo). La cache por identidad es la version
   * aburrida: se invalida sola cuando el host cambia la seleccion.
   */
  get choices(): ChipOption[] {
    // La clave es el contenido de la seleccion (strings, corta) y la identidad del catalogo: con las
    // dos, un `join` es mas barato que el deduplicado de abajo y no puede quedarse viejo. Contar la
    // longitud no vale —quitar una opcion y anadir otra deja el mismo numero, y las chips serian un
    // recuerdo de lo que habia.
    const values = this.value.join('|');
    if (this.choicesCache && this.choicesOptions === this.options && this.choicesValues === values) {
      return this.choicesCache;
    }
    const base = this.options.filter(
      (option, index) => this.options.findIndex((other) => other.value === option.value) === index
    );
    const extras = this.value
      .filter((item) => !base.some((option) => option.value === item))
      .map((value) => ({ value }));
    this.choicesOptions = this.options;
    this.choicesValues = values;
    this.choicesCache = [...base, ...extras];
    return this.choicesCache;
  }

  private choicesOptions: ChipOption[] | null = null;
  private choicesValues = '';
  private choicesCache: ChipOption[] | null = null;

  /** La clave de una opcion es su valor: con esto `*ngFor` reutiliza la chip en vez de rehacerla. */
  trackOption(_index: number, option: ChipOption): string {
    return option.value;
  }

  isSelected(value: string): boolean {
    return this.value.includes(value);
  }

  /** Una opción escrita a mano se quita con la propia chip (con la ×). */
  isCustom(value: string): boolean {
    return !this.options.some((option) => option.value === value);
  }

  toggle(value: string): void {
    if (this.isSelected(value)) {
      this.validationError = null;
      this.emit(this.value.filter((item) => item !== value));
      return;
    }

    if (this.value.length >= MAX_SELECTIONS) {
      this.validationError = 'max_selected';
      return;
    }

    this.validationError = null;
    this.emit([...this.value, value]);
  }

  addCustom(): void {
    const text = this.customText.trim();
    if (!text) return;

    if (text.length > MAX_VALUE_LENGTH) {
      this.validationError = 'max_length';
      return;
    }

    if (!this.value.some((item) => item.toLowerCase() === text.toLowerCase())) {
      if (this.value.length >= MAX_SELECTIONS) {
        this.validationError = 'max_selected';
        return;
      }
      this.emit([...this.value, text]);
    }
    this.validationError = null;
    this.customText = '';
  }

  private emit(next: string[]): void {
    this.value = next;
    this.valueChange.emit(next);
  }
}
