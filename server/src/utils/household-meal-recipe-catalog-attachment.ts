import type { AiMessagePart } from './ai-client.js';

export const HOUSEHOLD_RECIPE_CATALOG_FILENAME = 'household-recipes-catalog.json';
export const MAX_HOUSEHOLD_RECIPE_CATALOG_BYTES = 2 * 1024 * 1024;

export interface HouseholdRecipeCatalogAttachmentInput {
  recipes: Array<{
    alias: string;
    selectable: boolean;
    recipe: Record<string, unknown>;
  }>;
}

export class HouseholdRecipeCatalogAttachmentError extends Error {
  constructor(readonly code: 'HOUSEHOLD_RECIPE_CATALOG_TOO_LARGE') {
    super(code);
    this.name = 'HouseholdRecipeCatalogAttachmentError';
  }
}

export type HouseholdRecipeCatalogFilePart = Extract<AiMessagePart, { type: 'file' }>;

/** Encode the complete accessible recipe catalog without server-side identities. */
export function createHouseholdRecipeCatalogFilePart(
  catalog: HouseholdRecipeCatalogAttachmentInput
): HouseholdRecipeCatalogFilePart {
  const serializedCatalog = JSON.stringify({ version: 1, ...catalog });
  if (Buffer.byteLength(serializedCatalog, 'utf8') > MAX_HOUSEHOLD_RECIPE_CATALOG_BYTES) {
    throw new HouseholdRecipeCatalogAttachmentError('HOUSEHOLD_RECIPE_CATALOG_TOO_LARGE');
  }

  return {
    type: 'file',
    file: {
      filename: HOUSEHOLD_RECIPE_CATALOG_FILENAME,
      file_data: `data:application/json;base64,${Buffer.from(serializedCatalog, 'utf8').toString('base64')}`
    }
  };
}
