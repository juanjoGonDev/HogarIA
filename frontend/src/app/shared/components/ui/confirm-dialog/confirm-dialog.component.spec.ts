import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmService } from '../../../../core/services/confirm.service';
import { I18nService } from '../../../../core/services/i18n.service';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let request: ReturnType<typeof signal<any>>;
  let confirmService: any;

  beforeEach(async () => {
    request = signal({ title: 'Confirm deletion', message: 'Synthetic confirmation' });
    confirmService = {
      request,
      cancel: jasmine.createSpy('cancel'),
      accept: jasmine.createSpy('accept')
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        { provide: ConfirmService, useValue: confirmService },
        { provide: I18nService, useValue: { changeTick: signal(0), t: (key: string) => key } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
  });

  it('gives both destructive confirmation actions accessible touch targets', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('app-button button')
    ) as HTMLButtonElement[];

    expect(buttons).toHaveSize(2);
    expect(buttons.every((button) => button.classList.contains('btn--touch-target'))).toBeTrue();
    expect(buttons[0].textContent).toContain('common.cancel');
    expect(buttons[1].textContent).toContain('common.confirmar');
  });

  it('forwards cancel and accept actions to the service', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'app-button button'
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();
    expect(confirmService.cancel).toHaveBeenCalledTimes(1);
    expect(confirmService.accept).toHaveBeenCalledTimes(1);
  });

  it('associates a confirmation warning with its dialog description', () => {
    const overlay = fixture.nativeElement.querySelector('.modal-overlay') as HTMLElement;
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const message = fixture.nativeElement.querySelector('.confirm__message') as HTMLElement;

    expect(overlay.classList.contains('modal-overlay--safe-area')).toBeTrue();
    expect(message.id).toBe('confirm-dialog-message');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-dialog-message');
  });

  it('handles a request without optional message or button text', () => {
    request.set({ title: 'Confirm without details' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Confirm without details');
    expect(fixture.nativeElement.querySelector('.confirm__message')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement).hasAttribute(
        'aria-describedby'
      )
    ).toBeFalse();
  });
});
