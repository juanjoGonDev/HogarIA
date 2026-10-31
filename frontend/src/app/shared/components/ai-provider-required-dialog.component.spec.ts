import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { HouseholdMembership } from '../../shared/models/household.model';
import type { AiFunctionKey } from '../models/ai-config.model';
import { AiProviderAvailabilityService } from '../../core/services/ai-provider-availability.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { AiProviderRequiredDialogComponent } from './ai-provider-required-dialog.component';

describe('AiProviderRequiredDialogComponent', () => {
  let fixture: ComponentFixture<AiProviderRequiredDialogComponent>;
  let setupFunction: ReturnType<typeof signal<AiFunctionKey | null>>;
  let closeSetup: jasmine.Spy;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let memberships: ReturnType<typeof signal<HouseholdMembership[]>>;
  let loadTranslations: jasmine.Spy;

  const member = (settings: boolean): HouseholdMembership => ({
    id: 'synthetic-home',
    name: 'Casa sintética',
    role: 'member',
    permissions: { settings } as HouseholdMembership['permissions'],
    active: true
  });

  beforeEach(async () => {
    setupFunction = signal<AiFunctionKey | null>('recipes');
    closeSetup = jasmine.createSpy('closeSetup').and.callFake(() => setupFunction.set(null));
    activeHouseholdId = signal<string | null>('synthetic-home');
    memberships = signal([member(true)]);
    loadTranslations = jasmine.createSpy('loadTranslations').and.returnValue(Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [AiProviderRequiredDialogComponent],
      providers: [
        provideRouter([]),
        {
          provide: AiProviderAvailabilityService,
          useValue: { setupFunction, closeSetup }
        },
        {
          provide: HouseholdService,
          useValue: { activeHouseholdId, memberships }
        },
        {
          provide: I18nService,
          useValue: {
            changeTick: signal(0),
            t: (key: string) => key,
            loadTranslations
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AiProviderRequiredDialogComponent);
  });

  it('links permitted household members to Hogar settings without showing a false permission warning', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      '.provider-required__link'
    ) as HTMLAnchorElement;
    expect(link.href).toContain('/household?tab=settings');
    expect(fixture.nativeElement.querySelector('.provider-required__permission')).toBeNull();
    expect(fixture.componentInstance.functionLabel()).toBe('ai_config.function_recipes');
  });

  it('explains missing settings permission for household members', async () => {
    memberships.set([member(false)]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.provider-required__permission')).not.toBeNull();
    expect(
      (fixture.nativeElement.querySelector('.provider-required__link') as HTMLAnchorElement).href
    ).toContain('/household?tab=settings');
  });

  it('does not imply missing permissions before a household is selected', async () => {
    activeHouseholdId.set(null);
    memberships.set([member(false)]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.provider-required__permission')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('.provider-required__link') as HTMLAnchorElement).href
    ).toContain('/household?tab=settings');
  });

  it('still opens if an optional translation bundle fails to load', async () => {
    loadTranslations.and.rejectWith(new Error('offline'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-modal')).not.toBeNull();
  });

  it('uses personal configuration when the user belongs to no household', async () => {
    activeHouseholdId.set(null);
    memberships.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.querySelector('.provider-required__link') as HTMLAnchorElement).href
    ).toContain('/ai-config');
    expect(fixture.nativeElement.querySelector('.provider-required__permission')).toBeNull();
  });

  it('closes the request when dismissed', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.close();

    expect(closeSetup).toHaveBeenCalledTimes(1);
  });
});
