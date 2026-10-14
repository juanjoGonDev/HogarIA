export const RECIPE_STEP_VIDEO_SCENES = [
  'wash',
  'cut',
  'mix',
  'cook',
  'bake',
  'rest',
  'serve',
  'prepare'
] as const;

export type RecipeStepVideoScene = (typeof RECIPE_STEP_VIDEO_SCENES)[number];
export type RecipeStepVideoMime = 'video/mp4' | 'video/webm';

/** Public Commons metadata. The upstream media URL is deliberately never exposed. */
export interface RecipeStepVideoCandidate {
  id: string;
  title: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  mimeType: RecipeStepVideoMime;
}
