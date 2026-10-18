import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  inject,
  signal
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import type { AssistantRouteHint } from '../models/ai-action-assistant.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from './ui/icon/icon.component';
import { AiActionAssistantDialogComponent } from './ai-action-assistant-dialog.component';

@Component({
  selector: 'app-ai-action-assistant-launcher',
  standalone: true,
  host: { '[class.assistant-launcher--open]': 'isOpen()' },
  imports: [CommonModule, TranslatePipe, IconComponent, AiActionAssistantDialogComponent],
  template: `
    <button
      *ngIf="!keyboardOpen()"
      class="assistant-launcher__button"
      type="button"
      [attr.aria-label]="'ai_assistant.open' | t"
      [class.assistant-launcher__button--household]="!!householdId"
      [attr.title]="'ai_assistant.open' | t"
      data-test="ai-assistant-open"
      (click)="open()"
    >
      <app-icon name="smart_toy" [size]="24" [label]="null" />
    </button>

    @defer (when isOpen()) {
      @if (isOpen()) {
        <app-ai-action-assistant-dialog [routeHint]="routeHint()" (dismiss)="close()" />
      }
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        z-index: 91;
        right: max(var(--space-5), env(safe-area-inset-right, 0px));
        bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
        display: block;
        pointer-events: none;
        --assistant-household-extra-lift: 0px;
        --primary: var(--color-primary-700);
        --primary-dark: var(--color-primary-800);
      }

      :host(.assistant-launcher--open) {
        z-index: 1001;
        pointer-events: auto;
      }

      .assistant-launcher__button {
        box-sizing: border-box;
        display: grid;
        place-items: center;
        pointer-events: auto;
        width: 52px;
        height: 52px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-lg);
        background: var(--primary);
        color: var(--white);
        box-shadow: var(--shadow-md);
        cursor: pointer;
        transition:
          background-color var(--duration-150) var(--ease-out),
          opacity var(--duration-150) var(--ease-out);
      }

      .assistant-launcher__button:hover {
        background: var(--primary-dark);
      }

      .assistant-launcher__button--household {
        transform: translateY(calc(-1 * var(--assistant-household-extra-lift, 0px)));
      }

      .assistant-launcher__button:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 3px;
      }

      @media (max-width: 767px) {
        :host {
          right: max(var(--space-3), env(safe-area-inset-right, 0px));
          bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-3));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .assistant-launcher__button {
          transition: none;
        }
      }
    `
  ]
})
export class AiActionAssistantLauncherComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() householdId: string | null = null;

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly visualViewport = typeof window === 'undefined' ? null : window.visualViewport;
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);

  readonly isOpen = signal(false);
  readonly keyboardOpen = signal(false);
  readonly routeHint = signal<AssistantRouteHint>(this.routeFromUrl(this.router.url));
  private noticeResizeObserver: ResizeObserver | null = null;
  private noticeMutationObserver: MutationObserver | null = null;
  private layoutFrame: number | null = null;
  private viewInitialized = false;
  private householdExtraLift = 0;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => this.routeHint.set(this.routeFromUrl(event.urlAfterRedirects)));
    this.visualViewport?.addEventListener('resize', this.onViewportResize);
    this.updateKeyboardState();
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.observeHouseholdNotice();
  }

  ngOnChanges(): void {
    if (this.viewInitialized) this.observeHouseholdNotice();
  }

  ngOnDestroy(): void {
    this.visualViewport?.removeEventListener('resize', this.onViewportResize);
    this.noticeResizeObserver?.disconnect();
    this.noticeMutationObserver?.disconnect();
    if (this.layoutFrame !== null) {
      this.elementRef.nativeElement.ownerDocument.defaultView?.cancelAnimationFrame(
        this.layoutFrame
      );
      this.layoutFrame = null;
    }
  }

  async open(): Promise<void> {
    try {
      await this.i18n.loadAssistantTranslations();
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('ai_assistant.load_error'));
      return;
    }
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  private readonly onViewportResize = (): void => {
    this.updateKeyboardState();
    this.updateHouseholdNoticeLayout();
  };

  @HostListener('window:resize')
  onWindowResize(): void {
    this.onViewportResize();
  }

  private observeHouseholdNotice(): void {
    this.noticeResizeObserver?.disconnect();
    this.noticeMutationObserver?.disconnect();
    this.noticeResizeObserver = null;
    this.noticeMutationObserver = null;

    const host = this.elementRef.nativeElement as HTMLElement;
    const document = host.ownerDocument as Document;
    const view = document.defaultView;
    if (!this.householdId || !view) {
      this.setHouseholdExtraLift(0);
      return;
    }

    const notice = document.querySelector(
      'app-household-planning-automation-notice'
    ) as HTMLElement | null;
    if (!notice) {
      const observationRoot = host.parentElement ?? document.body;
      if (typeof MutationObserver !== 'undefined') {
        this.noticeMutationObserver = new MutationObserver(() => {
          if (document.querySelector('app-household-planning-automation-notice')) {
            this.observeHouseholdNotice();
          }
        });
        this.noticeMutationObserver.observe(observationRoot, { childList: true, subtree: true });
      }
      this.setHouseholdExtraLift(0);
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.noticeResizeObserver = new ResizeObserver(this.scheduleHouseholdNoticeLayout);
      this.noticeResizeObserver.observe(notice);
    }
    if (typeof MutationObserver !== 'undefined') {
      this.noticeMutationObserver = new MutationObserver(() => {
        if (document.querySelector('app-household-planning-automation-notice') !== notice) {
          this.observeHouseholdNotice();
          return;
        }
        this.scheduleHouseholdNoticeLayout();
      });
      this.noticeMutationObserver.observe(notice, {
        childList: true,
        characterData: true,
        subtree: true
      });
      if (notice.parentElement) {
        this.noticeMutationObserver.observe(notice.parentElement, { childList: true });
      }
    }
    this.scheduleHouseholdNoticeLayout();
  }

  private readonly scheduleHouseholdNoticeLayout = (): void => {
    const view = this.elementRef.nativeElement.ownerDocument.defaultView;
    if (!view || this.layoutFrame !== null) return;
    this.layoutFrame = view.requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.updateHouseholdNoticeLayout();
    });
  };

  private updateHouseholdNoticeLayout(): void {
    const host = this.elementRef.nativeElement as HTMLElement;
    const button = host.querySelector(
      '.assistant-launcher__button--household'
    ) as HTMLElement | null;
    const notice = host.ownerDocument.querySelector(
      'app-household-planning-automation-notice'
    ) as HTMLElement | null;
    if (!button || !notice) {
      this.setHouseholdExtraLift(0);
      return;
    }

    const buttonBounds = button.getBoundingClientRect();
    const noticeBounds = notice.getBoundingClientRect();
    if (buttonBounds.width <= 0 || buttonBounds.height <= 0 || noticeBounds.height <= 0) {
      this.setHouseholdExtraLift(0);
      return;
    }

    const horizontalOverlap =
      buttonBounds.left < noticeBounds.right && buttonBounds.right > noticeBounds.left;
    if (!horizontalOverlap) {
      this.setHouseholdExtraLift(0);
      return;
    }

    const baseTop = buttonBounds.top + this.householdExtraLift;
    const baseBottom = buttonBounds.bottom + this.householdExtraLift;
    const verticalOverlap = baseTop < noticeBounds.bottom && baseBottom > noticeBounds.top;
    if (!verticalOverlap) {
      this.setHouseholdExtraLift(0);
      return;
    }

    const clearance = this.spacingTokenInPixels('--space-2', 8);
    const extraLift = Math.max(0, Math.ceil(baseBottom - noticeBounds.top + clearance));
    this.setHouseholdExtraLift(extraLift);
  }

  private spacingTokenInPixels(token: string, fallback: number): number {
    const host = this.elementRef.nativeElement as HTMLElement;
    const view = host.ownerDocument.defaultView;
    if (!view) return fallback;

    const value = view.getComputedStyle(host).getPropertyValue(token).trim();
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return fallback;
    if (value.endsWith('rem')) {
      return (
        amount *
        Number.parseFloat(view.getComputedStyle(host.ownerDocument.documentElement).fontSize)
      );
    }
    if (value.endsWith('em'))
      return amount * Number.parseFloat(view.getComputedStyle(host).fontSize);
    return amount;
  }

  private setHouseholdExtraLift(value: number): void {
    this.householdExtraLift = value;
    const host = this.elementRef.nativeElement as HTMLElement;
    host.style.setProperty('--assistant-household-extra-lift', `${value}px`);
  }

  private updateKeyboardState(): void {
    if (typeof window === 'undefined' || !this.visualViewport) return;
    const isNarrow = window.matchMedia('(max-width: 767px)').matches;
    this.keyboardOpen.set(isNarrow && window.innerHeight - this.visualViewport.height > 160);
  }

  private routeFromUrl(url: string): AssistantRouteHint {
    const segment = url.split(/[/?#]/).filter(Boolean)[0];
    switch (segment) {
      case 'pantry':
      case 'shopping':
      case 'calendar':
      case 'recipes':
      case 'household':
        return segment;
      default:
        return 'dashboard';
    }
  }
}
