/**
 * Que es un modulo, y que rutas goberna. En puro y fuera del servicio por dos razones: un spec
 * que corre en node no puede importar un fichero con `@Injectable` (el JIT de `@angular/core`
 * necesita el runner), y esta tabla es exactamente el tipo de decision que hay que poder fijar
 * con un test —«quitar la cocina no borra la agenda de la casa» es una linea, no una opinion—.
 */
import type { HomeModule } from '../shared/models/home-profile';
import type { TranslationKey } from './i18n';

export interface ModuleDefinition {
  id: HomeModule;
  /** Clave del diccionario: lo que se ensena. El identificador (`id`) es lo que se guarda. */
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  /** Si este build trae ya la sección. */
  available: boolean;
  /** Rutas de primer nivel que gobierna este módulo. */
  paths: string[];
}

/**
 * Registro único. Las rutas de un módulo son las que se ocultan si se apaga;
 * una ruta que no está aquí (Inicio, **Calendario**, Hogar, Preferencias, Configuración, Logs)
 * es núcleo: siempre visible. Nadie se queda sin salidas de la app.
 *
 * Y por eso `/calendar` NO está en `meals`: la agenda es de la casa (soltar un recado, ver lo
 * que queda por comprar, los planes de cada dia), y apagar «Comidas y recetas» no puede borrar
 * una seccion que no es de cocina. Lo que el modulo goberna es lo que hay de cocina DENTRO: la
 * capa `Comidas`, los anadidos de plato, el anillo de objetivo y la franja de energia. Eso lo
 * decide la propia vista con `kitchen` —no el registro—, porque una ruta que si existe pero
 * vacia es peor que un boton de menos.
 */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    id: 'meals',
    labelKey: 'profile.module.meals',
    hintKey: 'profile.registryHint.meals',
    available: true,
    paths: ['/recipes']
  },
  {
    id: 'pantry',
    labelKey: 'profile.module.pantry',
    hintKey: 'profile.registryHint.pantry',
    available: true,
    paths: ['/pantry']
  },
  {
    id: 'shopping',
    labelKey: 'profile.module.shopping',
    hintKey: 'profile.registryHint.shopping',
    available: true,
    paths: ['/shopping']
  },
  {
    id: 'receipts',
    labelKey: 'profile.module.receipts',
    hintKey: 'profile.registryHint.receipts',
    available: true,
    paths: ['/receipts']
  },
  {
    id: 'home',
    labelKey: 'profile.module.tasks',
    hintKey: 'profile.moduleHint.tasks',
    available: false,
    paths: ['/tasks']
  }
];

const REGISTRY_BY_PATH = new Map<string, ModuleDefinition>();
for (const definition of MODULE_REGISTRY) {
  for (const path of definition.paths) REGISTRY_BY_PATH.set(path, definition);
}

/** A qué módulo pertenece una ruta (undefined = núcleo, siempre visible). */
export function moduleOwningPath(path: string): ModuleDefinition | undefined {
  return REGISTRY_BY_PATH.get(path);
}
