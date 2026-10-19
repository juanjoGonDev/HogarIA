import {
  RECIPE_STEP_PHOTO_SCENES,
  type RecipeStepPhotoScene
} from '../../shared/models/recipe-step-photo';

export { RECIPE_STEP_PHOTO_SCENES, type RecipeStepPhotoScene };

function normalizeInstruction(instruction: string): string {
  return instruction
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES');
}

/** Map instruction wording to a closed generic scene; never send the step text to search. */
export function recipeStepPhotoScene(instruction: string): RecipeStepPhotoScene {
  const text = normalizeInstruction(instruction);

  if (/\b(lav\w*|enjuag\w*|aclar\w*|limpi\w*)\b/.test(text)) return 'wash';
  if (/\b(cort\w*|pic\w*|troce\w*|pel\w*|filete\w*|lamin\w*)\b/.test(text)) return 'cut';
  if (/\b(mezcl\w*|remuev\w*|bate\w*|integra\w*|amas\w*)\b/.test(text)) return 'mix';
  if (/\b(horne\w*|horno|precalienta\w*)\b/.test(text)) return 'bake';
  if (/\b(repos\w*|enfria\w*|descansa\w*)\b/.test(text)) return 'rest';
  if (/\b(sirv\w*|emplat\w*|decor\w*|present\w*)\b/.test(text)) return 'serve';
  if (/\b(coc\w*|cuec\w*|herv\w*|frie\w*|salte\w*|dora\w*|calienta\w*)\b/.test(text)) {
    return 'cook';
  }

  return 'prepare';
}
