import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { DEFAULT_HOME_PROFILE } from '../../shared/models/home-profile';
import { emptyTasteProfile } from '../../shared/models/taste-profile';
import type { Utensil } from '../../shared/models/pantry.model';
import type { TasteResponse } from '../../shared/models/taste-profile';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import { resolveMealTimes } from '../../core/meal-times';
import { OnboardingComponent } from './onboarding.component';
import { onboardingEn, onboardingEs } from '../../core/i18n/dict/onboarding';

describe('OnboardingComponent kitchen step', () => {
  let fixture: ComponentFixture<OnboardingComponent>;
  let component: OnboardingComponent;
  let taste: jasmine.SpyObj<TasteProfileService>;
  let pantry: jasmine.SpyObj<PantryService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: Router;

  beforeEach(async () => {
    taste = jasmine.createSpyObj<TasteProfileService>('TasteProfileService', ['load', 'save'], {
      mealTimes: signal(resolveMealTimes(null))
    });
    taste.load.and.returnValue(
      of({
        taste: emptyTasteProfile(),
        onboarding: { status: 'pending', completedAt: null },
        profile: DEFAULT_HOME_PROFILE,
        mealTimes: resolveMealTimes(null)
      })
    );
    taste.save.and.returnValue(
      of({
        taste: emptyTasteProfile(),
        onboarding: { status: 'pending', completedAt: null },
        profile: DEFAULT_HOME_PROFILE
      })
    );

    pantry = jasmine.createSpyObj<PantryService>(
      'PantryService',
      ['loadUtensils', 'updateUtensil'],
      { utensils: signal([]) }
    );
    pantry.loadUtensils.and.returnValue(of([]));
    pantry.updateUtensil.and.returnValue(of({} as Utensil));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: TasteProfileService, useValue: taste },
        { provide: PantryService, useValue: pantry },
        { provide: ToastService, useValue: toast },
        {
          provide: I18nService,
          useValue: {
            changeTick: signal(0),
            t: (key: string) => key
          }
        },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  it('keeps the six-step tour and makes kitchen a link-only step', () => {
    component.stepIndex.set(5);
    fixture.detectChanges();

    expect(component.steps).toHaveSize(6);
    expect(component.steps[component.stepIndex()]).toBe('kitchen');
    expect(fixture.nativeElement.querySelectorAll('.utensil-card__check')).toHaveSize(0);
    expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]')).toHaveSize(0);
    const utensilsLink = fixture.nativeElement.querySelector(
      'a[href="/pantry?tab=utensils"]'
    ) as HTMLAnchorElement | null;
    expect(utensilsLink).not.toBeNull();
  });

  it('does not discard the tour progress or navigate when saving before Pantry fails', () => {
    taste.save.and.returnValue(throwError(() => new Error('offline')));
    component.stepIndex.set(5);
    fixture.detectChanges();
    component.taste.notes = 'respuestas sintéticas';
    const link = fixture.nativeElement.querySelector(
      'a[href="/pantry?tab=utensils"]'
    ) as HTMLAnchorElement;

    link.click();

    expect(taste.save).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.taste.notes).toBe('respuestas sintéticas');
  });

  it('saves edited answers before navigating to the selected Pantry tab', () => {
    component.stepIndex.set(5);
    fixture.detectChanges();
    component.mealTimes.dinner = '21:45';
    const link = fixture.nativeElement.querySelector(
      'a[href="/pantry?tab=utensils"]'
    ) as HTMLAnchorElement;

    link.click();

    expect(taste.save).toHaveBeenCalledWith(component.taste, undefined, component.profile, {
      dinner: '21:45'
    });
    expect(router.navigate).toHaveBeenCalledWith(['/pantry'], {
      queryParams: { tab: 'utensils' }
    });
  });

  it('keeps a failed progress save on the tour and allows retrying the Pantry link', () => {
    taste.save.and.returnValues(
      throwError(() => new Error('offline')),
      of({} as TasteResponse)
    );
    component.stepIndex.set(5);
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector(
      'a[href="/pantry?tab=utensils"]'
    ) as HTMLAnchorElement;

    link.click();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.onboarding__step')).not.toBeNull();

    link.click();
    expect(taste.save).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it('cancels Pantry navigation before the initial load and ignores repeated in-flight clicks', () => {
    const pending = new Subject<TasteResponse>();
    taste.save.and.returnValue(pending.asObservable());
    const beforeLoad = new MouseEvent('click', { cancelable: true });
    component.navigateToPantry(beforeLoad, 'ingredients');
    expect(beforeLoad.defaultPrevented).toBeTrue();
    expect(taste.save).not.toHaveBeenCalled();

    component.stepIndex.set(5);
    fixture.detectChanges();
    const first = new MouseEvent('click', { cancelable: true });
    const duplicate = new MouseEvent('click', { cancelable: true });
    component.navigateToPantry(first, 'ingredients');
    component.navigateToPantry(duplicate, 'utensils');

    expect(taste.save).toHaveBeenCalledTimes(1);
    expect(duplicate.defaultPrevented).toBeTrue();
    pending.next({
      taste: emptyTasteProfile(),
      onboarding: { status: 'pending', completedAt: null }
    });
    expect(router.navigate).toHaveBeenCalledWith(['/pantry'], {
      queryParams: { tab: 'ingredients' }
    });
  });

  it('uses the local defaults when loading the saved taste profile fails', () => {
    taste.load.and.returnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();

    expect(component.profile).toEqual(DEFAULT_HOME_PROFILE);
    expect(component.mealTimes).toEqual(resolveMealTimes(null));
    expect(component.progress()).toBeCloseTo(100 / 6);
  });

  it('keeps keyboard shortcuts out of text/button controls and advances for other targets', () => {
    const eventFor = (key: string, tagName: string, type = '', role: string | null = null) => {
      const preventDefault = jasmine.createSpy('preventDefault');
      const event = {
        key,
        target: { tagName, type, getAttribute: () => role },
        preventDefault
      } as unknown as KeyboardEvent;
      return { event, preventDefault };
    };

    fixture.detectChanges();
    const textareaEnter = eventFor('Enter', 'TEXTAREA');
    component.onCardKeydown(textareaEnter.event);
    expect(component.stepIndex()).toBe(0);
    expect(textareaEnter.preventDefault).not.toHaveBeenCalled();

    component.onCardKeydown(eventFor('Enter', 'BUTTON').event);
    component.onCardKeydown(eventFor('Enter', 'DIV', '', 'button').event);
    component.onCardKeydown(eventFor('Enter', 'A').event);
    component.onCardKeydown(eventFor('Enter', 'DIV', '', 'link').event);
    expect(component.stepIndex()).toBe(0);

    const normalEnter = eventFor('Enter', 'INPUT', 'text');
    component.onCardKeydown(normalEnter.event);
    expect(component.stepIndex()).toBe(1);
    expect(normalEnter.preventDefault).toHaveBeenCalled();
  });

  it('skips a step with Escape except when the native time or date picker owns it', () => {
    fixture.detectChanges();
    component.onCardKeydown({
      key: 'Escape',
      target: { tagName: 'INPUT', type: 'time' },
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as KeyboardEvent);
    expect(component.stepIndex()).toBe(0);

    component.onCardKeydown({
      key: 'Escape',
      target: { tagName: 'INPUT', type: 'date' },
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as KeyboardEvent);
    expect(component.stepIndex()).toBe(0);

    const escape = {
      key: 'Escape',
      target: { tagName: 'DIV', type: '' },
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as KeyboardEvent;
    component.onCardKeydown(escape);
    expect(component.stepIndex()).toBe(1);
    expect(component.skippedSteps().has('profile')).toBeTrue();
    expect(escape.preventDefault).toHaveBeenCalled();
  });

  it('does not move back from the first step and keeps next inside the final step', () => {
    fixture.detectChanges();
    component.back();
    expect(component.stepIndex()).toBe(0);
    component.stepIndex.set(5);
    component.next();
    expect(component.stepIndex()).toBe(5);
    component.back();
    expect(component.stepIndex()).toBe(4);
  });

  it('finishes and skips with distinct status messages and resets saving on service error', () => {
    fixture.detectChanges();
    component.finish();
    expect(taste.save.calls.mostRecent().args[1]).toBe('done');
    expect(toast.success).toHaveBeenCalledWith(
      'onboarding.listo',
      'onboarding.perfil_y_preferencias'
    );
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(component.isSaving()).toBeFalse();

    taste.save.and.returnValue(throwError(() => new Error('offline')));
    component.skip();
    expect(taste.save.calls.mostRecent().args[1]).toBe('skipped');
    expect(component.isSaving()).toBeFalse();
    expect(toast.error).toHaveBeenCalled();
  });

  it('keeps kitchen guidance and CTA translated in Spanish and English', () => {
    expect(onboardingEs['onboarding.utensilios_en_despensa']).toContain('Despensa');
    expect(onboardingEn['onboarding.utensilios_en_despensa']).toContain('Pantry');
    expect(onboardingEs['onboarding.gestionar_utensilios']).toBe('Gestionar utensilios →');
    expect(onboardingEn['onboarding.gestionar_utensilios']).toBe('Manage utensils →');
    expect(onboardingEs['onboarding.no_se_pudo_guardar_progreso']).toContain('respuestas');
    expect(onboardingEn['onboarding.no_se_pudo_guardar_progreso']).toContain('answers');
  });
});
