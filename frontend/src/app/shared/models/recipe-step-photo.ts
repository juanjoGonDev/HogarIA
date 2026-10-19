export const RECIPE_STEP_PHOTO_SCENES = [
  'wash',
  'cut',
  'mix',
  'cook',
  'bake',
  'rest',
  'serve',
  'prepare'
] as const;

export type RecipeStepPhotoScene = (typeof RECIPE_STEP_PHOTO_SCENES)[number];

export interface RecipeStepPhoto {
  id: string;
  altText: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  /** Same-origin preview returned by the server's bounded Wikimedia proxy. */
  previewUrl?: string;
}
