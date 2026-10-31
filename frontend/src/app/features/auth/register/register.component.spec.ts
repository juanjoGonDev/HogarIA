import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { HouseholdService } from '../../../core/services/household.service';
import { I18nService } from '../../../core/services/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import type { AuthResponse } from '../../../shared/models/user.model';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: Router;
  let navigate: jasmine.Spy;
  let routeCode: jasmine.Spy;
  let household: jasmine.SpyObj<HouseholdService>;
  let translate: jasmine.Spy;

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['register']);
    auth.register.and.returnValue(of({} as AuthResponse));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    routeCode = jasmine.createSpy('get').and.returnValue(null);
    household = jasmine.createSpyObj<HouseholdService>('HouseholdService', [
      'loadHousehold',
      'joinByCode'
    ]);
    household.joinByCode.and.returnValue(of({ success: true } as never));
    translate = jasmine.createSpy('t').and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: routeCode } } }
        },
        { provide: HouseholdService, useValue: household },
        { provide: I18nService, useValue: { t: translate, changeTick: () => 0 } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    router = TestBed.inject(Router);
    navigate = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    component = fixture.componentInstance;
  });

  function makeFormValid(): void {
    component.name = 'Ana';
    component.email = 'ana@example.test';
    component.password = 'Abc123';
    component.confirmPassword = 'Abc123';
  }

  it('renders an explicitly labeled password confirmation field', () => {
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '#confirm-password'
    ) as HTMLInputElement | null;
    const label = fixture.nativeElement.querySelector(
      'label[for="confirm-password"]'
    ) as HTMLLabelElement | null;

    expect(input).not.toBeNull();
    expect(input?.type).toBe('password');
    expect(label?.textContent).toContain('auth.confirm_password');
  });

  it('blocks empty or mismatched confirmation before requesting registration', () => {
    makeFormValid();
    component.confirmPassword = 'Abc124';

    component.onSubmit();

    expect(translate).toHaveBeenCalledWith('auth.confirm_password_mismatch');
    expect(auth.register).not.toHaveBeenCalled();
    expect(component.isLoading()).toBeFalse();

    component.confirmPassword = '';
    component.onSubmit();

    expect(translate).toHaveBeenCalledWith('auth.confirm_password_required');
    expect(auth.register).not.toHaveBeenCalled();

    component.confirmPassword = 'Abc123';
    component.onSubmit();

    expect(component.confirmPasswordError()).toBe('');
    expect(auth.register).toHaveBeenCalledOnceWith({
      name: 'Ana',
      email: 'ana@example.test',
      password: 'Abc123'
    });
  });

  it('maps every validation issue to its translated field message without requesting registration', () => {
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.el_nombre_es_requerido');

    component.name = 'A';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.el_nombre_debe_tener');

    component.name = 'N'.repeat(101);
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.el_nombre_no_puede_superar');

    component.name = 'Ana';
    component.email = '';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.el_email_es_requerido');

    component.email = 'bad-email';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.el_email_no_es_valido');

    component.email = 'ana@example.test';
    component.password = '';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.la_contrasena_es_requerida');

    component.password = 'Abc1';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.la_contrasena_debe_tener');

    component.password = 'abcdef1';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.la_contrasena_necesita_mayuscula');

    component.password = 'Abcdef';
    component.onSubmit();
    expect(translate).toHaveBeenCalledWith('auth.la_contrasena_necesita_numero');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('creates a valid account and sends the user to required household setup', () => {
    makeFormValid();

    component.onSubmit();

    expect(auth.register).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@example.test',
      password: 'Abc123'
    });
    expect(toast.success).toHaveBeenCalledWith('auth.cuenta_creada', 'auth.tu_cuenta_ha_sido');
    expect(household.loadHousehold).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/household']);
    expect(component.isLoading()).toBeTrue();
  });

  it('localizes duplicate email errors and releases the loading state for retry', () => {
    makeFormValid();
    auth.register.and.returnValue(throwError(() => ({ status: 409 })));

    component.onSubmit();

    expect(toast.error).toHaveBeenCalledWith('ui.error', 'auth.el_email_ya_esta_registrado');
    expect(component.isLoading()).toBeFalse();
  });

  it('uses a generic localized message for unexpected server errors', () => {
    makeFormValid();
    auth.register.and.returnValue(throwError(() => ({ status: 500 })));

    component.onSubmit();

    expect(toast.error).toHaveBeenCalledWith('ui.error', 'auth.error_al_crear_la');
    expect(component.isLoading()).toBeFalse();
  });

  it('shows the rate-limit recovery message when the form owns request errors', () => {
    makeFormValid();
    auth.register.and.returnValue(throwError(() => ({ status: 429 })));

    component.onSubmit();

    expect(toast.error).toHaveBeenCalledWith('ui.error', 'ui.demasiadas_solicitudes');
    expect(component.isLoading()).toBeFalse();
  });

  it('does not submit again while a previous request is loading', () => {
    makeFormValid();
    component.isLoading.set(true);

    component.onSubmit();

    expect(auth.register).not.toHaveBeenCalled();
  });

  it('joins the invitation household and keeps failed invitations recoverable', () => {
    makeFormValid();
    routeCode.and.returnValue('invite-code');
    household.joinByCode.and.returnValue(of({ success: true } as never));

    component.onSubmit();

    expect(household.joinByCode).toHaveBeenCalledWith('invite-code');
    expect(navigate).toHaveBeenCalledWith(['/household']);

    navigate.calls.reset();
    household.joinByCode.and.returnValue(throwError(() => new Error('expired')));
    component.isLoading.set(false);
    component.onSubmit();

    expect(navigate).toHaveBeenCalledWith(['/invite', 'invite-code']);
  });

  it('does not treat a rejected invite response as a successful membership', () => {
    makeFormValid();
    routeCode.and.returnValue('invite-code');
    household.joinByCode.and.returnValue(of({ success: false } as never));

    component.onSubmit();

    expect(toast.success).not.toHaveBeenCalledWith('auth.unido', 'auth.te_has_unido_al');
    expect(navigate).toHaveBeenCalledWith(['/invite', 'invite-code']);
  });
});
