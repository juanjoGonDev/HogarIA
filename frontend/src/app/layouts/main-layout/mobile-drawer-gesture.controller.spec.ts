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
    pointerId: number
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
    target.dispatchEvent(event);
    return event;
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
});
