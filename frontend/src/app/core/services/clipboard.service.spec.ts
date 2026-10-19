import { TestBed } from '@angular/core/testing';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  let service: ClipboardService;
  let originalClipboard: PropertyDescriptor | undefined;

  function setClipboard(clipboard: Clipboard | undefined): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    });
  }

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClipboardService);
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else setClipboard(undefined);
  });

  it('uses the modern Clipboard API and waits for confirmed success', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText } as unknown as Clipboard);

    await expectAsync(service.copy('https://example.test/invite/SYNTHETIC')).toBeResolved();

    expect(writeText).toHaveBeenCalledOnceWith('https://example.test/invite/SYNTHETIC');
  });

  it('propagates Clipboard API rejection rather than claiming a copy', async () => {
    const failure = new Error('clipboard denied');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.reject(failure));
    setClipboard({ writeText } as unknown as Clipboard);

    await expectAsync(service.copy('synthetic text')).toBeRejectedWith(failure);
    expect(writeText).toHaveBeenCalledOnceWith('synthetic text');
  });

  it('uses the legacy fallback only when Clipboard API is unavailable and removes its textarea', async () => {
    setClipboard(undefined);
    const execCommand = spyOn(document, 'execCommand').and.returnValue(true);
    const existingTextareas = document.body.querySelectorAll('textarea').length;

    await expectAsync(service.copy('synthetic text')).toBeResolved();

    expect(execCommand).toHaveBeenCalledOnceWith('copy');
    expect(document.body.querySelectorAll('textarea').length).toBe(existingTextareas);
  });

  it('rejects a false legacy copy result and still removes its textarea', async () => {
    setClipboard(undefined);
    const execCommand = spyOn(document, 'execCommand').and.returnValue(false);
    const existingTextareas = document.body.querySelectorAll('textarea').length;

    await expectAsync(service.copy('synthetic text')).toBeRejected();

    expect(execCommand).toHaveBeenCalledOnceWith('copy');
    expect(document.body.querySelectorAll('textarea').length).toBe(existingTextareas);
  });

  it('removes the legacy textarea if the browser copy command throws', async () => {
    setClipboard(undefined);
    const failure = new Error('copy command unavailable');
    const execCommand = spyOn(document, 'execCommand').and.throwError(failure);
    const existingTextareas = document.body.querySelectorAll('textarea').length;

    await expectAsync(service.copy('synthetic text')).toBeRejectedWith(failure);

    expect(execCommand).toHaveBeenCalledOnceWith('copy');
    expect(document.body.querySelectorAll('textarea').length).toBe(existingTextareas);
  });
});
