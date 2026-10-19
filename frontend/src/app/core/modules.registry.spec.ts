import { MODULE_REGISTRY, moduleOwningPath } from './modules.registry';

/**
 * El registro es la unica fuente de «esto existe o no existe segun la cuenta», y un error aqui
 * no se ve en el commit: se ve en el movil de alguien, con una seccion entera borrada. De ahi
 * que se pruebe en puro, sin Angular.
 */
describe('modules.registry — que borra un interruptor', () => {
  it('apagar la cocina no borra el calendario', () => {
    // La agenda es de la casa: listas de la compra, recados y planes. El modulo `meals` manda
    // sobre lo que hay de cocina dentro, no sobre la ruta.
    expect(moduleOwningPath('/calendar')).toBeUndefined();
    expect(MODULE_REGISTRY.find((d) => d.id === 'meals')?.paths).toEqual(['/recipes']);
  });

  it('cada ruta de primer nivel pertenece a lo sumo a un modulo, y ninguna es raiz', () => {
    const seen = new Map<string, string>();
    for (const definition of MODULE_REGISTRY) {
      for (const path of definition.paths) {
        // Ningun modulo puede gobernar la raiz: eso dejaria la app entera a merced de un switch.
        expect(path.length > 1).toBe(true);
        // Una ruta, un dueno: dos modulos que la apaguen a la vez es una decision sin tomar.
        expect(seen.has(path)).toBe(false);
        seen.set(path, definition.id);
      }
    }
    // Las rutas nucleares, declaradas aqui para que nadie las "asigne" por accidente.
    for (const core of ['/dashboard', '/calendar', '/account', '/household', '/preferences', '/settings', '/logs']) {
      expect(seen.has(core)).toBe(false);
    }
  });

  it('lo que este build no trae sigue sin enlazarse', () => {
    const unavailable = MODULE_REGISTRY.filter((d) => !d.available);
    expect(unavailable.length).toBeGreaterThan(0);
    for (const definition of unavailable) expect(moduleOwningPath(definition.paths[0])?.id).toBe(definition.id);
  });
});
