export type DrawerGestureSource = 'edge' | 'panel' | 'overlay';

interface DrawerPointerGesture {
  pointerId: number;
  source: DrawerGestureSource;
  startX: number;
  startY: number;
  startLeft: number;
  panelWidth: number;
  previousX: number;
  previousTime: number;
  lastX: number;
  lastTime: number;
  horizontal: boolean;
  deltaX: number;
}

interface DrawerGestureHost {
  isMobileViewport(): boolean;
  isOpen(): boolean;
  sidebarElement(): HTMLElement | null;
  overlayElement(): HTMLElement | null;
  onDragging(dragging: boolean): void;
  onSettle(open: boolean, source: DrawerGestureSource): void;
}

export class MobileDrawerGestureController {
  private gesture: DrawerPointerGesture | null = null;
  private frame: number | null = null;
  private suppressNextClick = false;
  private suppressionTimer: number | null = null;

  private readonly pointerDown = (event: PointerEvent): void => this.handlePointerDown(event);
  private readonly pointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
  private readonly pointerUp = (event: PointerEvent): void => this.handlePointerEnd(event);
  private readonly pointerCancel = (event: PointerEvent): void => this.handlePointerCancel(event);
  private readonly touchMove = (event: TouchEvent): void => this.handleTouchMove(event);

  constructor(private readonly host: DrawerGestureHost) {
    document.addEventListener('pointerdown', this.pointerDown, true);
    document.addEventListener('pointermove', this.pointerMove, { passive: false });
    document.addEventListener('pointerup', this.pointerUp);
    document.addEventListener('pointercancel', this.pointerCancel);
    document.addEventListener('touchmove', this.touchMove, { passive: false });
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.pointerDown, true);
    document.removeEventListener('pointermove', this.pointerMove);
    document.removeEventListener('pointerup', this.pointerUp);
    document.removeEventListener('pointercancel', this.pointerCancel);
    document.removeEventListener('touchmove', this.touchMove);
    this.cancel();
    if (this.suppressionTimer !== null) window.clearTimeout(this.suppressionTimer);
  }

  cancel(): void {
    this.gesture = null;
    this.host.onDragging(false);
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    const sidebar = this.host.sidebarElement();
    if (sidebar) {
      sidebar.style.transform = '';
      sidebar.style.transition = '';
    }
  }

  suppressGestureClick(event: Event): void {
    if (!this.suppressNextClick) return;
    event.preventDefault();
    event.stopPropagation();
    this.suppressNextClick = false;
    if (this.suppressionTimer !== null) window.clearTimeout(this.suppressionTimer);
    this.suppressionTimer = null;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.host.isMobileViewport()) return;
    const target = event.target instanceof Element ? event.target : null;
    const panelRight = this.host.sidebarElement()?.getBoundingClientRect().right ?? 0;
    const source: DrawerGestureSource | null = target?.closest('.sidebar-edge-sensor')
      ? 'edge'
      : target?.closest('.sidebar')
        ? 'panel'
        : target?.closest('.sidebar-overlay')
          ? 'overlay'
          : this.host.isOpen()
            ? event.clientX <= panelRight
              ? 'panel'
              : 'overlay'
            : event.clientX <= 24
              ? 'edge'
              : null;
    if (source) this.beginGesture(event, source);
  }

  private beginGesture(event: PointerEvent, source: DrawerGestureSource): void {
    if (event.pointerType !== 'touch' || !event.isPrimary || this.gesture) return;
    const open = this.host.isOpen();
    if ((source === 'edge' && open) || (source !== 'edge' && !open)) return;
    const sidebar = this.host.sidebarElement();
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    if (source === 'edge' && event.clientX > 24) return;
    this.gesture = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: this.clamp(rect.left, -width, 0),
      panelWidth: width,
      previousX: event.clientX,
      previousTime: event.timeStamp,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      horizontal: false,
      deltaX: 0
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.horizontal) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        this.gesture = null;
        return;
      }
      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
      const opening = gesture.source === 'edge';
      if ((opening && deltaX <= 0) || (!opening && deltaX >= 0)) {
        this.gesture = null;
        return;
      }
      gesture.horizontal = true;
      const sidebar = this.host.sidebarElement();
      if (sidebar) {
        sidebar.style.transition = 'none';
        sidebar.style.transform = `translateX(${gesture.startLeft}px)`;
      }
      const overlay = this.host.overlayElement();
      if (overlay) overlay.style.transition = 'none';
      this.suppressNextClick = true;
      this.suppressionTimer = window.setTimeout(() => {
        this.suppressNextClick = false;
        this.suppressionTimer = null;
      }, 400);
      this.host.onDragging(true);
    }
    event.preventDefault();
    gesture.deltaX = deltaX;
    gesture.previousX = gesture.lastX;
    gesture.previousTime = gesture.lastTime;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.applyGesturePosition(gesture);
    });
  }

  private handlePointerEnd(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;
    if (!gesture.horizontal) return;
    this.applyPendingFrame(gesture);
    const velocity =
      (gesture.lastX - gesture.previousX) / Math.max(1, gesture.lastTime - gesture.previousTime);
    const currentLeft = this.currentSidebarLeft(gesture);
    const progress = 1 + currentLeft / gesture.panelWidth;
    const open = velocity >= 0.45 ? true : velocity <= -0.45 ? false : progress >= 0.5;
    this.settleGesture(open, gesture);
  }

  private handlePointerCancel(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;
    if (!gesture.horizontal) return;
    this.applyPendingFrame(gesture);
    const progress = 1 + this.currentSidebarLeft(gesture) / gesture.panelWidth;
    this.settleGesture(progress >= 0.5, gesture);
  }

  private handleTouchMove(event: TouchEvent): void {
    const gesture = this.gesture;
    const touch = event.changedTouches[0];
    if (!touch || !event.cancelable) return;
    if (!gesture) {
      if (this.host.isOpen() && !this.host.sidebarElement()?.contains(event.target as Node)) {
        event.preventDefault();
      }
      return;
    }
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const opening = gesture.source === 'edge';
    const horizontal = Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (horizontal && ((opening && deltaX > 0) || (!opening && deltaX < 0))) {
      event.preventDefault();
    }
  }

  private settleGesture(open: boolean, gesture: DrawerPointerGesture): void {
    this.host.onDragging(false);
    this.host.onSettle(open, gesture.source);
    const sidebar = this.host.sidebarElement();
    const overlay = this.host.overlayElement();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? '0.01ms' : '220ms';
    if (sidebar) {
      sidebar.style.transition = `transform ${duration} var(--ease-out)`;
      sidebar.style.transform = open ? 'translateX(0px)' : `translateX(${-gesture.panelWidth}px)`;
      sidebar.addEventListener(
        'transitionend',
        () => {
          if (this.gesture) return;
          sidebar.style.transform = '';
          sidebar.style.transition = '';
        },
        { once: true }
      );
    }
    if (overlay) {
      overlay.style.transition = `opacity ${duration} var(--ease-out)`;
      overlay.style.opacity = open ? '1' : '0';
    }
  }

  private applyPendingFrame(gesture: DrawerPointerGesture): void {
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.applyGesturePosition(gesture);
  }

  private applyGesturePosition(gesture: DrawerPointerGesture): void {
    const sidebar = this.host.sidebarElement();
    if (!sidebar) return;
    const left = this.clamp(gesture.startLeft + gesture.deltaX, -gesture.panelWidth, 0);
    sidebar.style.transform = `translateX(${left}px)`;
    const overlay = this.host.overlayElement();
    if (overlay) overlay.style.opacity = String((1 + left / gesture.panelWidth) * 0.5);
  }

  private currentSidebarLeft(gesture: DrawerPointerGesture): number {
    return (
      this.host.sidebarElement()?.getBoundingClientRect().left ??
      this.clamp(gesture.startLeft + gesture.deltaX, -gesture.panelWidth, 0)
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
