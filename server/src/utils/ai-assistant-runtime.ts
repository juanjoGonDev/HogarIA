import { AiCallError, callAIWithConfig } from './ai-client.js';
import type { AiConfigRow, AiMessage } from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';

const activeUsers = new Set<string>();
const activeConfigs = new Set<string>();

function simplifyOllamaSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(simplifyOllamaSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const simplified: Record<string, unknown> = {};
  for (const key of ['type', 'enum', 'const', 'required', 'additionalProperties']) {
    if (Object.hasOwn(source, key)) simplified[key] = source[key];
  }
  if (source.properties && typeof source.properties === 'object') {
    simplified.properties = Object.fromEntries(
      Object.entries(source.properties).map(([key, value]) => [key, simplifyOllamaSchema(value)])
    );
  }
  if (Object.hasOwn(source, 'items')) simplified.items = simplifyOllamaSchema(source.items);
  if (Array.isArray(source.anyOf)) {
    simplified.anyOf = source.anyOf.map(simplifyOllamaSchema);
  }
  return simplified;
}

function isLocalOllamaConfig(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.port === '11434'
    );
  } catch {
    return false;
  }
}

/**
 * The assistant intentionally avoids `callAI`/`ticket-queue`: that path persists an `ai_jobs`
 * row. This lightweight per-process gate keeps one provider request per user/config in flight,
 * while the existing transport still owns provider safety, timeout, response parsing, and abort.
 */
export async function callAssistantAITransient(input: {
  userId: string;
  config: AiConfigRow;
  messages: AiMessage[];
  responseFormat: AiResponseFormat;
  signal?: AbortSignal;
}): Promise<string> {
  const configId = input.config.id;
  if (input.signal?.aborted) {
    throw new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED');
  }
  if (activeUsers.has(input.userId) || activeConfigs.has(configId)) {
    throw new AiCallError(
      'PROVIDER',
      'An assistant request is already in progress',
      'ASSISTANT_BUSY'
    );
  }

  activeUsers.add(input.userId);
  activeConfigs.add(configId);
  try {
    const localOllama = isLocalOllamaConfig(input.config.base_url);
    const responseFormat = localOllama
      ? {
          ...input.responseFormat,
          json_schema: {
            ...input.responseFormat.json_schema,
            schema: simplifyOllamaSchema(input.responseFormat.json_schema.schema) as Record<
              string,
              unknown
            >
          }
        }
      : input.responseFormat;
    return await callAIWithConfig(
      input.config,
      input.messages,
      responseFormat,
      input.signal,
      localOllama ? { reasoning_effort: 'none' } : undefined
    );
  } finally {
    activeUsers.delete(input.userId);
    activeConfigs.delete(configId);
  }
}
