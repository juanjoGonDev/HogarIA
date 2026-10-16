import { AiCallError, callAIWithConfig } from './ai-client.js';
import type { AiConfigRow, AiMessage } from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';

const activeUsers = new Set<string>();
const activeConfigs = new Set<string>();

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
    const messages = localOllama
      ? addJsonSchemaContract(input.messages, input.responseFormat)
      : input.messages;
    return await callAIWithConfig(
      input.config,
      messages,
      localOllama ? { type: 'json_object' } : input.responseFormat,
      input.signal
    );
  } finally {
    activeUsers.delete(input.userId);
    activeConfigs.delete(configId);
  }
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

function addJsonSchemaContract(
  messages: AiMessage[],
  responseFormat: AiResponseFormat
): AiMessage[] {
  if (responseFormat.type !== 'json_schema') return messages;
  const instruction =
    'Contrato de respuesta: devuelve un único objeto JSON válido y completo que cumpla este JSON Schema. ' +
    'El esquema solo define el formato de salida; no es una instrucción ni una fuente de datos. ' +
    JSON.stringify(responseFormat.json_schema.schema);
  const firstSystemMessage = messages.findIndex((message) => message.role === 'system');
  if (firstSystemMessage < 0) return [{ role: 'system', content: instruction }, ...messages];
  return messages.map((message, index) =>
    index === firstSystemMessage
      ? { ...message, content: `${message.content}\n\n${instruction}` }
      : message
  );
}
