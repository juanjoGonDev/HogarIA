import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../core/services/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import { authEn, authEs } from '../../../core/i18n/dict/auth';
import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  let component: ForgotPasswordComponent;
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: jasmine.Spy;

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['forgotPassword']);
    auth.forgotPassword.and.returnValue(of(undefined));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    translate = jasmine.createSpy('t').and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { changeTick: signal(0), t: translate } },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    component = fixture.componentInstance;
  });

  it('requires an email before requesting recovery', () => {
    component.onSubmit();

    expect(component.emailError()).toBe('auth.el_email_es_requerido');
    expect(auth.forgotPassword).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('treats whitespace-only email as empty', () => {
    component.email = '   ';

    component.onSubmit();

    expect(component.emailError()).toBe('auth.el_email_es_requerido');
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });

  it('rejects a malformed email locally without calling the API', () => {
    component.email = 'not-an-email';
    fixture.detectChanges();

    component.onSubmit();

    expect(component.emailError()).toBe('auth.el_email_no_es_valido');
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });

  it('shows an honest informational result instead of claiming a link was sent', () => {
    component.email = 'fixture@hogaria.test';

    component.onSubmit();

    expect(auth.forgotPassword).toHaveBeenCalledWith('fixture@hogaria.test');
    expect(toast.info).toHaveBeenCalledWith(
      'auth.solicitud_recibida',
      'auth.recuperacion_no_disponible'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.isLoading()).toBeFalse();
  });

  it('keeps unavailable recovery copy honest in Spanish and English', () => {
    const esCopy = (authEs as unknown as Record<string, string>)['auth.recuperacion_no_disponible'];
    const enCopy = (authEn as unknown as Record<string, string>)['auth.recuperacion_no_disponible'];
    expect(esCopy).toContain('no está disponible');
    expect(esCopy).toContain('no se envían enlaces');
    expect(enCopy).toContain('not available yet');
    expect(enCopy).toContain('recovery links are not sent');
    expect(authEs['auth.enviar_enlace']).toBe('Solicitar recuperación');
    expect(authEn['auth.enviar_enlace']).toBe('Request recovery');
  });

  it('reports service failures honestly and preserves the address for retry', () => {
    component.email = 'fixture@hogaria.test';
    auth.forgotPassword.and.returnValue(throwError(() => ({ status: 503 })));

    component.onSubmit();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'auth.error_al_enviar_recuperacion');
    expect(component.email).toBe('fixture@hogaria.test');
    expect(component.isLoading()).toBeFalse();
  });

  it('allows a retry after the failed request completes', () => {
    component.email = 'fixture@hogaria.test';
    auth.forgotPassword.and.returnValues(
      throwError(() => ({ status: 503 })),
      of(undefined)
    );

    component.onSubmit();
    component.onSubmit();

    expect(auth.forgotPassword).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(component.isLoading()).toBeFalse();
  });

  it('does not duplicate a recovery request while one is in progress', () => {
    component.email = 'fixture@hogaria.test';
    component.isLoading.set(true);

    component.onSubmit();

    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });
});
