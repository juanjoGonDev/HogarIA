import { z } from 'zod';
import { describeIssues } from '../schemas/form.js';

/**
 * Lectura del cuerpo de un formulario.
 *
 * Existe porque `schema.parse(body)` lanza: un handler async que deja escapar ese throw acaba en un
 * 500 con stack y sin explicacion, y eso era lo que pasaba al dejar vacío un campo que el propio
 * formulario marcaba como opcional. Un 400 con `campo: motivo` no es un detalle de cortesia —es la
 * diferencia entre «el calendario da error» y «el titulo tiene 130 caracteres, 120 es el techo».
 */
export async function readForm<T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> }; json: (body: unknown, status?: number) => Response },
  schema: T,
  label?: string
): Promise<{ ok: true; data: z.infer<T>; body: unknown } | { ok: false; response: Response }> {
  const body = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data, body };

  const report = describeIssues(parsed.error);
  return {
    ok: false,
    response: c.json(
      {
        success: false,
        // El `label` existe porque el 400 se ensena tal cual en el dialog: «Evento: titulo: falta» es
        // mejor que «falta» a secas cuando el error viene de una seccion que no se ve.
        message: label ? `${label}: ${report.message}` : report.message,
        issues: report.issues,
        code: 'INVALID_FORM'
      },
      400
    )
  };
}

/** El cuerpo ya leido y validado, o la respuesta que hay que devolver tal cual. */
export type FormResult<T> = { ok: true; data: T } | { ok: false; response: Response };
