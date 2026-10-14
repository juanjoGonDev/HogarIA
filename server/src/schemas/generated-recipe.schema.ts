import { aiRecipeOutputSchema, type AiRecipeOutput } from './recipe-ai-output.schema.js';

/** Backwards-compatible name for the single canonical AI recipe JSON contract. */
export const generatedRecipeCandidateSchema = aiRecipeOutputSchema;
export type GeneratedRecipeCandidate = AiRecipeOutput;
