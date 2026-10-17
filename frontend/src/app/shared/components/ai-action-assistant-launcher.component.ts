import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  Input,
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
        --primary: var(--color-primary-700);
        --primary-dark: var(--color-primary-800);
      }

      :host(.assistant-launcher--open) {
        z-index: 1001;
      }

      .assistant-launcher__button {
        box-sizing: border-box;
        display: grid;
        place-items: center;
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
        transform: translateY(calc(-1 * (var(--space-5) + 100px)));
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

        .assistant-launcher__button--household {
          transform: translateY(calc(-1 * 132px));
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
export class AiActionAssistantLauncherComponent implements OnDestroy {
  @Input() householdId: string | null = null;

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly visualViewport = typeof window === 'undefined' ? null : window.visualViewport;
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);

  readonly isOpen = signal(false);
  readonly keyboardOpen = signal(false);
  readonly routeHint = signal<AssistantRouteHint>(this.routeFromUrl(this.router.url));

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

  ngOnDestroy(): void {
    this.visualViewport?.removeEventListener('resize', this.onViewportResize);
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

  private readonly onViewportResize = (): void => this.updateKeyboardState();

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
