import { z } from 'zod';

export type AiJsonSchema = Record<string, unknown>;

export interface AiResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: AiJsonSchema;
  };
}

export type AiCallResponseFormat = AiResponseFormat | { type: 'json_object' };

/**
 * Build the strict subset sent by Chat Completions from the same Zod schema that
 * validates the provider's output locally.
 *
 * OpenAI-compatible Structured Outputs require every object property to be required
 * and every object to opt out of extra properties. Zod's optional/default metadata
 * describes local parsing rather than the JSON object we ask the model to emit, so
 * the provider schema makes every declared key explicit and drops `default` hints.
 */
export function createAiResponseFormat(name: string, schema: z.ZodType): AiResponseFormat {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error('AI response schema name must be 1–64 letters, digits, underscores or hyphens');
  }

  const source = z.toJSONSchema(schema, { target: 'draft-7' }) as AiJsonSchema;
  const normalized = normalizeStrictSchema(source);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    (normalized as Record<string, unknown>).type !== 'object'
  ) {
    throw new Error('AI response schema root must be an object');
  }

  return {
    type: 'json_schema',
    json_schema: { name, strict: true, schema: normalized as AiJsonSchema }
  };
}

function normalizeStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStrictSchema);
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    // JSON Schema's default is an annotation, not a constraint. Letting it through
    // would also be misleading: Structured Outputs still requires the property.
    if (
      key === '$schema' ||
      key === 'default' ||
      key === 'required' ||
      key === 'additionalProperties'
    ) {
      continue;
    }
    normalized[key] = normalizeStrictSchema(child);
  }

  if (source.type === 'object' || source.properties) {
    const properties = (normalized.properties ?? {}) as Record<string, unknown>;
    normalized.required = Object.keys(properties);
    normalized.additionalProperties = false;
  }
  return normalized;
}
