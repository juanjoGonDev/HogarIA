import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

describe('ModalComponent', () => {
  let component: ModalComponent;
  let fixture: ComponentFixture<ModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not render when isOpen is false', () => {
    component.isOpen = false;
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.modal-overlay');
    expect(overlay).toBeFalsy();
  });

  it('tracks the visual viewport while an opted-in modal is open and releases its listeners', () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = new EventTarget() as VisualViewport;
    let height = 560;
    let top = 12;
    Object.defineProperties(viewport, {
      width: { configurable: true, get: () => 393 },
      height: { configurable: true, get: () => height },
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: { configurable: true, get: () => top }
    });
    const removeEventListener = spyOn(viewport, 'removeEventListener').and.callThrough();
    const removeWindowEventListener = spyOn(window, 'removeEventListener').and.callThrough();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport
    });

    try {
      fixture.componentRef.setInput('adaptToVisualViewport', true);
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const overlay = fixture.nativeElement.querySelector('.modal-overlay') as HTMLElement;
      expect(overlay.classList).toContain('modal-overlay--visual-viewport');
      expect(overlay.style.getPropertyValue('--modal-visual-viewport-top')).toBe('12px');
      expect(overlay.style.getPropertyValue('--modal-visual-viewport-height')).toBe(
        `${Math.min(560, window.innerHeight)}px`
      );

      const setProperty = spyOn(overlay.style, 'setProperty').and.callThrough();
      fixture.detectChanges();
      fixture.detectChanges();
      expect(setProperty).not.toHaveBeenCalled();

      top = 20;
      height = 300;
      viewport.dispatchEvent(new Event('resize'));
      expect(overlay.style.getPropertyValue('--modal-visual-viewport-top')).toBe('20px');
      expect(overlay.style.getPropertyValue('--modal-visual-viewport-height')).toBe('300px');
      expect(setProperty.calls.count()).toBe(2);

      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();
      expect(removeEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
      expect(removeEventListener).toHaveBeenCalledWith('scroll', jasmine.any(Function));
      expect(removeWindowEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(window, 'visualViewport', previousDescriptor);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    }
  });

  it('should render when isOpen is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.modal-overlay');
    expect(overlay).toBeTruthy();
  });

  it('resets body scroll when the active modal view changes', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const body = fixture.nativeElement.querySelector('.modal__body') as HTMLElement;
    body.scrollTop = 120;
    component.resetBodyScroll();

    expect(body.scrollTop).toBe(0);
  });

  it('exposes a modal dialog, moves focus inside and restores it on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const closeButton = dialog.querySelector('.modal__close') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(closeButton);

    component.close();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('wraps keyboard focus at the first and last dialog controls', () => {
    component.isOpen = true;
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const closeButton = dialog.querySelector('.modal__close') as HTMLElement;
    const lastButton = document.createElement('button');
    dialog.appendChild(lastButton);

    closeButton.focus();
    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(backward);

    expect(backward.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(lastButton);

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true
    });
    lastButton.dispatchEvent(forward);

    expect(forward.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(closeButton);
  });

  it('should display title', () => {
    component.isOpen = true;
    component.title = 'Test Modal';
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('.modal__title');
    expect(title.textContent.trim()).toBe('Test Modal');
  });

  it('should apply correct size class', () => {
    component.isOpen = true;
    component.size = 'lg';
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.modal');
    expect(modal.className).toContain('modal--lg');
  });

  it('should show close button when closable', () => {
    component.isOpen = true;
    component.closable = true;
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('.modal__close');
    expect(closeBtn).toBeTruthy();
  });

  it('uses the local SVG icon for the named close action', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const closeButton = fixture.nativeElement.querySelector('.modal__close') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toBeTruthy();
    expect(closeButton.querySelector('app-icon svg')).toBeTruthy();
    expect(closeButton.textContent?.trim()).toBe('');
  });

  it('should not show close button when not closable', () => {
    component.isOpen = true;
    component.closable = false;
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('.modal__close');
    expect(closeBtn).toBeFalsy();
  });

  it('should close on close button click', () => {
    component.isOpen = true;
    fixture.detectChanges();

    spyOn(component, 'close');

    const closeBtn = fixture.nativeElement.querySelector('.modal__close');
    closeBtn.click();

    expect(component.close).toHaveBeenCalled();
  });

  it('should emit onClose when closed', () => {
    spyOn(component.isOpenChange, 'emit');
    spyOn(component.onClose, 'emit');

    component.isOpen = true;
    component.close();

    expect(component.isOpen).toBeFalse();
    expect(component.isOpenChange.emit).toHaveBeenCalledWith(false);
    expect(component.onClose.emit).toHaveBeenCalled();
  });

  it('should close on overlay click when closeOnOverlay is true', () => {
    component.isOpen = true;
    component.closeOnOverlay = true;
    fixture.detectChanges();

    spyOn(component, 'close');

    const overlay = fixture.nativeElement.querySelector('.modal-overlay');
    overlay.click();

    expect(component.close).toHaveBeenCalled();
  });

  it('should not close on overlay click when closeOnOverlay is false', () => {
    component.isOpen = true;
    component.closeOnOverlay = false;
    fixture.detectChanges();

    spyOn(component, 'close');

    const overlay = fixture.nativeElement.querySelector('.modal-overlay');
    overlay.click();

    expect(component.close).not.toHaveBeenCalled();
  });

  it('should close on escape key', () => {
    component.isOpen = true;
    component.closable = true;
    fixture.detectChanges();

    spyOn(component, 'close');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(component.close).toHaveBeenCalled();
  });

  it('should not close on escape key when not closable', () => {
    component.isOpen = true;
    component.closable = false;
    fixture.detectChanges();

    spyOn(component, 'close');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(component.close).not.toHaveBeenCalled();
  });

  it('exposes only the topmost stacked dialog as modal and restores the underlying modal', () => {
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    const underlyingDialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const underlyingClose = fixture.nativeElement.querySelector('.modal__close') as HTMLElement;

    const topFixture = TestBed.createComponent(ModalComponent);
    fixture.nativeElement.appendChild(topFixture.nativeElement);
    document.body.appendChild(fixture.nativeElement);
    topFixture.componentRef.setInput('isOpen', true);
    topFixture.detectChanges();
    fixture.detectChanges();
    const topComponent = topFixture.componentInstance;
    const topDialog = topFixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;

    expect(underlyingDialog.getAttribute('aria-modal')).not.toBe('true');
    expect(underlyingDialog.getAttribute('aria-hidden')).toBe('true');
    expect(underlyingDialog.hasAttribute('inert')).toBeTrue();
    expect(topDialog.getAttribute('aria-modal')).toBe('true');
    expect(topDialog.hasAttribute('inert')).toBeFalse();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(escape);
    topFixture.detectChanges();
    fixture.detectChanges();

    expect(escape.defaultPrevented).toBeTrue();
    expect(topComponent.isOpen).toBeFalse();
    expect(component.isOpen).toBeTrue();
    expect(document.querySelectorAll('.modal-overlay').length).toBe(1);
    expect(underlyingDialog.getAttribute('aria-modal')).toBe('true');
    expect(underlyingDialog.hasAttribute('aria-hidden')).toBeFalse();
    expect(underlyingDialog.hasAttribute('inert')).toBeFalse();
    expect(document.activeElement).toBe(underlyingClose);
    topFixture.destroy();
    fixture.nativeElement.remove();
  });

  it('should show footer when showFooter is true', () => {
    component.isOpen = true;
    component.showFooter = true;
    fixture.detectChanges();

    const footer = fixture.nativeElement.querySelector('.modal__footer');
    expect(footer).toBeTruthy();
  });

  it('should not show footer when showFooter is false', () => {
    component.isOpen = true;
    component.showFooter = false;
    fixture.detectChanges();

    const footer = fixture.nativeElement.querySelector('.modal__footer');
    expect(footer).toBeFalsy();
  });

  describe('getModalClasses', () => {
    it('should return correct classes', () => {
      component.size = 'xl';
      expect(component.getModalClasses()).toBe('modal modal--xl');
    });
  });
});
