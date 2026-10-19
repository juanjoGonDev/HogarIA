import { Context } from 'hono';
import { ZodError } from 'zod';
import { describeIssues } from '../schemas/form.js';
import { config } from '../config/app.config.js';
import { addServerLog } from '../routes/logs.routes.js';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    super(404, message, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export function errorHandler(err: Error, c: Context) {
  console.error('Error:', err);
  
  // Store error in log viewer
  addServerLog('error', err.message, err.stack);

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    // `describeIssues` en vez de «Invalid input data»: ese mensaje literal es lo que veia el
    // usuario cuando un formulario mandaba un hueco opcional, y no le decia ni el campo ni que
    // hacer. El detalle en bruto sigue ahi (para el log y para depurar), pero arriba va la frase.
    const report = describeIssues(err);
    return c.json(
      {
        success: false,
        error: 'Validation Error',
        message: report.message,
        issues: report.issues,
        details: (err.issues || []).map((e: any) => ({
          path: Array.isArray(e.path) ? e.path.join('.') : String(e.path),
          message: e.message
        }))
      },
      400
    );
  }

  // Handle custom app errors
  if (err instanceof AppError) {
    return c.json({
      success: false,
      error: err.code || 'Error',
      message: err.message,
      details: err.details
    }, err.statusCode as any);
  }

  // Handle unknown errors
  const statusCode = 500;
  const message = config.server.env === 'production'
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';

  return c.json({
    success: false,
    error: 'INTERNAL_ERROR',
    message,
    ...(config.server.env !== 'production' && { stack: err.stack })
  }, statusCode as any);
}
