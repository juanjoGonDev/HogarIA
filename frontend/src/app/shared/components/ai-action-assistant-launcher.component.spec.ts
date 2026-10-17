import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { AiActionAssistantLauncherComponent } from './ai-action-assistant-launcher.component';

describe('AiActionAssistantLauncherComponent', () => {
  let fixture: ComponentFixture<AiActionAssistantLauncherComponent>;
  let component: AiActionAssistantLauncherComponent;
  let i18n: I18nService;
  let toast: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiActionAssistantLauncherComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    i18n = TestBed.inject(I18nService);
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(AiActionAssistantLauncherComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('waits for assistant translations before opening the lazy dialog', async () => {
    let resolveTranslations: (() => void) | undefined;
    spyOn(i18n, 'loadAssistantTranslations').and.returnValue(
      new Promise<void>((resolve) => {
        resolveTranslations = resolve;
      })
    );

    const opening = component.open();
    expect(component.isOpen()).toBe(false);
    expect(resolveTranslations).toBeDefined();

    resolveTranslations?.();
    await opening;

    expect(component.isOpen()).toBe(true);
  });

  it('keeps the dialog closed and shows a translated error when loading fails', async () => {
    spyOn(i18n, 'loadAssistantTranslations').and.rejectWith(new Error('chunk failed'));
    const toastError = spyOn(toast, 'error');

    await component.open();

    expect(component.isOpen()).toBe(false);
    expect(toastError).toHaveBeenCalledOnceWith(
      i18n.t('ui.error'),
      'No se pudo cargar el asistente. Vuelve a intentarlo.'
    );
  });
});
