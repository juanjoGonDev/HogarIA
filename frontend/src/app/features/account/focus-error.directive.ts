import {
  afterNextRender,
  inject,
  Injector,
  Input,
  OnChanges,
  ElementRef,
  HostBinding,
  Directive
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

/** Move focus to a newly rendered inline error so it is announced and brought into view. */
@Directive({
  selector: '[appFocusError]',
  standalone: true
})
export class FocusErrorDirective implements OnChanges {
  @Input() appFocusError = false;

  @HostBinding('attr.tabindex') readonly tabIndex = '-1';
  @HostBinding('style.scrollMarginBlockStart')
  readonly scrollMarginBlockStart = 'calc(var(--header-height, 64px) + var(--space-3, 12px))';
  @HostBinding('style.scrollMarginBlockEnd')
  readonly scrollMarginBlockEnd = 'var(--bottom-nav-height, 64px)';

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  ngOnChanges(): void {
    if (!this.appFocusError) return;

    afterNextRender(() => this.focusAndReveal(), { injector: this.injector });
  }

  private focusAndReveal(): void {
    const element = this.element.nativeElement;
    element.focus({ preventScroll: true });

    const view = this.document.defaultView;
    const header = this.document.querySelector<HTMLElement>('.header');
    const nav = this.document.querySelector<HTMLElement>('.bottom-nav');
    const headerRect = header?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const fixedHeaderBottom =
      header && view?.getComputedStyle(header).position === 'fixed' ? (headerRect?.bottom ?? 0) : 0;
    const fixedNavTop =
      nav && view?.getComputedStyle(nav).position === 'fixed'
        ? (navRect?.top ?? view.innerHeight)
        : (view?.innerHeight ?? Number.POSITIVE_INFINITY);
    const errorRect = element.getBoundingClientRect();

    if (errorRect.top < fixedHeaderBottom || errorRect.bottom > fixedNavTop) {
      const errorCenter = (errorRect.top + errorRect.bottom) / 2;
      const safeCenter = (fixedHeaderBottom + fixedNavTop) / 2;
      view?.scrollBy({ top: errorCenter - safeCenter, behavior: 'instant' });
    }
  }
}
