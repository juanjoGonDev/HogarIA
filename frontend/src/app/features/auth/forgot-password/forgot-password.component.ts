import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormControl, FormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { InputComponent } from '../../../shared/components/ui/input/input.component';
import { TranslatePipe } from '../../../core/pipes/translate.pipe';
import { I18nService } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [TranslatePipe, CommonModule, RouterLink, FormsModule, ButtonComponent, InputComponent],
  template: `
    <form (ngSubmit)="onSubmit()" class="forgot-form">
      <h2 class="forgot-form__title">{{ 'auth.recuperar_contrasena' | t }}</h2>
      <p class="forgot-form__description">
        {{ 'auth.recuperacion_no_disponible' | t }}
      </p>

      <app-input
        id="email"
        name="email"
        type="email"
        [label]="'auth.email' | t"
        [placeholder]="'auth.tu_email_com' | t"
        [(ngModel)]="email"
        [required]="true"
        [error]="emailError()"
      ></app-input>

      <app-button
        type="submit"
        variant="primary"
        size="lg"
        [touchTarget]="true"
        [fullWidth]="true"
        [loading]="isLoading()"
      >
        {{ 'auth.enviar_enlace' | t }}
      </app-button>

      <div class="forgot-form__footer">
        <a routerLink="/auth/login" class="forgot-form__link">
          {{ 'auth.volver_al_login' | t }}
        </a>
      </div>
    </form>
  `,
  styles: [
    `
      .forgot-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }

      .forgot-form__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        text-align: center;
      }

      .forgot-form__description {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        text-align: center;
        line-height: var(--leading-relaxed);
      }

      .forgot-form__footer {
        text-align: center;
      }

      .forgot-form__link {
        font-size: var(--text-sm);
        color: var(--primary);
        text-decoration: none;

        &:hover {
          color: var(--primary-dark);
        }
      }
    `
  ]
})
export class ForgotPasswordComponent {
  private readonly i18n = inject(I18nService);
  private authService = inject(AuthService);
  private toastService = inject(ToastService);
  private readonly emailValidator = new FormControl('', Validators.email);

  email = '';
  isLoading = signal(false);
  emailError = signal('');

  onSubmit(): void {
    if (this.isLoading()) return;

    this.emailError.set('');
    const email = this.email.trim();

    if (!email) {
      this.emailError.set(this.i18n.t('auth.el_email_es_requerido'));
      return;
    }

    this.emailValidator.setValue(email);
    if (this.emailValidator.invalid) {
      this.emailError.set(this.i18n.t('auth.el_email_no_es_valido'));
      return;
    }

    this.email = email;
    this.isLoading.set(true);

    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.toastService.info(
          this.i18n.t('auth.solicitud_recibida'),
          this.i18n.t('auth.recuperacion_no_disponible')
        );
      },
      error: () => {
        this.isLoading.set(false);
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('auth.error_al_enviar_recuperacion')
        );
      }
    });
  }
}
