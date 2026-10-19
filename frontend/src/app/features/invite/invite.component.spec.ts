import { Directive, Input, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NEVER, Subject, of } from 'rxjs';
import { HouseholdService } from '../../core/services/household.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import { InviteComponent } from './invite.component';

@Directive({ selector: '[routerLink]', standalone: true })
class RouterLinkStubDirective {
  @Input() routerLink: unknown;
  @Input() queryParams: unknown;
}

describe('InviteComponent', () => {
  let fixture: ComponentFixture<InviteComponent>;
  let component: InviteComponent;
  let http: jasmine.SpyObj<HttpClient>;
  let household: jasmine.SpyObj<HouseholdService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let auth: { isAuthenticated: WritableSignal<boolean> };
  let routeCode: string | null;

  const preview = (overrides: Record<string, unknown> = {}) => ({
    success: true,
    data: {
      householdId: 'house-qa',
      householdName: 'Casa sintética',
      memberCount: 1,
      alreadyMember: false,
      ...overrides
    }
  });

  beforeEach(async () => {
    routeCode = 'INVITE123';
    http = jasmine.createSpyObj<HttpClient>('HttpClient', ['get']);
    household = jasmine.createSpyObj<HouseholdService>('HouseholdService', ['joinByCode']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    auth = { isAuthenticated: signal(true) };

    const i18n = {
      changeTick: signal(0),
      t: (key: string, params?: { n?: number }) =>
        ({
          'ui.no_se_pudo_unir': 'No se pudo unir al hogar',
          'ui.codigo_de_invitacion_invalido': 'Código de invitación inválido',
          'ui.codigo_de_invitacion_no': 'Código de invitación inválido',
          'invite.invitacion_no_valida': 'Invitación no válida',
          'invite.unirme_al_hogar': 'Unirme al hogar',
          'invite.ya_eres_miembro_de': 'Ya eres miembro de este hogar',
          'invite.ir_a_mi_hogar': 'Ir a mi hogar',
          'invite.miembro_uno': '1 miembro',
          'invite.miembros': `${params?.n ?? 2} miembros`,
          'common.cancel': 'Cancelar'
        })[key] ?? key
    };

    await TestBed.configureTestingModule({
      imports: [InviteComponent],
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: HouseholdService, useValue: household },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: i18n },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => routeCode } } }
        },
        { provide: Router, useValue: router }
      ]
    })
      .overrideComponent(InviteComponent, {
        remove: { imports: [RouterLink] },
        add: { imports: [RouterLinkStubDirective] }
      })
      .compileComponents();
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(InviteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads a valid invite for an authenticated non-member', () => {
    http.get.and.returnValue(of(preview()));
    createComponent();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(component.preview()?.householdName).toBe('Casa sintética');
    expect(component.loading()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.invite-card__actions')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('1 miembro');
  });

  it('shows login and registration choices to a logged-out visitor', () => {
    auth.isAuthenticated.set(false);
    http.get.and.returnValue(of(preview()));
    createComponent();

    expect(fixture.nativeElement.querySelectorAll('.invite-card__actions a').length).toBe(2);
  });

  it('shows the already-member state without offering another join', () => {
    http.get.and.returnValue(of(preview({ alreadyMember: true, memberCount: 2 })));
    createComponent();

    expect(fixture.nativeElement.textContent).toContain('Ya eres miembro de este hogar');
    expect(fixture.nativeElement.querySelector('.invite-card__actions')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('2 miembros');
  });

  it('renders invalid and failed invite previews as a recoverable state', () => {
    http.get.and.returnValue(of({ success: false, message: 'Invalid invite' }));
    createComponent();

    expect(component.error()).toBe('Invalid invite');
    expect(fixture.nativeElement.querySelector('.invite-card__title')?.textContent.trim()).toBe(
      'Invitación no válida'
    );
    expect(fixture.nativeElement.querySelector('.invite-card__actions')).toBeNull();
  });

  it('handles an absent route code without making an API request', () => {
    routeCode = '';
    createComponent();

    expect(http.get).not.toHaveBeenCalled();
    expect(component.loading()).toBeFalse();
    expect(component.error()).toBe('Código de invitación inválido');
  });

  it('keeps the pending preview in a loading state', () => {
    http.get.and.returnValue(NEVER);
    createComponent();

    expect(component.loading()).toBeTrue();
    expect(fixture.nativeElement.querySelector('app-loading')).not.toBeNull();
  });

  it('shows acceptance failures inline and permits a successful retry', () => {
    const firstJoin = new Subject<unknown>();
    http.get.and.returnValue(of(preview()));
    household.joinByCode.and.returnValue(firstJoin);
    createComponent();

    component.accept();
    component.accept();
    expect(household.joinByCode).toHaveBeenCalledTimes(1);
    expect(component.joining()).toBeTrue();
    component.decline();
    expect(router.navigate).not.toHaveBeenCalled();

    firstJoin.error({ status: 503 });
    fixture.detectChanges();
    expect(component.joining()).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('.invite-card__error[role="alert"]')?.textContent.trim()
    ).toBe('No se pudo unir al hogar');
    expect(toast.error).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();

    household.joinByCode.and.returnValue(of({ success: true }));
    component.accept();
    fixture.detectChanges();

    expect(household.joinByCode).toHaveBeenCalledTimes(2);
    expect(household.joinByCode.calls.argsFor(1)).toEqual(['INVITE123', { silentToast: true }]);
    expect(fixture.nativeElement.querySelector('.invite-card__error')).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/household']);
  });

  it('declines without joining and navigates to the home route', () => {
    http.get.and.returnValue(of(preview()));
    createComponent();

    component.decline();

    expect(household.joinByCode).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    router.navigate.calls.reset();

    component.joining.set(true);
    component.decline();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not announce success when the join request has a false success envelope', () => {
    http.get.and.returnValue(of(preview()));
    household.joinByCode.and.returnValue(of({ success: false }));
    createComponent();

    component.accept();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.invite-card__error[role="alert"]')?.textContent.trim()
    ).toBe('No se pudo unir al hogar');
    expect(toast.success).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.joining()).toBeFalse();
  });
});
