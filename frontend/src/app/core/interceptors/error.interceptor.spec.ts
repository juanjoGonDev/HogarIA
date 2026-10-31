import { HttpContext, HttpErrorResponse, HttpHeaders, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { I18nService } from '../services/i18n.service';
import { STORAGE_KEYS } from '../services/storage.service';
import { ToastService } from '../services/toast.service';
import { dateLocale, setDateLocale } from '../time';
import { errorInterceptor, SILENT_TOAST } from './error.interceptor';

describe('errorInterceptor', () => {
  let toastService: jasmine.SpyObj<ToastService>;
  let i18n: I18nService;
  let clockOffset = 0;
  let previousLocale: string;

  beforeEach(() => {
    previousLocale = dateLocale();
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(1_800_000_000_000 + clockOffset));
    // The interceptor keeps its throttle map at module scope. Separate specs by
    // more than the longest throttle window so randomized Jasmine order is safe.
    clockOffset += 60 * 60 * 1_000;

    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
    TestBed.configureTestingModule({
      providers: [{ provide: ToastService, useValue: toastService }]
    });
    i18n = TestBed.inject(I18nService);
    i18n.setLang('es');
    TestBed.flushEffects();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.language);
    TestBed.resetTestingModule();
    setDateLocale(previousLocale);
    jasmine.clock().uninstall();
  });

  it('maps server status codes and preserves the original error for the caller', () => {
    const cases = [
      [400, 'ui.solicitud_incorrecta'],
      [401, 'ui.la_sesion_que_guarda'],
      [403, 'ui.no_tienes_permiso'],
      [404, 'ui.recurso_no_encontrado'],
      [409, 'ui.conflicto_con_el_recurso'],
      [422, 'ui.datos_de_entrada_invalidos'],
      [429, 'ui.demasiadas_solicitudes'],
      [500, 'ui.error_del_servidor'],
      [503, 'ui.servicio_no_disponible'],
      [418, 'ui.ha_ocurrido_un_error']
    ] as const;

    for (const [status, key] of cases) {
      const original = new HttpErrorResponse({ status, error: {} });
      const propagated = intercept(original);

      expect(propagated.status).withContext(`status ${status}`).toBe(status);
      expect(propagated.message).withContext(`status ${status}`).toBe(i18n.t(key));
      expect(propagated.original).withContext(`status ${status}`).toBe(original);
    }

    expect(toastService.error).toHaveBeenCalledTimes(cases.length);
  });

  it('uses server-provided validation messages when available', () => {
    for (const status of [400, 409, 422]) {
      const original = new HttpErrorResponse({ status, error: { message: `detail-${status}` } });

      expect(intercept(original).message).toBe(`detail-${status}`);
    }
  });

  it('shows Zod field and numeric requirement in the validation toast', () => {
    const original = new HttpErrorResponse({
      status: 400,
      error: {
        success: false,
        error: 'Validation Error',
        message: 'timeout: debe ser como máximo 600.000',
        issues: [
          { field: 'timeout', message: 'debe ser como máximo 600.000' },
          { field: 'maxTokens', message: 'debe ser como máximo 4.096' }
        ]
      }
    });

    const propagated = intercept(original);

    expect(propagated.validation).toBeTrue();
    expect(propagated.message).toBe(
      'timeout: debe ser como máximo 600.000 · maxTokens: debe ser como máximo 4096'
    );
    expect(toastService.error).toHaveBeenCalledOnceWith(
      'Error',
      'timeout: debe ser como máximo 600.000 · maxTokens: debe ser como máximo 4096'
    );

    jasmine.clock().tick(4_001);
    i18n.setLang('en');
    TestBed.flushEffects();
    const english = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Validation Error',
          issues: [
            { field: 'timeout', message: 'debe ser como máximo 600.000' },
            { field: 'maxTokens', message: 'debe ser como máximo 4.096' }
          ]
        }
      })
    );
    expect(english.message).toBe(
      'timeout: must be at most 600,000 · maxTokens: must be at most 4,096'
    );
  });

  it('localizes URL validation details from Zod in Spanish and English', () => {
    const spanish = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Validation Error',
          issues: [{ field: 'baseUrl', message: 'Invalid URL format' }]
        }
      })
    );
    expect(spanish.message).toBe('baseUrl: debe ser una URL válida');

    jasmine.clock().tick(4_001);
    i18n.setLang('en');
    TestBed.flushEffects();
    const english = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Validation Error',
          issues: [{ field: 'baseUrl', message: 'Invalid URL format' }]
        }
      })
    );
    expect(english.message).toBe('baseUrl: must be a valid URL');
  });

  it('formats Joi numeric details in the active language', () => {
    const spanish = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Bad Request',
          details: [
            {
              path: ['timeout'],
              type: 'number.max',
              message: '"timeout" must be less than or equal to 600000'
            },
            {
              path: ['retryAttempts'],
              type: 'number.min',
              message: '"retryAttempts" must be greater than or equal to 1'
            }
          ]
        }
      })
    );
    expect(spanish.message).toBe(
      'timeout: debe ser como máximo 600.000 · retryAttempts: debe ser como mínimo 1'
    );

    jasmine.clock().tick(4_001);
    i18n.setLang('en');
    TestBed.flushEffects();
    const english = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Bad Request',
          details: [
            {
              path: ['timeout'],
              type: 'number.max',
              message: '"timeout" must be less than or equal to 600000'
            },
            {
              path: ['retryAttempts'],
              type: 'number.min',
              message: '"retryAttempts" must be greater than or equal to 1'
            }
          ]
        }
      })
    );
    expect(english.message).toBe(
      'timeout: must be at most 600,000 · retryAttempts: must be at least 1'
    );
  });

  it('translates required Joi fields without echoing their submitted value', () => {
    const original = new HttpErrorResponse({
      status: 400,
      error: {
        error: 'Bad Request',
        details: [
          {
            path: ['apiKey'],
            type: 'any.required',
            message: '"apiKey" is required'
          }
        ]
      }
    });

    expect(intercept(original).message).toBe('apiKey: es obligatorio');
  });

  it('redacts secret values echoed by unknown Joi validation details', () => {
    const secret = 'synthetic-ghp-secret-value';
    const original = new HttpErrorResponse({
      status: 400,
      error: {
        error: 'Bad Request',
        details: [
          {
            path: ['apiKey'],
            type: 'string.pattern.base',
            message: `"apiKey" with value "${secret}" fails to match the required pattern`
          }
        ]
      }
    });

    const propagated = intercept(original);

    expect(propagated.message).toBe('apiKey: tiene un formato no válido');
    expect(propagated.message).not.toContain(secret);
    expect(toastService.error.calls.mostRecent().args[1]).not.toContain(secret);

    jasmine.clock().tick(4_001);
    const untyped = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Bad Request',
          details: [
            {
              path: ['apiKey'],
              message: `The submitted API key "${secret}" does not match this provider's policy`
            }
          ]
        }
      })
    );
    expect(untyped.message).toBe('apiKey: tiene un valor no válido');
    expect(untyped.message).not.toContain(secret);
    expect(toastService.error.calls.mostRecent().args[1]).not.toContain(secret);

    jasmine.clock().tick(4_001);
    const credentialedUrl = 'https://synthetic-user:synthetic-password@example.test';
    const urlError = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Bad Request',
          details: [
            {
              path: ['baseUrl'],
              message: `Could not accept ${credentialedUrl}`
            }
          ]
        }
      })
    );
    expect(urlError.message).toBe('baseUrl: tiene un valor no válido');
    expect(urlError.message).not.toContain(credentialedUrl);
    expect(toastService.error.calls.mostRecent().args[1]).not.toContain(credentialedUrl);
  });

  it('preserves character units for Joi and Zod length boundaries', () => {
    const joi = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Bad Request',
          details: [
            {
              path: ['name'],
              type: 'string.max',
              limit: 100,
              message: '"name" length must be less than or equal to 100 characters long'
            }
          ]
        }
      })
    );
    expect(joi.message).toBe('name: no puede superar 100 caracteres');

    jasmine.clock().tick(4_001);
    i18n.setLang('en');
    TestBed.flushEffects();
    const zod = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Validation Error',
          issues: [{ field: 'name', message: 'debe tener al menos 3 caracteres' }]
        }
      })
    );
    expect(zod.message).toBe('name: must be at least 3 characters');
  });

  it('keeps detailed validation available to silent flows without showing a toast', () => {
    const propagated = intercept(
      new HttpErrorResponse({
        status: 400,
        error: {
          error: 'Validation Error',
          issues: [{ field: 'timeout', message: 'debe ser como máximo 600.000' }]
        }
      }),
      '/api/ai/configs',
      new HttpContext().set(SILENT_TOAST, true)
    );

    expect(propagated.validation).toBeTrue();
    expect(propagated.message).toBe('timeout: debe ser como máximo 600.000');
    expect(toastService.error).not.toHaveBeenCalled();
  });

  it('uses the client ErrorEvent message and keeps an unknown client failure visible', () => {
    const original = new HttpErrorResponse({
      status: 0,
      error: new ErrorEvent('error', { message: 'offline' })
    });

    expect(intercept(original).message).toBe('offline');
    expect(toastService.error).toHaveBeenCalledOnceWith('Error', 'offline');
  });

  it('suppresses auth-attempt 401 toasts without swallowing the error', () => {
    for (const path of ['login', 'register', 'refresh', 'me']) {
      const original = new HttpErrorResponse({ status: 401 });
      const propagated = intercept(original, `/api/auth/${path}`);

      expect(propagated.status).withContext(path).toBe(401);
      expect(propagated.original).withContext(path).toBe(original);
    }

    expect(toastService.error).not.toHaveBeenCalled();
  });

  it('honors SILENT_TOAST but still rejects with the translated failure', () => {
    const original = new HttpErrorResponse({ status: 503 });
    const propagated = intercept(
      original,
      '/api/calendar/goals',
      new HttpContext().set(SILENT_TOAST, true)
    );

    expect(propagated.status).toBe(503);
    expect(propagated.message).toBe(i18n.t('ui.servicio_no_disponible'));
    expect(propagated.original).toBe(original);
    expect(toastService.error).not.toHaveBeenCalled();
  });

  it('groups ordinary errors for 4 seconds and 401/429 errors for 30 seconds', () => {
    intercept(new HttpErrorResponse({ status: 503 }));
    jasmine.clock().tick(4_000);
    intercept(new HttpErrorResponse({ status: 503 }));
    expect(toastService.error).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(1);
    intercept(new HttpErrorResponse({ status: 503 }));
    expect(toastService.error).toHaveBeenCalledTimes(2);

    intercept(new HttpErrorResponse({ status: 401 }), '/api/protected');
    jasmine.clock().tick(30_000);
    intercept(new HttpErrorResponse({ status: 401 }), '/api/protected');
    expect(toastService.error).toHaveBeenCalledTimes(3);
    jasmine.clock().tick(1);
    intercept(new HttpErrorResponse({ status: 401 }), '/api/protected');
    expect(toastService.error).toHaveBeenCalledTimes(4);

    intercept(new HttpErrorResponse({ status: 429 }));
    jasmine.clock().tick(30_000);
    intercept(new HttpErrorResponse({ status: 429 }));
    expect(toastService.error).toHaveBeenCalledTimes(5);
    jasmine.clock().tick(1);
    intercept(new HttpErrorResponse({ status: 429 }));
    expect(toastService.error).toHaveBeenCalledTimes(6);
  });

  it('reads Retry-After from either body or header and ignores invalid values', () => {
    const bodyError = new HttpErrorResponse({ status: 429, error: { retryAfter: 1.2 } });
    intercept(bodyError);
    expect(toastService.error.calls.mostRecent().args[1]).toBe(
      i18n.t('ui.el_servidor_te_esta', { s: 2 })
    );

    jasmine.clock().tick(30_001);
    const headerError = new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '9' })
    });
    intercept(headerError);
    expect(toastService.error.calls.mostRecent().args[1]).toBe(
      i18n.t('ui.el_servidor_te_esta', { s: 9 })
    );

    jasmine.clock().tick(30_001);
    intercept(new HttpErrorResponse({ status: 429, error: { retryAfter: 'invalid' } }));
    expect(toastService.error.calls.mostRecent().args[1]).toBe(i18n.t('ui.demasiadas_solicitudes'));

    jasmine.clock().tick(30_001);
    intercept(new HttpErrorResponse({ status: 429, error: { retryAfter: 0 } }));
    expect(toastService.error.calls.mostRecent().args[1]).toBe(i18n.t('ui.demasiadas_solicitudes'));
  });

  it('uses the active Spanish or English translation for visible errors', () => {
    const spanish = intercept(new HttpErrorResponse({ status: 503 })).message;
    expect(spanish).toBe('Servicio no disponible');

    jasmine.clock().tick(4_001);
    i18n.setLang('en');
    TestBed.flushEffects();
    const english = intercept(new HttpErrorResponse({ status: 503 })).message;
    expect(english).toBe('Service unavailable');
    expect(english).not.toBe(spanish);
  });

  function intercept(
    original: HttpErrorResponse,
    url = '/api/resource',
    context = new HttpContext()
  ): { status: number; message: string; validation: boolean; original: HttpErrorResponse } {
    let propagated:
      | { status: number; message: string; validation: boolean; original: HttpErrorResponse }
      | undefined;
    const request = new HttpRequest('GET', url, null, { context });

    TestBed.runInInjectionContext(() =>
      errorInterceptor(request, () => throwError(() => original)).subscribe({
        error: (error) => (propagated = error)
      })
    );

    if (!propagated) throw new Error('The interceptor should propagate the HTTP failure.');
    return propagated;
  }
});
