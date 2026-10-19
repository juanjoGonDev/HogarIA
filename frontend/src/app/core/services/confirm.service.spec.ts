import { TestBed } from '@angular/core/testing';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  let service: ConfirmService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ConfirmService] });
    service = TestBed.inject(ConfirmService);
  });

  it('starts without a pending confirmation and ignores actions without one', () => {
    expect(service.request()).toBeNull();

    service.accept();
    service.cancel();

    expect(service.request()).toBeNull();
  });

  it('resolves accepted options and clears the active request', async () => {
    const options = {
      title: 'Delete the list?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Keep list',
      variant: 'danger' as const
    };
    const result = service.confirm(options);

    expect(service.request()).toEqual(jasmine.objectContaining(options));

    service.accept();

    expect(service.request()).toBeNull();
    expect(await result).toBeTrue();
  });

  it('resolves a cancelled request as false and clears it', async () => {
    const result = service.confirm({ title: 'Delete the list?' });

    service.cancel();

    expect(service.request()).toBeNull();
    expect(await result).toBeFalse();
  });

  it('cancels a superseded request and leaves the newest options active', async () => {
    const previous = service.confirm({ title: 'Delete one item?' });
    const nextOptions = {
      title: 'Delete the whole list?',
      message: 'This affects several items.',
      confirmText: 'Delete list',
      cancelText: 'Go back',
      variant: 'primary' as const
    };
    const next = service.confirm(nextOptions);

    expect(await previous).toBeFalse();
    expect(service.request()).toEqual(jasmine.objectContaining(nextOptions));

    service.accept();

    expect(service.request()).toBeNull();
    expect(await next).toBeTrue();
  });
});
