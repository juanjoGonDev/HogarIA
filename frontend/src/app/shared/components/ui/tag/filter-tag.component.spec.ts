import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterTagComponent } from './filter-tag.component';

@Component({
  selector: 'app-filter-tag-test-host',
  standalone: true,
  imports: [FilterTagComponent],
  template: `
    <app-filter-tag
      [selected]="selected"
      [disabled]="disabled"
      (onClick)="clickCount = clickCount + 1"
    >
      Fruta
    </app-filter-tag>
  `
})
class FilterTagTestHostComponent {
  selected = false;
  disabled = false;
  clickCount = 0;
}

describe('FilterTagComponent', () => {
  let fixture: ComponentFixture<FilterTagTestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterTagTestHostComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(FilterTagTestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('renders a named native toggle button with synchronized pressed state', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent?.trim()).toBe('Fruta');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.className).toContain('tag--interactive');

    fixture.componentInstance.selected = true;
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('tag--selected');
  });

  it('emits on activation and disables the native control when requested', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(fixture.componentInstance.clickCount).toBe(1);

    fixture.componentInstance.disabled = true;
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(button.className).toContain('tag--disabled');
    button.click();
    expect(fixture.componentInstance.clickCount).toBe(1);
  });
});
