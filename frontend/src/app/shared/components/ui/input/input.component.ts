import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';

export type InputType =
  'text' | 'number' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'date';
export type InputSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslatePipe],
  // El id se aplica SOLO al <input> nativo del template (via @Input() id):
  // si se deja tambien en el host <app-input> el DOM acaba con ids duplicados
  // y los selectores #id dejan de apuntar al campo real.
  host: { '[attr.id]': 'null' },
  template: `
    <div [class]="getGroupClasses()">
      <label *ngIf="label" [for]="id" class="input__label">
        {{ label }}
        <span *ngIf="required" class="input__required">*</span>
      </label>

      <div class="input__wrapper">
        <span *ngIf="prefixIcon" class="input__icon input__icon--prefix">
          <ng-content select="[prefix]"></ng-content>
        </span>

        <input
          [id]="id"
          [type]="effectiveType"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [required]="required"
          [attr.min]="min"
          [attr.max]="max"
          [attr.step]="step"
          [attr.maxlength]="maxLength"
          [attr.aria-invalid]="error ? 'true' : null"
          [attr.aria-describedby]="getDescriptionId()"
          [value]="value"
          [class]="getInputClasses()"
          (input)="onInput($event)"
          (blur)="handleBlur($event)"
          (focus)="onFocus.emit($event)"
        />

        <span *ngIf="suffixIcon" class="input__icon input__icon--suffix">
          <ng-content select="[suffix]"></ng-content>
        </span>

        <button
          *ngIf="type === 'password' && showToggle"
          type="button"
          class="input__toggle"
          [class.input__toggle--visible]="showPassword"
          [disabled]="disabled"
          [attr.aria-label]="(showPassword ? 'ui.hide_password' : 'ui.show_password') | t"
          [attr.aria-controls]="id || null"
          (click)="togglePassword()"
        >
          <app-icon name="visibility" [size]="20" />
        </button>
      </div>

      <span *ngIf="error" [id]="id ? id + '-error' : null" class="input__error" role="alert">{{
        error
      }}</span>
      <span *ngIf="helper && !error" [id]="id ? id + '-helper' : null" class="input__helper">{{
        helper
      }}</span>
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
      /* El ojito que ensena la contrasena: es un boton diminuto pegado al borde del campo y hoy no dice
       nada. Un anillo de foco aparte no hace falta —el del campo ya lo cubre—, pero el puntero y el
       tintado si, que es lo que separa «icono decorativo» de «esto se pulsa». */
      .input__toggle:hover {
        color: var(--primary);
        background: var(--primary-subtle);
      }

      .input-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }

      .input__label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        line-height: var(--leading-normal);
        color: var(--text-primary);
      }

      .input__required {
        color: var(--error);
      }

      .input__wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }

      .input {
        width: 100%;
        font-family: var(--font-sans);
        font-size: var(--text-base);
        font-weight: var(--font-normal);
        line-height: var(--leading-normal);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        transition: var(--transition-fast);

        &::placeholder {
          color: var(--text-tertiary);
        }

        &:hover:not(:disabled) {
          border-color: var(--border-strong);
        }

        &:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px var(--primary-subtle);
        }

        &--error {
          border-color: var(--error);

          &:focus {
            box-shadow: 0 0 0 3px var(--error-subtle);
          }
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: var(--bg-tertiary);
        }
      }

      /* Sizes */
      .input--sm {
        padding: var(--space-1) var(--space-2);
        font-size: var(--text-sm);
      }

      .input--md {
        padding: var(--space-2) var(--space-3);
      }

      .input--lg {
        padding: var(--space-3) var(--space-4);
        font-size: var(--text-lg);
      }

      /* With icons */
      .input--has-prefix {
        padding-left: var(--space-10);
      }

      .input--has-suffix {
        padding-right: var(--space-12);
      }

      .input__icon {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-tertiary);
        pointer-events: none;
      }

      .input__icon--prefix {
        left: var(--space-3);
      }

      .input__icon--suffix {
        right: var(--space-3);
      }

      .input__toggle {
        position: absolute;
        right: var(--space-1);
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        min-height: 44px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;

        &:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        &--visible::after {
          content: '';
          position: absolute;
          width: 25px;
          height: 2px;
          background: currentColor;
          transform: rotate(-45deg);
        }
      }

      .input__error {
        font-size: var(--text-xs);
        color: var(--error);
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }

      .input__helper {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }

      /* Full width */
      .input-group--full-width {
        width: 100%;
      }
    `
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true
    }
  ]
})
export class InputComponent implements ControlValueAccessor {
  @Input() id = '';
  @Input() type: InputType = 'text';
  @Input() label = '';
  @Input() placeholder = '';
  @Input() helper = '';
  @Input() error = '';
  @Input() size: InputSize = 'md';
  private disabledValue = false;
  @Input()
  set disabled(value: boolean) {
    this.disabledValue = value;
    if (value) this.showPassword = false;
  }
  get disabled(): boolean {
    return this.disabledValue;
  }
  @Input() readonly = false;
  @Input() required = false;
  @Input() min: number | string | null = null;
  @Input() max: number | string | null = null;
  @Input() step: number | string | null = null;
  @Input() maxLength: number | null = null;
  @Input() prefixIcon = false;
  @Input() suffixIcon = false;
  @Input() showToggle = true;
  @Input() fullWidth = true;
  @Input() name = '';

  @Output() onBlur = new EventEmitter<Event>();
  @Output() onFocus = new EventEmitter<Event>();

  value = '';
  showPassword = false;

  get effectiveType(): InputType {
    return this.type === 'password' && this.showPassword && !this.disabled ? 'text' : this.type;
  }

  private onChange: (value: string | number) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string | number): void {
    this.value = value === null || value === undefined ? '' : String(value);
  }

  registerOnChange(fn: (value: string | number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    this.value = raw;

    // Los inputs numericos deben propagar numbers: el backend valida con
    // z.number() y un "500" en formato string se rechaza con 400.
    if (this.type === 'number' && raw !== '' && Number.isFinite(Number(raw))) {
      this.onChange(Number(raw));
      return;
    }

    this.onChange(raw);
  }

  handleBlur(event: Event): void {
    this.onBlur.emit(event);
    this.onTouched();
  }

  togglePassword(): void {
    if (this.type !== 'password' || this.disabled) return;
    this.showPassword = !this.showPassword;
  }

  getGroupClasses(): string {
    const classes = ['input-group'];
    if (this.fullWidth) classes.push('input-group--full-width');
    return classes.join(' ');
  }

  getInputClasses(): string {
    const classes = ['input', `input--${this.size}`];
    if (this.error) classes.push('input--error');
    if (this.prefixIcon) classes.push('input--has-prefix');
    if (this.suffixIcon || (this.type === 'password' && this.showToggle)) {
      classes.push('input--has-suffix');
    }
    return classes.join(' ');
  }

  getDescriptionId(): string | null {
    if (!this.id) return null;
    if (this.error) return `${this.id}-error`;
    return this.helper ? `${this.id}-helper` : null;
  }
}
