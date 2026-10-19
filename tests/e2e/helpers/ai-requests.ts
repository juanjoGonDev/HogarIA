const GENERATION_ENDPOINTS = new Set([
  '/api/ai/generate-recipe',
  '/api/ai/generate-multiple-recipes'
]);

/** Detects recipe-generation actions; harmless provider-configuration reads do not count. */
export function isRecipeGenerationRequest(url: string, method: string): boolean {
  return method === 'POST' && GENERATION_ENDPOINTS.has(new URL(url).pathname);
}
