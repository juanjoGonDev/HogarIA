import { ElementRef } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  COMMIT_RATIO,
  LONG_PRESS_MS,
  REVEAL_PX,
  LongPressDirective,
  SwipeRowDirective,
  isQuickPlus,
  swipeState
} from './swipe-row.directive';

function pointer(target: HTMLElement, overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    target,
    preventDefault: jasmine.createSpy('preventDefault'),
    ...overrides
  } as unknown as PointerEvent;
}

function stoppedTarget(): HTMLElement {
  const target = document.createElement('span');
  target.dataset['gestureStop'] = '';
  return target;
}

/**
 * Geometria y umbrales puros, probados aparte del ciclo del puntero. El contrato de
 * UI fija 56 px para asomar el riel, el 60 % del ancho para ejecutar y 350 ms de
 * pulsacion larga; el ciclo de vida se cubre en las suites siguientes.
 */
describe('swipe-row — umbrales del gesto', () => {
  const WIDTH = 400;

  it('un dedo que duda no descubre nada', () => {
    expect(swipeState(0, WIDTH)).toEqual({ reveal: 0, armed: false });
    expect(swipeState(-20, WIDTH)).toEqual({ reveal: 0, armed: false });
    expect(swipeState(-REVEAL_PX + 1, WIDTH).reveal).toBe(0);
  });

  it('a partir de 56 px el riel asoma, y crece con el arrastre', () => {
    expect(swipeState(-REVEAL_PX, WIDTH).reveal).toBeCloseTo(REVEAL_PX / WIDTH, 5);
    expect(swipeState(-REVEAL_PX, WIDTH).armed).toBeFalse();
    expect(swipeState(-WIDTH / 2, WIDTH).reveal).toBeCloseTo(0.5, 5);
  });

  it('cruzar el 60 % arma la accion: al soltar se ejecuta, no se mira', () => {
    expect(COMMIT_RATIO).toBe(0.6);
    expect(swipeState(-(WIDTH * COMMIT_RATIO - 1), WIDTH).armed).toBeFalse();
    expect(swipeState(-(WIDTH * COMMIT_RATIO), WIDTH).armed).toBeTrue();
    expect(swipeState(-WIDTH, WIDTH).armed).toBeTrue();
  });

  it('hacia la derecha no hay riel que descubrir', () => {
    expect(swipeState(120, WIDTH).reveal).toBe(0);
    expect(swipeState(120, WIDTH).armed).toBeFalse();
  });

  it('un ancho cero no parte la pantalla (fila oculta, anidada en una transicion)', () => {
    expect(swipeState(-100, 0)).toEqual({ reveal: 0, armed: false });
  });

  it('el swipe derecha cuenta una unidad solo si es decidido', () => {
    expect(isQuickPlus(40, WIDTH)).toBeFalse();
    expect(isQuickPlus(WIDTH * 0.35, WIDTH)).toBeTrue();
    expect(isQuickPlus(REVEAL_PX - 1, 100)).toBeFalse();
    expect(isQuickPlus(REVEAL_PX, 100)).toBeTrue();
    expect(isQuickPlus(WIDTH, WIDTH)).toBeTrue();
    expect(isQuickPlus(-WIDTH, WIDTH)).toBeFalse();
    expect(isQuickPlus(200, 0)).toBeFalse();
  });

  it('la pulsacion larga es de 350 ms, ni un toque ni una espera corta', () => {
    expect(LONG_PRESS_MS).toBe(350);
  });
});

describe('SwipeRowDirective — ciclo de vida del puntero', () => {
  let host: HTMLLIElement;
  let directive: SwipeRowDirective;
  let width: jasmine.Spy;

  beforeEach(() => {
    host = document.createElement('li');
    width = spyOnProperty(host, 'offsetWidth', 'get').and.returnValue(400);
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: new ElementRef(host) }]
    });
    directive = TestBed.runInInjectionContext(() => new SwipeRowDirective());
  });

  it('ignora gesto deshabilitado, botón secundario, control y otro puntero', () => {
    directive.disabled = true;
    directive.onPointerDown(pointer(host));
    expect(directive.dragging).toBeFalse();

    directive.disabled = false;
    directive.onPointerDown(pointer(host, { button: 2 }));
    directive.onPointerDown(pointer(document.createElement('input')));
    directive.onPointerDown(pointer(document.createElement('textarea')));
    directive.onPointerDown(pointer(stoppedTarget()));
    expect(directive.dragging).toBeFalse();

    directive.onPointerDown(pointer(host, { pointerId: 7 }));
    directive.onPointerDown(pointer(host, { pointerId: 8 }));
    const ended = jasmine.createSpy('gestureEnded');
    directive.gestureEnded.subscribe(ended);
    directive.onPointerMove(pointer(host, { pointerId: 8, clientX: 100 }));
    directive.onPointerEnd(pointer(host, { pointerId: 8, clientX: 100 }));
    expect(directive.dragging).toBeTrue();
    expect(ended).not.toHaveBeenCalled();
  });

  it('permite empezar en un botón y mantiene el dedo dudoso fuera del riel', () => {
    const button = document.createElement('button');
    const ended = jasmine.createSpy('gestureEnded');
    const toggles: boolean[] = [];
    directive.gestureEnded.subscribe(ended);
    directive.railToggled.subscribe((open) => toggles.push(open));

    directive.onPointerDown(pointer(button, { clientX: 200, clientY: 40 }));
    directive.onPointerMove(pointer(button, { clientX: 180, clientY: 40 }));
    expect(directive.dragging).toBeTrue();
    directive.onPointerEnd(pointer(button, { clientX: 180, clientY: 40 }));

    expect(host.style.getPropertyValue('--swipe-x')).toBe('0px');
    expect(host.classList.contains('swipe-row--open')).toBeFalse();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(toggles).toEqual([false]);
  });

  it('cede el eje vertical al scroll sin transformar la fila', () => {
    directive.onPointerDown(pointer(host, { clientX: 100, clientY: 100 }));
    const move = pointer(host, { clientX: 104, clientY: 108 });
    directive.onPointerMove(move);
    directive.onPointerEnd(pointer(host, { clientX: 104, clientY: 108 }));

    expect(move.preventDefault).not.toHaveBeenCalled();
    expect(directive.dragging).toBeFalse();
    expect(host.style.getPropertyValue('--swipe-x')).toBe('0px');
    expect(host.classList.contains('swipe-row--open')).toBeFalse();
  });

  it('revela solo al superar 56 px y permite cerrar el riel explícitamente', () => {
    const toggles: boolean[] = [];
    const removed = jasmine.createSpy('swipeRemove');
    directive.railToggled.subscribe((open) => toggles.push(open));
    directive.swipeRemove.subscribe(removed);

    directive.onPointerDown(pointer(host, { clientX: 200 }));
    const move = pointer(host, { clientX: 143 });
    directive.onPointerMove(move);
    expect(move.preventDefault).toHaveBeenCalled();
    expect(host.classList.contains('swipe-row--armed')).toBeFalse();
    directive.onPointerEnd(pointer(host, { clientX: 143 }));

    expect(host.style.getPropertyValue('--swipe-x')).toBe('-134px');
    expect(host.classList.contains('swipe-row--open')).toBeTrue();
    expect(toggles).toEqual([true]);
    expect(removed).not.toHaveBeenCalled();

    directive.closeRail();
    expect(host.style.getPropertyValue('--swipe-x')).toBe('0px');
    expect(host.classList.contains('swipe-row--open')).toBeFalse();
    expect(toggles).toEqual([true, false]);
  });

  it('suma una unidad solo desde max(56 px, 35 %) y limita la previsualización', () => {
    const plus = jasmine.createSpy('swipePlus');
    directive.swipePlus.subscribe(plus);

    directive.onPointerDown(pointer(host, { clientX: 100 }));
    directive.onPointerMove(pointer(host, { clientX: 239 }));
    expect(host.style.getPropertyValue('--swipe-x')).toBe('120px');
    directive.onPointerEnd(pointer(host, { clientX: 239 }));
    expect(plus).not.toHaveBeenCalled();

    directive.onPointerDown(pointer(host, { clientX: 100 }));
    directive.onPointerMove(pointer(host, { clientX: 240 }));
    directive.onPointerEnd(pointer(host, { clientX: 240 }));
    expect(plus).toHaveBeenCalledTimes(1);
    expect(host.style.getPropertyValue('--swipe-x')).toBe('0px');
  });

  it('confirma al 60 %, emite fin del gesto y bloquea el click residual durante 250 ms', fakeAsync(() => {
    const removed = jasmine.createSpy('swipeRemove');
    const ended = jasmine.createSpy('gestureEnded');
    directive.swipeRemove.subscribe(removed);
    directive.gestureEnded.subscribe(ended);

    directive.onPointerDown(pointer(host, { clientX: 300 }));
    directive.onPointerMove(pointer(host, { clientX: 60 }));
    expect(host.classList.contains('swipe-row--armed')).toBeTrue();
    directive.onPointerEnd(pointer(host, { clientX: 60 }));

    expect(removed).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(host.classList.contains('swipe-row--busy')).toBeTrue();
    tick(249);
    expect(host.classList.contains('swipe-row--busy')).toBeTrue();
    tick(1);
    expect(host.classList.contains('swipe-row--busy')).toBeFalse();
  }));

  it('resetea tras pointercancel, ignora anchura cero y limpia al destruirse', () => {
    width.and.returnValue(0);
    const ended = jasmine.createSpy('gestureEnded');
    directive.gestureEnded.subscribe(ended);
    directive.onPointerDown(pointer(host, { clientX: 100 }));
    directive.onPointerMove(pointer(host, { clientX: 80 }));
    directive.onPointerEnd(pointer(host, { clientX: 80 }));
    expect(ended).toHaveBeenCalledTimes(1);

    host.style.setProperty('--swipe-x', '12px');
    directive.ngOnDestroy();
    expect(host.style.getPropertyValue('--swipe-x')).toBe('');
  });

  it('reemplaza el timer de sordera y no deja un timer vivo tras destruirse', fakeAsync(() => {
    const commit = (): void => {
      directive.onPointerDown(pointer(host, { clientX: 300 }));
      directive.onPointerMove(pointer(host, { clientX: 60 }));
      directive.onPointerEnd(pointer(host, { clientX: 60 }));
    };

    commit();
    tick(100);
    commit();
    tick(150);
    expect(host.classList.contains('swipe-row--busy')).toBeTrue();
    tick(100);
    expect(host.classList.contains('swipe-row--busy')).toBeFalse();

    commit();
    directive.ngOnDestroy();
    tick(250);
    expect(host.classList.contains('swipe-row--busy')).toBeTrue();
  }));
});

describe('LongPressDirective — temporizador y click residual', () => {
  let directive: LongPressDirective;

  beforeEach(() => {
    directive = new LongPressDirective();
  });

  it('emite a los 350 ms y consume el click posterior una sola vez', fakeAsync(() => {
    const emitted = jasmine.createSpy('longPress');
    directive.longPress.subscribe(emitted);
    const target = document.createElement('div');
    directive.start(pointer(target));

    tick(LONG_PRESS_MS - 1);
    expect(emitted).not.toHaveBeenCalled();
    tick(1);
    expect(emitted).toHaveBeenCalledTimes(1);

    const click = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as unknown as MouseEvent;
    directive.onClick(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();

    const nextClick = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as unknown as MouseEvent;
    directive.onClick(nextClick);
    expect(nextClick.preventDefault).not.toHaveBeenCalled();
    expect(nextClick.stopPropagation).not.toHaveBeenCalled();
  }));

  it('cancela por movimiento, liberación temprana o pointercancel', fakeAsync(() => {
    const emitted = jasmine.createSpy('longPress');
    directive.longPress.subscribe(emitted);
    const target = document.createElement('div');

    directive.start(pointer(target, { clientX: 10, clientY: 10 }));
    directive.move(pointer(target, { clientX: 23, clientY: 10 }));
    tick(LONG_PRESS_MS);
    expect(emitted).not.toHaveBeenCalled();

    directive.start(pointer(target));
    tick(100);
    directive.stop();
    tick(LONG_PRESS_MS);
    expect(emitted).not.toHaveBeenCalled();

    directive.start(pointer(target));
    tick(100);
    directive.stop();
    tick(LONG_PRESS_MS);
    expect(emitted).not.toHaveBeenCalled();
  }));

  it('no inicia con el gesto deshabilitado, secundario o dentro de un control', fakeAsync(() => {
    const emitted = jasmine.createSpy('longPress');
    directive.longPress.subscribe(emitted);
    const target = document.createElement('div');

    directive.longPressDisabled = true;
    directive.start(pointer(target));
    directive.longPressDisabled = false;
    directive.start(pointer(target, { button: 2 }));
    directive.start(pointer(document.createElement('input')));
    directive.start(pointer(document.createElement('select')));
    directive.start(pointer(document.createElement('textarea')));
    directive.start(pointer(stoppedTarget()));

    tick(LONG_PRESS_MS);
    expect(emitted).not.toHaveBeenCalled();
  }));

  it('no cancela dentro del margen de movimiento y limpia timer ya vencido', fakeAsync(() => {
    const emitted = jasmine.createSpy('longPress');
    directive.longPress.subscribe(emitted);
    const target = document.createElement('div');
    directive.start(pointer(target, { clientX: 20, clientY: 20 }));
    directive.move(pointer(target, { clientX: 32, clientY: 32 }));
    tick(LONG_PRESS_MS);
    expect(emitted).toHaveBeenCalledTimes(1);

    directive.stop();
    directive.stop();
    directive.move(pointer(target, { clientX: 20, clientY: 20 }));
    expect(emitted).toHaveBeenCalledTimes(1);
  }));
});
