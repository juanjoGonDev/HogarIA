import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { HouseholdService } from '../../../core/services/household.service';
import { I18nService } from '../../../core/services/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let loginResponse: Subject<unknown>;
  let inviteCode: string | null;
  let authService: jasmine.SpyObj<AuthService>;
  let householdService: jasmine.SpyObj<HouseholdService>;
  let toastService: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    inviteCode = null;
    loginResponse = new Subject<unknown>();
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['login']);
    householdService = jasmine.createSpyObj<HouseholdService>('HouseholdService', [
      'loadHousehold',
      'joinByCode'
    ]);
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    authService.login.and.returnValue(loginResponse as never);
    householdService.joinByCode.and.returnValue(of({} as never));
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: HouseholdService, useValue: householdService },
        { provide: ToastService, useValue: toastService },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => inviteCode } } }
        },
        {
          provide: I18nService,
          useValue: { t: (key: string) => key, changeTick: () => 0 }
        }
      ]
    })
      .overrideComponent(LoginComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    component.email = 'login@example.test';
    component.password = 'SafePassword123';
  });

  it('sends only one login while the first request is pending', () => {
    component.onSubmit();
    component.onSubmit();

    expect(authService.login).toHaveBeenCalledOnceWith({
      email: 'login@example.test',
      password: 'SafePassword123'
    });
    expect(component.isLoading()).toBeTrue();
  });

  it('does not send empty credentials', () => {
    component.email = '';
    component.onSubmit();
    expect(component.emailError()).toBe('auth.el_email_es_requerido');

    component.email = 'login@example.test';
    component.password = '';
    component.onSubmit();
    expect(component.passwordError()).toBe('auth.la_contrasena_es_requerida');
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('allows another attempt after a failed login', () => {
    const failedRequest = new Subject<unknown>();
    const retryRequest = new Subject<unknown>();
    authService.login.and.returnValues(failedRequest as never, retryRequest as never);

    component.onSubmit();
    failedRequest.error({ message: 'temporary failure' });
    expect(component.isLoading()).toBeFalse();

    component.onSubmit();
    expect(authService.login).toHaveBeenCalledTimes(2);
    retryRequest.error({ message: 'temporary failure' });
    expect(component.isLoading()).toBeFalse();
  });

  it('shows rejected credentials beside the password without a session-expired toast', () => {
    authService.login.and.returnValue(
      throwError(() => ({ status: 401, message: 'ui.la_sesion_que_guarda' })) as never
    );

    component.onSubmit();

    expect(component.isLoading()).toBeFalse();
    expect(component.passwordError()).toBe('auth.credenciales_incorrectas');
    expect(toastService.error).not.toHaveBeenCalled();
  });

  it('keeps a recoverable toast for network or server errors', () => {
    authService.login.and.returnValue(
      throwError(() => ({ status: 503, message: 'ui.servicio_no_disponible' })) as never
    );

    component.onSubmit();

    expect(component.isLoading()).toBeFalse();
    expect(component.passwordError()).toBe('');
    expect(toastService.error).toHaveBeenCalledOnceWith('ui.error', 'ui.servicio_no_disponible');
  });

  it('joins the invite once after a successful login with a code', () => {
    inviteCode = 'SYNTHETIC-CODE';
    component.onSubmit();
    loginResponse.next({ token: 'synthetic-token' });

    expect(householdService.joinByCode).toHaveBeenCalledOnceWith('SYNTHETIC-CODE');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/household']);
    expect(toastService.success).toHaveBeenCalledTimes(2);
  });

  it('navigates to the dashboard after successful login without an invite', () => {
    component.onSubmit();
    loginResponse.next({ token: 'synthetic-token' });

    expect(householdService.loadHousehold).toHaveBeenCalledOnceWith();
    expect(householdService.joinByCode).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/dashboard']);
  });

  it('falls back to the dashboard when joining the invite fails', () => {
    inviteCode = 'SYNTHETIC-CODE';
    householdService.joinByCode.and.returnValue(
      throwError(() => new Error('synthetic invite failure'))
    );
    component.onSubmit();
    loginResponse.next({ token: 'synthetic-token' });

    expect(householdService.joinByCode).toHaveBeenCalledOnceWith('SYNTHETIC-CODE');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    expect(toastService.success).toHaveBeenCalledOnceWith(
      'auth.bienvenido',
      'auth.has_iniciado_sesion_correctamente'
    );
  });
});
