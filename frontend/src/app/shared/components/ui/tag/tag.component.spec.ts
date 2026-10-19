import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagComponent } from './tag.component';

@Component({
  selector: 'app-tag-test-host',
  standalone: true,
  imports: [TagComponent],
  template: `
    <app-tag
      [disabled]="disabled"
      [removable]="removable"
      (onRemove)="removedWith = $event"
      (click)="clickCount = clickCount + 1"
    >
      Fruta
    </app-tag>
  `
})
class TagTestHostComponent {
  disabled = false;
  removable = false;
  clickCount = 0;
  removedWith: Event | null = null;
}

describe('TagComponent', () => {
  let fixture: ComponentFixture<TagTestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TagTestHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(TagTestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('keeps informational tags as text without a focusable control', () => {
    const tag = fixture.nativeElement.querySelector('.tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('Fruta');
    expect(tag.querySelector('button')).toBeNull();
    expect(tag.className).toBe('tag');

    fixture.componentInstance.disabled = true;
    fixture.detectChanges();
    expect(tag.className).toBe('tag tag--disabled');
  });

  it('provides a localized remove button that cannot bubble as a filter click', () => {
    fixture.componentInstance.removable = true;
    fixture.detectChanges();

    const tag = fixture.nativeElement.querySelector('.tag') as HTMLElement;
    const remove = tag.querySelector('.tag__remove') as HTMLButtonElement;
    expect(tag.textContent?.replace('×', '').trim()).toBe('Fruta');
    expect(remove.tagName).toBe('BUTTON');
    expect(remove.getAttribute('aria-label')).toBeTruthy();

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    remove.dispatchEvent(event);

    expect(fixture.componentInstance.removedWith).toBe(event);
    expect(fixture.componentInstance.clickCount).toBe(0);
  });

  it('disables the remove button with the tag', () => {
    fixture.componentInstance.removable = true;
    fixture.componentInstance.disabled = true;
    fixture.detectChanges();

    const remove = fixture.nativeElement.querySelector('.tag__remove') as HTMLButtonElement;
    expect(remove.disabled).toBeTrue();
    remove.click();
    expect(fixture.componentInstance.removedWith).toBeNull();
  });
});
