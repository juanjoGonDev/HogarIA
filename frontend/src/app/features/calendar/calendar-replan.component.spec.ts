import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { CalendarReplanComponent } from './calendar-replan.component';
import { AiService } from '../../core/services/ai.service';
import { CalendarService } from '../../core/services/calendar.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { CalendarMeal } from '../../shared/models/calendar.model';

const MEALS: CalendarMeal[] = [
  {
    id: 'lunch-1',
    date: '2026-10-05',
    mealType: 'lunch',
    title: 'Pasta',
    servings: 3,
    completed: false
  },
  {
    id: 'dinner-1',
    date: '2026-10-05',
    mealType: 'dinner',
    title: 'Tortilla',
    servings: 3,
    completed: false
  },
  {
    id: 'breakfast-2',
    date: '2026-10-06',
    mealType: 'breakfast',
    title: 'Tostadas',
    servings: 3,
    completed: true
  }
];

const CANDIDATE = {
  name: 'Lentejas',
  description: 'Con verduras de temporada.',
  ingredients: ['lentejas', 'zanahoria'],
  estimatedTime: 35,
  servings: 3
};

describe('CalendarReplanComponent', () => {
  let fixture: ComponentFixture<CalendarReplanComponent>;
  let component: CalendarReplanComponent;
  let calendar: jasmine.SpyObj<CalendarService>;
  let ai: jasmine.SpyObj<AiService>;
  let householdId: ReturnType<typeof signal<string | null>>;
  let contextRevision: ReturnType<typeof signal<number>>;
  let closed: jasmine.Spy;
  let applied: jasmine.Spy;

  beforeEach(async () => {
    householdId = signal<string | null>('home-one');
    contextRevision = signal(0);
    calendar = jasmine.createSpyObj<CalendarService>('CalendarService', [
      'getMealsForRange',
      'replaceSelectedMeals'
    ]);
    Object.defineProperty(calendar, 'goals', {
      value: () => ({
        types: ['weight-loss', 'custom'],
        customInstructions: 'Más legumbres',
        dailyCalories: 1800
      })
    });
    calendar.getMealsForRange.and.returnValue(of(MEALS));
    calendar.replaceSelectedMeals.and.returnValue(of(true));
    ai = jasmine.createSpyObj<AiService>('AiService', ['replaceMeal']);
    ai.replaceMeal.and.callFake((request) => of({ ...CANDIDATE, name: `Nuevo ${request.mealId}` }));
    const householdService = {
      ensureHousehold: jasmine.createSpy('ensureHousehold'),
      activeHouseholdId: householdId.asReadonly(),
      contextRevision: contextRevision.asReadonly(),
      household: () => ({
        id: householdId(),
        members: [
          { id: 'member-a', name: 'Persona A', isActive: true },
          { id: 'member-b', name: 'Persona B', isActive: false }
        ]
      })
    };

    await TestBed.configureTestingModule({
      imports: [CalendarReplanComponent],
      providers: [
        { provide: CalendarService, useValue: calendar },
        { provide: AiService, useValue: ai },
        { provide: HouseholdService, useValue: householdService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])
        }
      ]
    })
      .overrideComponent(CalendarReplanComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(CalendarReplanComponent);
    component = fixture.componentInstance;
    component.weekStart = '2026-10-05';
    component.weekEnd = '2026-10-11';
    closed = jasmine.createSpy('closed');
    applied = jasmine.createSpy('applied');
    component.closed.subscribe(closed);
    component.applied.subscribe(applied);
    fixture.detectChanges();
  });

  it('loads the requested week without changing saved participants or goals', () => {
    expect(calendar.getMealsForRange).toHaveBeenCalledOnceWith('2026-10-05', '2026-10-11');
    expect(component.meals()).toEqual(MEALS);
    expect(component.selectedMemberIds()).toEqual(['member-a']);
    expect(component.goalTypes()).toEqual(['weight-loss', 'custom']);
    expect(component.customInstructions).toBe('Más legumbres');
    expect(component.caloriesTarget).toBe(1800);
  });

  it('selects every eligible meal in a day or week but never a completed meal', () => {
    const monday = component.days().find((day) => day.date === '2026-10-05')!;
    component.toggleDay(monday, true);

    expect(component.selectedIds()).toEqual(['lunch-1', 'dinner-1']);
    component.deselectAll();
    component.selectAll();
    component.toggleMeal('breakfast-2', true);

    expect(component.selectedIds()).toEqual(['lunch-1', 'dinner-1']);
    expect(component.isDaySelected(monday)).toBeTrue();
  });

  it('shows no partial preview and makes no writes if any AI suggestion fails', () => {
    ai.replaceMeal.and.returnValues(of(CANDIDATE), of(null));
    component.selectAll();

    component.requestAlternatives();

    expect(ai.replaceMeal).toHaveBeenCalledTimes(2);
    expect(component.drafts()).toEqual([]);
    expect(component.failed()).toBeTrue();
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();
  });

  it('keeps the calendar unchanged until the user confirms all editable suggestions together', () => {
    component.toggleMeal('lunch-1', true);
    component.requestAlternatives();

    expect(ai.replaceMeal).toHaveBeenCalledOnceWith({
      mealId: 'lunch-1',
      householdMemberIds: ['member-a'],
      guests: [],
      goals: {
        types: ['weight-loss', 'custom'],
        caloriesTarget: 1800,
        customInstructions: 'Más legumbres'
      }
    });
    expect(component.drafts()[0].name).toBe('Nuevo lunch-1');
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();

    component.drafts()[0].name = 'Lentejas editadas';
    component.applyAlternatives();

    expect(calendar.replaceSelectedMeals).toHaveBeenCalledOnceWith([
      { id: 'lunch-1', customMeal: 'Lentejas editadas' }
    ]);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('does not generate or apply in a different active household', () => {
    component.toggleMeal('lunch-1', true);
    householdId.set('home-two');
    contextRevision.update((revision) => revision + 1);
    fixture.detectChanges();

    component.requestAlternatives();
    component.applyAlternatives();

    expect(component.contextChanged()).toBeTrue();
    expect(ai.replaceMeal).not.toHaveBeenCalled();
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();
  });

  it('clears old-household meals and participant selections as soon as context changes', () => {
    component.toggleMeal('lunch-1', true);
    component.updateGuests([
      { allergies: ['cacahuete'], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ]);

    householdId.set('home-two');
    contextRevision.update((revision) => revision + 1);
    fixture.detectChanges();

    expect(component.contextChanged()).toBeTrue();
    expect(component.meals()).toEqual([]);
    expect(component.selectedIds()).toEqual([]);
    expect(component.selectedMemberIds()).toEqual([]);
    expect(component.guests()).toEqual([]);
    expect(component.drafts()).toEqual([]);
    component.requestAlternatives();
    expect(ai.replaceMeal).not.toHaveBeenCalled();
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();
  });

  it('cancels in-flight generation and discards its response after changing homes', () => {
    const request = new Subject<typeof CANDIDATE>();
    ai.replaceMeal.and.returnValue(request.asObservable());
    component.toggleMeal('lunch-1', true);
    component.requestAlternatives();

    householdId.set('home-two');
    contextRevision.update((revision) => revision + 1);
    fixture.detectChanges();
    request.next(CANDIDATE);
    request.complete();

    expect(component.contextChanged()).toBeTrue();
    expect(component.isGenerating()).toBeFalse();
    expect(component.drafts()).toEqual([]);
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();
  });

  it('cancels in-flight suggestions without applying any change', () => {
    const request = new Subject<typeof CANDIDATE | null>();
    ai.replaceMeal.and.returnValue(request.asObservable());
    component.toggleMeal('lunch-1', true);

    component.requestAlternatives();
    component.close();
    request.next(CANDIDATE);
    request.complete();

    expect(component.isGenerating()).toBeFalse();
    expect(calendar.replaceSelectedMeals).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
