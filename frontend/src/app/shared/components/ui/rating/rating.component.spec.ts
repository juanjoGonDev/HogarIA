import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ICON_SHAPES } from '../icon/icon-paths';
import { RatingComponent } from './rating.component';

describe('RatingComponent', () => {
  let fixture: ComponentFixture<RatingComponent>;
  let component: RatingComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RatingComponent] }).compileComponents();
    fixture = TestBed.createComponent(RatingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders filled and outline rating icons as decorative SVGs', () => {
    fixture.componentRef.setInput('value', 1);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll('.rating__star')) as HTMLButtonElement[];
    expect(
      buttons.map((button) => button.querySelector('app-icon svg path')?.getAttribute('d'))
    ).toEqual([
      ICON_SHAPES.star.d[0],
      ICON_SHAPES.star_outline.d[0],
      ICON_SHAPES.star_outline.d[0],
      ICON_SHAPES.star_outline.d[0],
      ICON_SHAPES.star_outline.d[0]
    ]);
    expect(buttons.every((button) => button.querySelector('svg[aria-hidden="true"]'))).toBe(true);
  });

  it('keeps hover and click behavior while updating both output events', () => {
    const valueChange = jasmine.createSpy('valueChange');
    const ratingChange = jasmine.createSpy('ratingChange');
    component.valueChange.subscribe(valueChange);
    component.ratingChange.subscribe(ratingChange);

    component.onStarHover(2);
    expect(component.getStarIcon(2)).toBe('star');
    expect(component.getStarIcon(3)).toBe('star_outline');
    component.onStarClick(2);

    expect(component.value).toBe(3);
    expect(valueChange).toHaveBeenCalledOnceWith(3);
    expect(ratingChange).toHaveBeenCalledOnceWith(3);
  });

  it('disables every star and ignores click and hover while disabled', () => {
    const valueChange = jasmine.createSpy('valueChange');
    const ratingChange = jasmine.createSpy('ratingChange');
    component.valueChange.subscribe(valueChange);
    component.ratingChange.subscribe(ratingChange);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll('.rating__star')) as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);

    buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    buttons[2].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(component.value).toBe(0);
    expect(component.hoveredIndex).toBe(-1);
    expect(valueChange).not.toHaveBeenCalled();
    expect(ratingChange).not.toHaveBeenCalled();
  });

  it('highlights only the hovered range and clears it when the pointer leaves', () => {
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll('.rating__star')) as HTMLButtonElement[];

    buttons[2].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(component.hoveredIndex).toBe(2);
    expect(
      buttons.slice(0, 3).every((button) => button.classList.contains('rating__star--hovered'))
    ).toBe(true);
    expect(
      buttons.slice(3).every((button) => !button.classList.contains('rating__star--hovered'))
    ).toBe(true);

    buttons[2].dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(component.hoveredIndex).toBe(-1);
    expect(buttons.every((button) => !button.classList.contains('rating__star--hovered'))).toBe(
      true
    );
  });
});
