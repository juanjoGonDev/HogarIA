import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastComponent } from './toast.component';
import { ToastService } from '../../../../core/services/toast.service';

describe('ToastComponent', () => {
  let component: ToastComponent;
  let fixture: ComponentFixture<ToastComponent>;
  let toastService: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastComponent],
      providers: [ToastService]
    }).compileComponents();

    fixture = TestBed.createComponent(ToastComponent);
    component = fixture.componentInstance;
    toastService = TestBed.inject(ToastService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render toasts from service', () => {
    toastService.success('Test Title', 'Test Message');
    fixture.detectChanges();

    const toasts = fixture.nativeElement.querySelectorAll('.toast');
    expect(toasts.length).toBe(1);
  });

  it('should display toast title', () => {
    toastService.info('Info Title');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('.toast__title');
    expect(title.textContent.trim()).toBe('Info Title');
  });

  it('should display toast message', () => {
    toastService.warning('Warning', 'Warning message');
    fixture.detectChanges();

    const message = fixture.nativeElement.querySelector('.toast__message');
    expect(message.textContent.trim()).toBe('Warning message');
  });

  it('should not show message when not provided', () => {
    toastService.success('Only Title');
    fixture.detectChanges();

    const message = fixture.nativeElement.querySelector('.toast__message');
    expect(message).toBeFalsy();
  });

  it('should apply correct type class', () => {
    toastService.error('Error');
    fixture.detectChanges();

    const toast = fixture.nativeElement.querySelector('.toast');
    expect(toast.className).toContain('toast--error');
  });

  it('should show close button for dismissible toasts', () => {
    toastService.show({ title: 'Test', dismissible: true });
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('.toast__close');
    expect(closeBtn).toBeTruthy();
  });

  it('should dismiss toast on close click', () => {
    toastService.show({ title: 'Test', dismissible: true });
    fixture.detectChanges();

    expect(toastService.toasts().length).toBe(1);

    const closeBtn = fixture.nativeElement.querySelector('.toast__close');
    closeBtn.click();
    fixture.detectChanges();

    expect(toastService.toasts().length).toBe(0);
  });

  it('renders decorative SVG status icons and a close SVG while keeping the close action named', () => {
    for (const type of ['success', 'error', 'warning', 'info'] as const) {
      toastService.show({ type, title: `Toast ${type}`, duration: 0, dismissible: true });
    }
    fixture.detectChanges();

    const toasts: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.toast');
    expect(toasts.length).toBe(4);
    for (const toast of Array.from(toasts)) {
      const statusIcon = toast.querySelector('.toast__icon svg');
      const closeButton = toast.querySelector<HTMLButtonElement>('.toast__close');
      expect(statusIcon?.getAttribute('aria-hidden')).toBe('true');
      expect(toast.querySelector('.toast__icon')?.textContent?.trim()).toBe('');
      expect(closeButton?.getAttribute('aria-label')).toBeTruthy();
      expect(closeButton?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('announces toast content through a live region with urgency matching its type', () => {
    toastService.success('Saved', undefined, { duration: 0 });
    toastService.error('Could not save', undefined, { duration: 0 });
    toastService.warning('Review this', undefined, { duration: 0 });
    toastService.info('Tip', undefined, { duration: 0 });
    fixture.detectChanges();

    const toasts: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.toast');
    const byTitle = new Map(Array.from(toasts, toast => [
      toast.querySelector('.toast__title')?.textContent?.trim(), toast
    ]));

    expect(byTitle.get('Saved')?.getAttribute('role')).toBe('status');
    expect(byTitle.get('Saved')?.getAttribute('aria-live')).toBe('polite');
    expect(byTitle.get('Could not save')?.getAttribute('role')).toBe('alert');
    expect(byTitle.get('Could not save')?.getAttribute('aria-live')).toBe('assertive');
    expect(byTitle.get('Review this')?.getAttribute('role')).toBe('status');
    expect(byTitle.get('Review this')?.getAttribute('aria-live')).toBe('polite');
    expect(byTitle.get('Tip')?.getAttribute('role')).toBe('status');
    expect(byTitle.get('Tip')?.getAttribute('aria-live')).toBe('polite');
    for (const toast of Array.from(toasts)) {
      expect(toast.getAttribute('aria-atomic')).toBe('true');
    }
  });

  it('announces bottom action toasts politely as well', () => {
    toastService.show({ title: 'Item removed', position: 'bottom', duration: 0, action: {
      label: 'Undo', run: () => undefined
    } });
    fixture.detectChanges();

    const toast: HTMLElement = fixture.nativeElement.querySelector('.toast-container--bottom .toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });

  describe('getIcon', () => {
    it('maps each toast state to the local SVG registry', () => {
      expect(component.getIcon('success')).toBe('check_circle');
      expect(component.getIcon('error')).toBe('error_outline');
      expect(component.getIcon('warning')).toBe('sync_problem');
      expect(component.getIcon('info')).toBe('help_outline');
    });

    it('should return info icon for unknown type', () => {
      expect(component.getIcon('unknown')).toBe('help_outline');
    });
  });

  describe('trackById', () => {
    it('should return toast id', () => {
      const toast = { id: 'test-id', type: 'info' as const, title: 'Test', duration: 0, dismissible: true };
      expect(component.trackById(0, toast)).toBe('test-id');
    });
  });

  describe('getToastClasses', () => {
    it('should return correct classes', () => {
      const toast = { id: '1', type: 'success' as const, title: 'Test', duration: 0, dismissible: true };
      expect(component.getToastClasses(toast)).toBe('toast toast--success');
    });
  });
});
