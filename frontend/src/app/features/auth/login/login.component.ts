import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { HouseholdService } from '../../../core/services/household.service';
import { ButtonComponent } from '../../../shared/components/ui/button/button.component';
import { InputComponent } from '../../../shared/components/ui/input/input.component';
import { TranslatePipe } from '../../../core/pipes/translate.pipe';
import { I18nService } from '../../../core/services/i18n.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [TranslatePipe, CommonModule, RouterLink, FormsModule, ButtonComponent, InputComponent],
  template: `
    <form (ngSubmit)="onSubmit()" class="login-form">
      <h2 class="login-form__title">{{ 'auth.login' | t }}</h2>

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

      <app-input
        id="password"
        name="password"
        type="password"
        [label]="'auth.password' | t"
        placeholder="••••••••"
        [(ngModel)]="password"
        [required]="true"
        [error]="passwordError()"
      ></app-input>

      <div class="login-form__actions">
        <a routerLink="/auth/forgot-password" class="login-form__link">
          {{ 'auth.forgot' | t }}
        </a>
      </div>

      <app-button
        type="submit"
        variant="primary"
        size="lg"
        [fullWidth]="true"
        [loading]="isLoading()"
      >
        {{ 'auth.login' | t }}
      </app-button>

      <div class="login-form__footer">
        <span>{{ 'auth.noaccount' | t }}</span>
        <a routerLink="/auth/register" class="login-form__link login-form__link--bold">
          {{ 'auth.registrate' | t }}
        </a>
      </div>
    </form>
  `,
  styles: [
    `
      .login-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }

      .login-form__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        text-align: center;
      }

      .login-form__actions {
        display: flex;
        justify-content: flex-end;
      }

      .login-form__link {
        font-size: var(--text-sm);
        color: var(--primary);
        text-decoration: none;
        transition: var(--transition-fast);

        &:hover {
          color: var(--primary-dark);
        }

        &--bold {
          font-weight: var(--font-semibold);
        }
      }

      .login-form__footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
    `
  ]
})
export class LoginComponent {
  private readonly i18n = inject(I18nService);
  private authService = inject(AuthService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private householdService = inject(HouseholdService);

  email = '';
  password = '';
  isLoading = signal(false);
  emailError = signal('');
  passwordError = signal('');

  private redirectAfterAuth(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    if (code) {
      this.householdService.joinByCode(code).subscribe({
        next: () => {
          this.toastService.success(this.i18n.t('auth.unido'), this.i18n.t('auth.te_has_unido_al'));
          this.router.navigate(['/household']);
        },
        error: () => this.router.navigate(['/dashboard'])
      });
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  onSubmit(): void {
    if (this.isLoading()) return;

    this.emailError.set('');
    this.passwordError.set('');

    if (!this.email) {
      this.emailError.set(this.i18n.t('auth.el_email_es_requerido'));
      return;
    }

    if (!this.password) {
      this.passwordError.set(this.i18n.t('auth.la_contrasena_es_requerida'));
      return;
    }

    this.isLoading.set(true);

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: () => {
        this.toastService.success(
          this.i18n.t('auth.bienvenido'),
          this.i18n.t('auth.has_iniciado_sesion_correctamente')
        );
        this.householdService.loadHousehold();
        this.redirectAfterAuth();
      },
      error: (error) => {
        this.isLoading.set(false);
        if (error?.status === 401) {
          this.passwordError.set(this.i18n.t('auth.credenciales_incorrectas'));
          return;
        }

        this.toastService.error(
          this.i18n.t('ui.error'),
          error.message || this.i18n.t('auth.credenciales_incorrectas')
        );
      }
    });
  }
}
