import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { ServiceWorkerUpdateService } from '../../core/services/service-worker-update.service';
import { AppUpdateNoticeComponent } from './app-update-notice.component';

describe('AppUpdateNoticeComponent', () => {
  let fixture: ComponentFixture<AppUpdateNoticeComponent>;
  let updateAvailable: ReturnType<typeof signal<boolean>>;
  let activationFailed: ReturnType<typeof signal<boolean>>;
  let activateUpdateAndReload: jasmine.Spy;

  beforeEach(async () => {
    updateAvailable = signal(false);
    activationFailed = signal(false);
    activateUpdateAndReload = jasmine.createSpy('activateUpdateAndReload');

    await TestBed.configureTestingModule({
      imports: [AppUpdateNoticeComponent],
      providers: [
        {
          provide: ServiceWorkerUpdateService,
          useValue: { updateAvailable, activationFailed, activateUpdateAndReload }
        },
        {
          provide: I18nService,
          useValue: {
            changeTick: signal(0),
            t: (key: string) => key
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppUpdateNoticeComponent);
  });

  it('stays hidden when there is no downloaded update', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="app-update-notice"]')).toBeNull();
  });

  it('shows an accessible notice and reload action only for a ready update', () => {
    updateAvailable.set(true);
    fixture.detectChanges();

    const notice: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-test="app-update-notice"]'
    );
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-test="app-update-action"] button'
    );
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.getAttribute('aria-live')).toBe('polite');
    expect(button?.disabled).toBeFalse();
  });

  it('requests activation only after the user presses the action', () => {
    updateAvailable.set(true);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-test="app-update-action"] button'
    );
    button.click();

    expect(activateUpdateAndReload).toHaveBeenCalledOnceWith();
  });

  it('announces a failed activation while keeping the retry action visible', () => {
    updateAvailable.set(true);
    activationFailed.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="app-update-action"] button')
    ).not.toBeNull();
  });
});
