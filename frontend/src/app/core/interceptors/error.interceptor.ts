import { HttpInterceptorFn, HttpErrorResponse, HttpContextToken } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';

/**
 * Peticiones cuyo fracaso tiene pantalla propia. Cerrar una compra con lineas sin precio
 * es un 409 que abre una hoja para escribirlos ahi mismo: un toast encima repitiendo el
 * codigo del server es ruido encima de la solucion.
 */
export const SILENT_TOAST = new HttpContextToken<boolean>(() => false);

/** Última vez que se mostró un toast por código de estado. */
const recentlyShown = new Map<number, number>();

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ErrorRecord)
    : null;
}

function validationIssues(body: unknown, status: number): ErrorRecord[] | null {
  const payload = asRecord(body);
  if (!payload) return null;

  const issues = Array.isArray(payload['issues']) ? payload['issues'] : [];
  const details = Array.isArray(payload['details']) ? payload['details'] : [];
  const source = issues.length ? issues : details;
  const marked = /validation/i.test(String(payload['error'] ?? payload['name'] ?? ''));
  const structured = source.some((item) => {
    const issue = asRecord(item);
    return (
      !!issue &&
      typeof issue['message'] === 'string' &&
      ('field' in issue || 'path' in issue || 'type' in issue)
    );
  });

  if (!marked && !((status === 400 || status === 422) && structured)) return null;
  return source.map(asRecord).filter((issue): issue is ErrorRecord => !!issue);
}

function formatValidationMessage(body: unknown, status: number, i18n: I18nService): string | null {
  const payload = asRecord(body);
  const issues = validationIssues(body, status);
  if (!payload || !issues) return null;

  const formatted = issues
    .map((issue) => {
      const field = validationField(issue['field'] ?? issue['path']);
      const raw = typeof issue['message'] === 'string' ? issue['message'].trim() : '';
      const message = formatValidationConstraint(
        raw,
        issue,
        i18n,
        isSensitiveValidationField(field)
      );
      if (!message) return '';
      if (!field || new RegExp(`^${escapeRegExp(field)}\\s*:`).test(message)) return message;
      return `${field}: ${message}`;
    })
    .filter(Boolean);

  if (formatted.length) return [...new Set(formatted)].join(' · ');
  // Never fall back to the raw aggregate Joi/Zod message: validators may interpolate the
  // submitted value (including an API key) into it.
  return i18n.t('ui.validation_invalid');
}

function validationField(path: unknown): string {
  if (Array.isArray(path))
    return path.filter((part) => typeof part === 'string' || typeof part === 'number').join('.');
  return typeof path === 'string' ? path.trim() : '';
}

function formatValidationConstraint(
  message: string,
  issue: ErrorRecord,
  i18n: I18nService,
  sensitiveField: boolean
): string {
  const translatedSpanishConstraint = translateSpanishConstraint(message, i18n);
  if (translatedSpanishConstraint) return translatedSpanishConstraint;

  const type = String(issue['type'] ?? issue['code'] ?? '');
  if (
    /(?:invalid url(?: format)?|must be a valid url|is not a valid url|no parece una url)/i.test(
      message
    ) ||
    /\.(?:uri|url)$/i.test(type)
  ) {
    return i18n.t('ui.validation_url');
  }
  if (/^string\.max$/i.test(type) && issue['limit'] !== undefined) {
    return i18n.t('ui.validation_max_characters', {
      value: formatNumber(issue['limit'], i18n)
    });
  }
  if (/^string\.min$/i.test(type) && issue['limit'] !== undefined) {
    return i18n.t('ui.validation_min_characters', {
      value: formatNumber(issue['limit'], i18n)
    });
  }
  const upper =
    issue['maximum'] ??
    issue['limit'] ??
    extractBoundary(
      message,
      /(?:less than or equal to|at most|maximum(?: of)?|<=|(?:number|string)\.max)\s*["']?(-?\d+(?:[.,]\d+)?)/i
    );
  if (
    upper !== undefined &&
    upper !== null &&
    /(?:less than or equal to|at most|maximum|<=|number\.max|string\.max|too big|demasiado largo)/i.test(
      `${type} ${message}`
    )
  ) {
    return i18n.t('ui.validation_maximum', { value: formatNumber(upper, i18n) });
  }

  const lower =
    issue['minimum'] ??
    issue['limit'] ??
    extractBoundary(
      message,
      /(?:greater than or equal to|larger than or equal to|at least|minimum(?: of)?|>=|(?:number|string)\.min)\s*["']?(-?\d+(?:[.,]\d+)?)/i
    );
  if (
    lower !== undefined &&
    lower !== null &&
    /(?:greater than|larger than|at least|minimum|>=|number\.min|string\.min|too small|demasiado corto)/i.test(
      `${type} ${message}`
    )
  ) {
    return i18n.t('ui.validation_minimum', { value: formatNumber(lower, i18n) });
  }

  const exclusiveUpper = extractBoundary(
    message,
    /(?:less than|below|<)\s*["']?(-?\d+(?:[.,]\d+)?)/i
  );
  if (exclusiveUpper !== null && /(?:less than|below|<)/i.test(message)) {
    return i18n.t('ui.validation_less_than', { value: formatNumber(exclusiveUpper, i18n) });
  }
  const exclusiveLower = extractBoundary(
    message,
    /(?:greater than|larger than|above|>)\s*["']?(-?\d+(?:[.,]\d+)?)/i
  );
  if (exclusiveLower !== null && /(?:greater than|larger than|above|>)/i.test(message)) {
    return i18n.t('ui.validation_greater_than', { value: formatNumber(exclusiveLower, i18n) });
  }

  if (
    /\b(?:is required|must be provided|is missing)\b/i.test(message) ||
    /\.required$/i.test(type)
  ) {
    return i18n.t('ui.validation_required');
  }
  if (
    /must be an integer|expected integer|\binteger\b/i.test(message) ||
    /\.integer$/i.test(type)
  ) {
    return i18n.t('ui.validation_integer');
  }
  if (/must be a number|expected number|received nan/i.test(message)) {
    return i18n.t('ui.validation_number');
  }
  if (type) return translateJoiType(type, i18n);
  return sensitiveField ? i18n.t('ui.validation_invalid') : message;
}

function isSensitiveValidationField(field: string): boolean {
  const normalized = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /(?:^|[._-])(?:api[_-]?key|base[_-]?url|access[_-]?token|refresh[_-]?token|token|password|passphrase|secret|credentials?|authorization)(?:$|[._-])/.test(
    normalized
  );
}

function translateJoiType(type: string, i18n: I18nService): string {
  if (/\.pattern(?:\.|$)/i.test(type)) return i18n.t('ui.validation_format');
  if (/\.email$/i.test(type)) return i18n.t('ui.validation_email');
  if (/\.(?:uri|url)$/i.test(type)) return i18n.t('ui.validation_url');
  if (/\.(?:base|number)$/i.test(type)) {
    if (/^number\./i.test(type)) return i18n.t('ui.validation_number');
    if (/^string\./i.test(type)) return i18n.t('ui.validation_text');
    if (/^boolean\./i.test(type)) return i18n.t('ui.validation_boolean');
    if (/^array\./i.test(type)) return i18n.t('ui.validation_list');
    if (/^object\./i.test(type)) return i18n.t('ui.validation_object');
  }
  if (/\.(?:only|valid)$/i.test(type)) return i18n.t('ui.validation_allowed_value');
  return i18n.t('ui.validation_invalid');
}

function translateSpanishConstraint(message: string, i18n: I18nService): string | null {
  const constraints = [
    [/debe ser como máximo\s*(-?[\d.,]+)/i, 'ui.validation_maximum'],
    [/debe ser como mínimo\s*(-?[\d.,]+)/i, 'ui.validation_minimum'],
    [/debe ser menor que\s*(-?[\d.,]+)/i, 'ui.validation_less_than'],
    [/debe ser mayor que\s*(-?[\d.,]+)/i, 'ui.validation_greater_than'],
    [/no puede superar\s*(-?[\d.,]+) caracteres/i, 'ui.validation_max_characters'],
    [/debe tener al menos\s*(-?[\d.,]+) caracteres/i, 'ui.validation_min_characters'],
    [/debe tener menos de\s*(-?[\d.,]+) caracteres/i, 'ui.validation_less_characters'],
    [/debe tener más de\s*(-?[\d.,]+) caracteres/i, 'ui.validation_more_characters']
  ] as const;

  for (const [pattern, key] of constraints) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(value)) return null;
    return i18n.t(key, { value: formatNumber(value, i18n) });
  }
  return null;
}

function extractBoundary(message: string, pattern: RegExp): number | null {
  const match = message.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value: unknown, i18n: I18nService): string {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(i18n.resolved() === 'en' ? 'en-GB' : 'es-ES').format(number);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);
  // Los textos van al diccionario tambien aqui: el interceptor es el ultimo punto comun antes de
  // que el mensaje se vea, y si se quedara en espanol no hay manera de traducirlo despues.
  const i18n = inject(I18nService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = i18n.t('ui.ha_ocurrido_un_error');
      const validationMessage =
        error.error instanceof ErrorEvent
          ? null
          : formatValidationMessage(error.error, error.status, i18n);

      if (error.error instanceof ErrorEvent) {
        // Client-side error
        errorMessage = error.error.message;
      } else {
        // Server-side error
        if (validationMessage) {
          errorMessage = validationMessage;
        } else
          switch (error.status) {
            case 400:
              errorMessage = error.error?.message || i18n.t('ui.solicitud_incorrecta');
              break;
            case 401:
              // Traducido a lo que se puede hacer, no al codigo. Un 401 callado es la peor
              // combinacion posible: la app sigue ensenando lo que hay en el cache —el nombre, la
              // foto, la lista— mientras toda escritura falla, que es exactamente el aspecto de una
              // cuenta que ya no existe en el servidor (una base de datos restaurada o sustituida).
              errorMessage = i18n.t('ui.la_sesion_que_guarda');
              break;
            case 403:
              errorMessage = i18n.t('ui.no_tienes_permiso');
              break;
            case 404:
              errorMessage = i18n.t('ui.recurso_no_encontrado');
              break;
            case 409:
              errorMessage = error.error?.message || i18n.t('ui.conflicto_con_el_recurso');
              break;
            case 422:
              errorMessage = error.error?.message || i18n.t('ui.datos_de_entrada_invalidos');
              break;
            case 429:
              errorMessage = i18n.t('ui.demasiadas_solicitudes');
              break;
            case 500:
              errorMessage = i18n.t('ui.error_del_servidor');
              break;
            case 503:
              errorMessage = i18n.t('ui.servicio_no_disponible');
              break;
          }
      }

      // Un 429 llega en tanda (cada peticion en vuelo lo recibe), y un toast por cada
      // una es literalmente la pantalla inutil: no se ve la app debajo. Se agrupan por
      // mensaje y ventana, y el 429 anade cuanto hay que esperar —el `Retry-After` del
      // server— en vez de invitar a machacar F5, que es lo que multiplica las peticiones.
      const now = Date.now();
      const last = recentlyShown.get(error.status) ?? 0;
      const throttleMs = error.status === 429 || error.status === 401 ? 30_000 : 4_000;
      const silent = req.context?.get(SILENT_TOAST) === true;
      // Un 401 contra el propio login NO se cuenta aqui: esa pantalla ya dice su mensaje al lado
      // del campo, yrepetirlo es un mensaje que se desconfia de si mismo.
      const authAttempt = /^\/api\/auth\/(login|register|refresh|me)$/.test(req.url);
      if (!silent && !(error.status === 401 && authAttempt) && now - last > throttleMs) {
        recentlyShown.set(error.status, now);
        const retryAfter = Number(
          error.error?.retryAfter ?? error.headers?.get('Retry-After') ?? ''
        );
        toastService.error(
          error.status === 429
            ? i18n.t('ui.demasiadas_peticiones')
            : error.status === 401
              ? i18n.t('ui.sesion_caducada')
              : i18n.t('ui.error'),
          error.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
            ? i18n.t('ui.el_servidor_te_esta', { s: Math.ceil(retryAfter) })
            : errorMessage
        );
      }

      return throwError(() => ({
        status: error.status,
        message: errorMessage,
        validation: Boolean(validationMessage),
        original: error
      }));
    })
  );
};
