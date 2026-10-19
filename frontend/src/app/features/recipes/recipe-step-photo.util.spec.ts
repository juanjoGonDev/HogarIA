import { recipeStepPhotoScene } from './recipe-step-photo.util';

describe('recipeStepPhotoScene', () => {
  const scenes = [
    ['Lava las verduras.', 'wash'],
    ['Pica la cebolla.', 'cut'],
    ['Mezcla los ingredientes.', 'mix'],
    ['Hornea la masa.', 'bake'],
    ['Deja reposar cinco minutos.', 'rest'],
    ['Saltea en la sartén.', 'cook'],
    ['Sirve en un plato.', 'serve'],
    ['Cocer la zanahoria.', 'cook'],
    ['Prepara los ingredientes.', 'prepare'],
    ['', 'prepare']
  ] as const;

  scenes.forEach(([instruction, scene]) => {
    it(`maps ${instruction || 'an empty step'} to a generic scene`, () => {
      expect(recipeStepPhotoScene(instruction)).toBe(scene);
    });
  });

  it('normalizes accents and avoids sending instruction text as the scene', () => {
    expect(recipeStepPhotoScene('Corta y mézclalo después')).toBe('cut');
    expect(recipeStepPhotoScene('Cocínalo durante diez minutos')).toBe('cook');
  });
});
