import { MobileDrawerGestureController } from './mobile-drawer-gesture.controller';

describe('MobileDrawerGestureController', () => {
  let controller: MobileDrawerGestureController;
  let sidebar: HTMLElement;
  let overlay: HTMLElement;
  let edgeSensor: HTMLElement;
  let isOpen: boolean;
  let onDragging: jasmine.Spy;
  let onSettle: jasmine.Spy;

  beforeEach(() => {
    isOpen = false;
    onDragging = jasmine.createSpy('onDragging');
    onSettle = jasmine.createSpy('onSettle');

    sidebar = document.createElement('aside');
    sidebar.id = 'primary-sidebar';
    sidebar.className = 'sidebar';
    sidebar.style.transform = 'translateX(-280px)';
    Object.defineProperty(sidebar, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number(
          sidebar.style.transform.match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? -280
        );
        return {
          left,
          right: left + 280,
          width: 280,
          top: 0,
          bottom: 700,
          height: 700,
          x: left,
          y: 0,
          toJSON: () => ({})
        } as DOMRect;
      }
    });
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    edgeSensor = document.createElement('div');
    edgeSensor.className = 'sidebar-edge-sensor';
    document.body.append(sidebar, overlay, edgeSensor);

    controller = new MobileDrawerGestureController({
      isMobileViewport: () => true,
      isOpen: () => isOpen,
      sidebarElement: () => sidebar,
      overlayElement: () => overlay,
      onDragging,
      onSettle
    });
  });

  afterEach(() => {
    controller.destroy();
    sidebar.remove();
    overlay.remove();
    edgeSensor.remove();
  });

  it('tracks an opening edge swipe progressively and settles open on release', async () => {
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 10);
    dispatchPointer(document, 'pointermove', 160, 100, 10);
    await nextFrame();

    expect(sidebar.style.transform).toBe('translateX(-132px)');
    expect(Number(overlay.style.opacity)).toBeCloseTo(148 / 280 / 2, 3);
    expect(onDragging).toHaveBeenCalledWith(true);

    dispatchPointer(document, 'pointerup', 160, 100, 10);

    expect(onSettle).toHaveBeenCalledWith(true, 'edge');
  });

  it('settles a fast reverse swipe closed from the panel', () => {
    isOpen = true;
    sidebar.style.transform = 'translateX(0px)';

    dispatchPointer(sidebar, 'pointerdown', 220, 100, 11);
    dispatchPointer(document, 'pointermove', 140, 100, 11);
    dispatchPointer(document, 'pointerup', 140, 100, 11);

    expect(onSettle).toHaveBeenCalledWith(false, 'panel');
  });

  it('settles pointer cancellation to the nearest side and clears the pending frame', async () => {
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 14, 0);
    dispatchPointer(document, 'pointermove', 152, 100, 14, 1000);
    dispatchPointer(document, 'pointercancel', 152, 100, 14, 1001);
    await nextFrame();

    expect(onSettle).toHaveBeenCalledWith(true, 'edge');
    expect(sidebar.style.transform).toBe('translateX(0px)');
    expect(onDragging).toHaveBeenCalledWith(false);
  });

  it('cancels a pointer below the midpoint back to the closed position', () => {
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 15, 0);
    dispatchPointer(document, 'pointermove', 151, 100, 15, 1000);
    dispatchPointer(document, 'pointercancel', 151, 100, 15, 1001);

    expect(onSettle).toHaveBeenCalledWith(false, 'edge');
    expect(sidebar.style.transform).toBe('translateX(-280px)');
  });

  it('uses the inclusive 50% progress boundary for slow opening and closing', () => {
    const settle = (openAtStart: boolean, deltaX: number, pointerId: number) => {
      isOpen = openAtStart;
      sidebar.style.transform = openAtStart ? 'translateX(0px)' : 'translateX(-280px)';
      onSettle.calls.reset();
      const target = openAtStart ? sidebar : edgeSensor;
      const startX = openAtStart ? 220 : 12;
      dispatchPointer(target, 'pointerdown', startX, 100, pointerId, 0);
      dispatchPointer(document, 'pointermove', startX + deltaX, 100, pointerId, 1000);
      dispatchPointer(document, 'pointerup', startX + deltaX, 100, pointerId, 1001);
      return onSettle.calls.mostRecent().args[0] as boolean;
    };

    expect(settle(false, 139, 16)).toBeFalse();
    expect(settle(false, 140, 17)).toBeTrue();
    expect(settle(true, -140, 18)).toBeTrue();
    expect(settle(true, -141, 19)).toBeFalse();
  });

  it('uses inclusive opening and closing velocity thresholds of 0.45 px/ms', () => {
    const settle = (openAtStart: boolean, deltaX: number, elapsedMs: number, pointerId: number) => {
      isOpen = openAtStart;
      sidebar.style.transform = openAtStart ? 'translateX(0px)' : 'translateX(-280px)';
      onSettle.calls.reset();
      const target = openAtStart ? sidebar : edgeSensor;
      const startX = openAtStart ? 220 : 12;
      dispatchPointer(target, 'pointerdown', startX, 100, pointerId, 0);
      dispatchPointer(document, 'pointermove', startX + deltaX, 100, pointerId, elapsedMs);
      dispatchPointer(document, 'pointerup', startX + deltaX, 100, pointerId, elapsedMs + 1);
      return onSettle.calls.mostRecent().args[0] as boolean;
    };

    expect(settle(false, 9, 20, 20)).toBeTrue();
    expect(settle(false, 9, 21, 21)).toBeFalse();
    expect(settle(true, -9, 20, 22)).toBeFalse();
    expect(settle(true, -9, 21, 23)).toBeTrue();
  });

  it('settles without a visible animation when reduced motion is requested', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 24, 0);
    dispatchPointer(document, 'pointermove', 152, 100, 24, 1000);
    dispatchPointer(document, 'pointerup', 152, 100, 24, 1001);

    expect(onSettle).toHaveBeenCalledWith(true, 'edge');
    expect(sidebar.style.transition).toContain('0.01ms');
    expect(overlay.style.transition).toContain('0.01ms');
    expect(sidebar.style.transform).toBe('translateX(0px)');
  });

  it('does not cancel vertical movement intended for page scrolling', () => {
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 12);
    const move = dispatchPointer(document, 'pointermove', 14, 140, 12);

    expect(move.defaultPrevented).toBeFalse();
    expect(onDragging).not.toHaveBeenCalled();
  });

  it('suppresses the synthetic click after a horizontal gesture', () => {
    dispatchPointer(edgeSensor, 'pointerdown', 12, 100, 13);
    dispatchPointer(document, 'pointermove', 80, 100, 13);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    controller.suppressGestureClick(click);

    expect(click.defaultPrevented).toBeTrue();
  });

  function dispatchPointer(
    target: EventTarget,
    type: string,
    clientX: number,
    clientY: number,
    pointerId: number,
    timeStamp?: number
  ): PointerEvent {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      isPrimary: true,
      pointerId,
      clientX,
      clientY
    });
    if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
    return event;
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
});
