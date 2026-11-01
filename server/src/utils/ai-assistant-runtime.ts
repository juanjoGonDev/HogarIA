import { AiCallError, callAIWithConfig } from './ai-client.js';
import type { AiConfigRow, AiMessage } from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';
import { getDatabase } from '../config/database.js';

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
 * Assistant model calls share the server queue so tab disconnects cannot abort the provider job.
 * The local gate preserves the existing one-request-per-user/config behavior while the durable
 * queue owns provider scheduling, status and explicit cancellation.
 */
export async function callAssistantAITransient(input: {
  userId: string;
  config: AiConfigRow;
  messages: AiMessage[];
  responseFormat: AiResponseFormat;
}): Promise<string> {
  const configId = input.config.id;
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
    const { persistAiProviderDiagnostic, submitAiTask } = await import('./ticket-queue.js');
    const db = getDatabase();
    const requestOptions = localOllama ? { reasoning_effort: 'none' as const } : {};
    return await submitAiTask({
      db,
      userId: input.userId,
      householdId: input.config.household_id ?? null,
      config: input.config,
      kind: 'assistant',
      payloadBytes: Buffer.byteLength(
        JSON.stringify({ messages: input.messages, responseFormat }),
        'utf8'
      ),
      run: (_fixedConfig, signal, jobId) =>
        callAIWithConfig(input.config, input.messages, responseFormat, signal, {
          ...requestOptions,
          jobId,
          onDiagnostic: (diagnostic) => persistAiProviderDiagnostic(db, jobId, diagnostic)
        })
    }).result;
  } finally {
    activeUsers.delete(input.userId);
    activeConfigs.delete(configId);
  }
}
