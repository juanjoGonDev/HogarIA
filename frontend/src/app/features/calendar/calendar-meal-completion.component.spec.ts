import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { CalendarMealCompletionComponent } from './calendar-meal-completion.component';

describe('CalendarMealCompletionComponent', () => {
  let fixture: ComponentFixture<CalendarMealCompletionComponent>;
  let component: CalendarMealCompletionComponent;
  let i18n: jasmine.SpyObj<I18nService>;

  beforeEach(async () => {
    i18n = jasmine.createSpyObj<I18nService>('I18nService', ['t', 'changeTick']);
    i18n.t.and.callFake((key) => String(key));
    i18n.changeTick.and.returnValue(0);
    await TestBed.configureTestingModule({
      imports: [CalendarMealCompletionComponent],
      providers: [{ provide: I18nService, useValue: i18n }]
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarMealCompletionComponent);
    component = fixture.componentInstance;
  });

  it('announces the current state and emits each user toggle', () => {
    const toggle = jasmine.createSpy('toggle');
    component.toggle.subscribe(toggle);
    fixture.componentRef.setInput('completed', false);
    fixture.detectChanges();

    let button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('calendar.mark_done');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent?.trim()).toBe('calendar.mark_done');
    button.click();
    expect(toggle).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('completed', true);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('calendar.unmark_done');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent?.trim()).toBe('calendar.unmark_done');
    button.click();
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});
