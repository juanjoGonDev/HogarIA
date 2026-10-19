import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FocusErrorDirective } from './focus-error.directive';

@Component({
  standalone: true,
  imports: [FocusErrorDirective],
  template: `
    <header class="header"></header>
    <p [appFocusError]="active">Error</p>
    <nav class="bottom-nav"></nav>
  `
})
class FocusErrorHostComponent {
  active = false;
}

describe('FocusErrorDirective', () => {
  let fixture: ComponentFixture<FocusErrorHostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FocusErrorHostComponent] });
    fixture = TestBed.createComponent(FocusErrorHostComponent);
  });

  it('does not focus a host while inactive', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const error = fixture.nativeElement.querySelector('p') as HTMLParagraphElement;
    expect(document.activeElement).not.toBe(error);
    expect(error.getAttribute('tabindex')).toBe('-1');
    expect(error.style.scrollMarginBlockStart).toBe(
      'calc(var(--header-height, 64px) + var(--space-3, 12px))'
    );
    expect(error.style.scrollMarginBlockEnd).toBe('var(--bottom-nav-height, 64px)');
  });

  it('focuses the host after it becomes active and renders', async () => {
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('p') as HTMLParagraphElement;
    const header = fixture.nativeElement.querySelector('.header') as HTMLElement;
    const nav = fixture.nativeElement.querySelector('.bottom-nav') as HTMLElement;
    header.style.position = 'fixed';
    nav.style.position = 'fixed';
    spyOn(header, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 0, 568, 56));
    spyOn(nav, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 256, 568, 64));
    spyOn(error, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 34, 120, 18));
    const scrollBy = spyOn(window, 'scrollBy');
    fixture.componentInstance.active = true;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(error);
    expect(JSON.stringify(scrollBy.calls.mostRecent().args[0])).toBe(
      '{"top":-113,"behavior":"instant"}'
    );
  });

  it('does not scroll when the focused error is already clear of fixed bars', async () => {
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('p') as HTMLParagraphElement;
    const header = fixture.nativeElement.querySelector('.header') as HTMLElement;
    const nav = fixture.nativeElement.querySelector('.bottom-nav') as HTMLElement;
    header.style.position = 'fixed';
    nav.style.position = 'fixed';
    spyOn(header, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 0, 568, 56));
    spyOn(nav, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 256, 568, 64));
    spyOn(error, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 100, 120, 18));
    const scrollBy = spyOn(window, 'scrollBy');
    fixture.componentInstance.active = true;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(error);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not apply fixed-bar offsets when the layout bars are not fixed', async () => {
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('p') as HTMLParagraphElement;
    spyOn(error, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 34, 120, 18));
    const scrollBy = spyOn(window, 'scrollBy');
    fixture.componentInstance.active = true;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(error);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
