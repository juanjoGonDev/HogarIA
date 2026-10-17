import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { IconComponent } from '../icon/icon.component';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [TranslatePipe, CommonModule, IconComponent],
  template: `
    <div
      *ngIf="isOpen"
      #overlay
      class="modal-overlay"
      [class.modal-overlay--visual-viewport]="adaptToVisualViewport"
      (click)="onOverlayClick($event)"
    >
      <div
        #dialog
        [class]="getModalClasses()"
        role="dialog"
        [attr.aria-label]="title"
        [attr.aria-describedby]="descriptionId || null"
        tabindex="-1"
      >
        <div class="modal__header">
          <h2 class="modal__title">{{ title }}</h2>
          <button
            *ngIf="closable"
            type="button"
            class="modal__close"
            (click)="close()"
            [attr.aria-label]="'ui.close' | t"
          >
            <app-icon name="close" [size]="18" [label]="null" />
          </button>
        </div>

        <div #body class="modal__body">
          <ng-content></ng-content>
        </div>

        <div *ngIf="showFooter" class="modal__footer">
          <ng-content select="[footer]"></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        padding: var(--space-4);
        animation: fadeIn var(--duration-200) var(--ease-out);
      }

      .modal-overlay--visual-viewport {
        inset: auto;
        top: var(--modal-visual-viewport-top, 0px);
        left: 0;
        right: 0;
        bottom: auto;
        height: var(--modal-visual-viewport-height, 100vh);
        box-sizing: border-box;
      }

      .modal {
        background: var(--bg-secondary);
        border-radius: var(--radius-2xl);
        box-shadow: var(--shadow-xl);
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 2rem);
        animation: scaleIn var(--duration-200) var(--ease-out);
      }

      @media (prefers-reduced-motion: reduce) {
        .modal-overlay,
        .modal,
        .modal__close {
          animation: none;
          transition: none;
        }
      }

      .modal--sm {
        width: 100%;
        max-width: 400px;
      }
      .modal--md {
        width: 100%;
        max-width: 500px;
      }
      .modal--lg {
        width: 100%;
        max-width: 700px;
      }
      .modal--xl {
        width: 100%;
        max-width: 900px;
      }
      .modal--full {
        width: 95vw;
        height: 90vh;
      }

      .modal-overlay--visual-viewport .modal {
        box-sizing: border-box;
        min-width: 0;
        min-height: 0;
        max-height: calc(100% - 2rem);
      }

      .modal-overlay--visual-viewport .modal--full {
        height: calc(100% - 2rem);
      }

      .modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4) var(--space-6);
        border-bottom: 1px solid var(--border-default);
      }

      .modal__title {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0 var(--space-3) 0 0;
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }

      .modal__close {
        display: flex;
        flex: 0 0 44px;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: var(--radius-lg);
        background: none;
        border: none;
        color: var(--text-tertiary);
        cursor: pointer;
        transition: var(--transition-fast);

        &:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
      }

      .modal__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: var(--space-6);
      }

      .modal__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-6);
        border-top: 1px solid var(--border-default);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes scaleIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    `
  ]
})
export class ModalComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @ViewChild('overlay') private _overlayRef?: ElementRef<HTMLElement>;
  @ViewChild('dialog') private _dialogRef?: ElementRef<HTMLElement>;
  @ViewChild('body') private _bodyRef?: ElementRef<HTMLElement>;

  @Input() isOpen = false;
  @Input() title = '';
  @Input() descriptionId: string | null = null;
  @Input() size: ModalSize = 'md';
  @Input() closable = true;
  @Input() showFooter = false;
  @Input() closeOnOverlay = true;
  @Input() adaptToVisualViewport = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onClose = new EventEmitter<void>();

  private _previouslyFocusedElement: HTMLElement | null = null;
  private _focusOnOpen = false;
  private _trackedVisualViewport: VisualViewport | null = null;
  private _trackedOverlay: HTMLElement | null = null;
  private readonly _handleVisualViewportChange = (): void => {
    this._applyVisualViewportGeometry();
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true && changes['isOpen'].previousValue !== true) {
      const activeElement = document.activeElement;
      this._previouslyFocusedElement = activeElement instanceof HTMLElement ? activeElement : null;
      this._focusOnOpen = true;
    } else if (changes['isOpen']?.currentValue === false) {
      this._restoreFocus();
    }
  }

  ngAfterViewChecked(): void {
    this._syncVisualViewportTracking();
    this._updateAccessibilityAttributes();

    if (this._focusOnOpen && this.isOpen) {
      this._focusOnOpen = false;
      this._focusFirstElement();
    }
  }

  ngOnDestroy(): void {
    this._stopVisualViewportTracking();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (!event.defaultPrevented && this.closable && this.isOpen && this._isTopmostDialog()) {
      event.preventDefault();
      this.close();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onTabKey(event: KeyboardEvent): void {
    if (!this.isOpen || event.key !== 'Tab' || !this._isTopmostDialog()) {
      return;
    }

    const dialog = this._dialogRef?.nativeElement;
    if (!dialog) {
      return;
    }

    const focusableElements = this._getFocusableElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const focusIsOutsideDialog = !dialog.contains(document.activeElement);

    if (event.shiftKey && (document.activeElement === firstElement || focusIsOutsideDialog)) {
      event.preventDefault();
      lastElement.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === lastElement || focusIsOutsideDialog)
    ) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  close(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.onClose.emit();
    this._restoreFocus();
  }

  onOverlayClick(event: MouseEvent): void {
    if (this.closeOnOverlay && (event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close();
    }
  }

  getModalClasses(): string {
    return `modal modal--${this.size}`;
  }

  resetBodyScroll(): void {
    if (this._bodyRef) this._bodyRef.nativeElement.scrollTop = 0;
  }

  private _focusFirstElement(dialog = this._dialogRef?.nativeElement): void {
    if (!dialog) {
      return;
    }

    const [firstElement] = this._getFocusableElements(dialog);
    (firstElement ?? dialog).focus();
  }

  private _getFocusableElements(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('hidden') && element.tabIndex >= 0
    );
  }

  private _restoreFocus(): void {
    const previouslyFocusedElement = this._previouslyFocusedElement;
    this._previouslyFocusedElement = null;
    const dialog = this._dialogRef?.nativeElement;
    const closingOverlay = dialog?.closest('.modal-overlay');
    const remainingOverlays = Array.from(
      document.querySelectorAll<HTMLElement>('.modal-overlay')
    ).filter((overlay) => overlay !== closingOverlay);
    const remainingOverlay = remainingOverlays[remainingOverlays.length - 1];
    const remainingDialog = remainingOverlay?.querySelector<HTMLElement>('[role="dialog"]');

    if (remainingDialog) {
      remainingDialog.setAttribute('aria-modal', 'true');
      remainingDialog.removeAttribute('aria-hidden');
      remainingDialog.removeAttribute('inert');
      if (
        previouslyFocusedElement?.isConnected &&
        remainingDialog.contains(previouslyFocusedElement)
      ) {
        previouslyFocusedElement.focus();
      } else {
        this._focusFirstElement(remainingDialog);
      }
      return;
    }

    if (previouslyFocusedElement?.isConnected && !dialog?.contains(previouslyFocusedElement)) {
      previouslyFocusedElement.focus();
    }
  }

  private _isTopmostDialog(): boolean {
    const dialog = this._dialogRef?.nativeElement;
    const overlay = dialog?.closest('.modal-overlay');
    const overlays = document.querySelectorAll('.modal-overlay');
    if (!overlay) return false;
    return overlays.length === 0 || overlays[overlays.length - 1] === overlay;
  }

  private _updateAccessibilityAttributes(): void {
    const dialog = this._dialogRef?.nativeElement;
    if (!dialog || !this.isOpen) return;

    if (this._isTopmostDialog()) {
      dialog.setAttribute('aria-modal', 'true');
      dialog.removeAttribute('aria-hidden');
      dialog.removeAttribute('inert');
      return;
    }

    dialog.removeAttribute('aria-modal');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.setAttribute('inert', '');
  }

  private _syncVisualViewportTracking(): void {
    if (!this.isOpen || !this.adaptToVisualViewport) {
      this._stopVisualViewportTracking();
      return;
    }

    const overlay = this._overlayRef?.nativeElement;
    const visualViewport = window.visualViewport;
    if (!overlay || !visualViewport) {
      this._stopVisualViewportTracking();
      return;
    }

    if (this._trackedVisualViewport !== visualViewport || this._trackedOverlay !== overlay) {
      this._stopVisualViewportTracking();
      this._trackedVisualViewport = visualViewport;
      this._trackedOverlay = overlay;
      visualViewport.addEventListener('resize', this._handleVisualViewportChange, {
        passive: true
      });
      visualViewport.addEventListener('scroll', this._handleVisualViewportChange, {
        passive: true
      });
      window.addEventListener('resize', this._handleVisualViewportChange, { passive: true });
    }

    this._applyVisualViewportGeometry();
  }

  private _applyVisualViewportGeometry(): void {
    const overlay = this._trackedOverlay;
    const visualViewport = this._trackedVisualViewport;
    if (!overlay || !visualViewport) return;

    overlay.style.setProperty('--modal-visual-viewport-top', `${visualViewport.offsetTop}px`);
    overlay.style.setProperty(
      '--modal-visual-viewport-height',
      `${Math.min(visualViewport.height, window.innerHeight)}px`
    );
    this._ensureFocusedElementIsVisible();
  }

  private _stopVisualViewportTracking(): void {
    this._trackedVisualViewport?.removeEventListener('resize', this._handleVisualViewportChange);
    this._trackedVisualViewport?.removeEventListener('scroll', this._handleVisualViewportChange);
    window.removeEventListener('resize', this._handleVisualViewportChange);
    this._trackedOverlay?.style.removeProperty('--modal-visual-viewport-top');
    this._trackedOverlay?.style.removeProperty('--modal-visual-viewport-height');
    this._trackedVisualViewport = null;
    this._trackedOverlay = null;
  }

  private _ensureFocusedElementIsVisible(): void {
    const body = this._bodyRef?.nativeElement;
    const dialog = this._dialogRef?.nativeElement;
    const activeElement = document.activeElement;
    if (
      !body ||
      !dialog ||
      !(activeElement instanceof HTMLElement) ||
      !dialog.contains(activeElement)
    ) {
      return;
    }

    const bodyRect = body.getBoundingClientRect();
    const activeRect = activeElement.getBoundingClientRect();
    const visibleTop = bodyRect.top + body.clientTop;
    const footerTop = dialog
      .querySelector<HTMLElement>('.modal__footer')
      ?.getBoundingClientRect().top;
    const visibleBottom =
      Math.min(visibleTop + body.clientHeight, footerTop ?? bodyRect.bottom) - 8;
    if (activeRect.top < visibleTop) {
      body.scrollTop -= visibleTop - activeRect.top;
    } else if (activeRect.bottom > visibleBottom) {
      body.scrollTop += activeRect.bottom - visibleBottom;
    }
  }
}
