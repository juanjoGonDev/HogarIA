import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import type { HouseholdMembership } from '../../shared/models/household.model';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdSwitcherComponent } from './household-switcher.component';

describe('HouseholdSwitcherComponent', () => {
  let fixture: ComponentFixture<HouseholdSwitcherComponent>;
  let memberships: ReturnType<typeof signal<HouseholdMembership[]>>;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let selectActiveHousehold: jasmine.Spy;

  beforeEach(async () => {
    memberships = signal<HouseholdMembership[]>([]);
    activeHouseholdId = signal<string | null>(null);
    selectActiveHousehold = jasmine.createSpy('selectActiveHousehold').and.returnValue(of(true));
    await TestBed.configureTestingModule({
      imports: [HouseholdSwitcherComponent],
      providers: [
        {
          provide: HouseholdService,
          useValue: {
            memberships: memberships.asReadonly(),
            activeHouseholdId: activeHouseholdId.asReadonly(),
            membershipsLoading: signal(false).asReadonly(),
            switchingHousehold: signal(false).asReadonly(),
            selectActiveHousehold
          }
        },
        {
          provide: I18nService,
          useValue: { changeTick: signal(0), t: (key: string) => key }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HouseholdSwitcherComponent);
    fixture.detectChanges();
  });

  it('stays out of the way for one home and exposes the active selection for multiple homes', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true }
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();

    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-1');
    fixture.detectChanges();

    const picker = fixture.nativeElement.querySelector('[data-test="active-household-select"]');
    const trigger = picker.querySelector('.picker__trigger') as HTMLButtonElement;
    expect(picker).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('household.hogar_activo: Casa uno');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('requests the server-validated switch and reports a safe failure accessibly', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-1');
    const selection = new Subject<boolean>();
    selectActiveHousehold.and.returnValue(selection);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.picker__trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll(
      '[role="option"]'
    ) as NodeListOf<HTMLElement>;
    const secondHome = Array.from(options).find((option) =>
      option.textContent?.includes('Casa dos')
    );
    expect(secondHome).toBeDefined();
    secondHome?.click();
    fixture.detectChanges();

    expect(selectActiveHousehold).toHaveBeenCalledOnceWith('home-2');
    expect(trigger.getAttribute('aria-label')).toBe('household.hogar_activo: Casa dos');
    selection.next(false);
    selection.complete();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-label')).toBe('household.hogar_activo: Casa uno');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.no_se_pudo_cambiar_hogar'
    );
  });

  it('keeps the native selector synchronized when the active home changes asynchronously', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true }
    ]);
    activeHouseholdId.set('home-1');
    fixture.detectChanges();

    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-2');
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.picker__trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('household.hogar_activo: Casa dos');
  });

  it('rejects unknown, blank, and already-active home selections without a request', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.selectHousehold('foreign-home');
    fixture.detectChanges();
    expect(component.failed()).toBeTrue();
    expect(selectActiveHousehold).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.no_se_pudo_cambiar_hogar'
    );

    component.selectHousehold('  ');
    component.selectHousehold('home-1');
    expect(selectActiveHousehold).not.toHaveBeenCalled();
  });

  it('clears the optimistic choice and reports an accessible error when switching rejects', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-1');
    selectActiveHousehold.and.returnValue(throwError(() => new Error('synthetic failure')));
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.selectHousehold('home-2');
    fixture.detectChanges();

    expect(component.failed()).toBeTrue();
    expect(component.selectedHouseholdId()).toBe('home-1');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.no_se_pudo_cambiar_hogar'
    );
  });

  it('commits a successful server-validated selection and clears its error state', () => {
    memberships.set([
      { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: {} as any, active: true },
      { id: 'home-2', name: 'Casa dos', role: 'member', permissions: {} as any, active: false }
    ]);
    activeHouseholdId.set('home-1');
    selectActiveHousehold.and.callFake((id: string) => {
      activeHouseholdId.set(id);
      return of(true);
    });
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.selectHousehold('home-2');
    fixture.detectChanges();

    expect(component.failed()).toBeFalse();
    expect(component.selectedHouseholdId()).toBe('home-2');
    expect(selectActiveHousehold).toHaveBeenCalledOnceWith('home-2');
  });
});
