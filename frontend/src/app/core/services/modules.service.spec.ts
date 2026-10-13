import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { HouseholdService } from './household.service';
import {
  DEFAULT_HOME_PROFILE,
  HOME_MODULE_OPTIONS,
  HomeModule,
  HomeProfile
} from '../../shared/models/home-profile';
import { TasteProfileService } from './taste-profile.service';
import { DICTS } from '../i18n';
import { MODULE_REGISTRY, ModulesService, moduleOwningPath } from './modules.service';

/**
 * El servicio de modulos se prueba contra un `TasteProfileService` de pega: lo
 * que importa es como interpreta el perfil, como pinta la navegacion y como se
 * comporta cuando la red falla. El guardado se controla a mano (next/error)
 * para poder ver el estado optimista antes de la respuesta.
 */

interface Deferred {
  next: (value: HomeProfile) => void;
  error: (value: unknown) => void;
}

describe('ModulesService', () => {
  let current: HomeProfile;
  let saved: HomeProfile[];
  let pending: Deferred[];
  let ensureLoadedCalls: number;
  let service: ModulesService;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;

  class FakeTasteService {
    readonly isLoaded = signal(true);
    readonly isLoading = signal(false);
    /** Señal real: los computed del servicio deben invalidarse en cada escritura del fixture. */
    private readonly profileSignal = signal(current);
    readonly profile = Object.assign(() => this.profileSignal(), {
      set: (value: HomeProfile) => {
        current = value;
        this.profileSignal.set(value);
      }
    });

    ensureLoaded(): void {
      ensureLoadedCalls++;
    }

    save(_taste: unknown, _status: unknown, patch?: Partial<HomeProfile>): Observable<unknown> {
      const state = { ...current, ...(patch ?? {}) };
      saved.push(state);
      return new Observable<unknown>((subscriber) => {
        pending.push({
          next: (value) => {
            subscriber.next(value);
            subscriber.complete();
          },
          error: (value) => subscriber.error(value)
        });
      });
    }
  }

  function configure(initial: Partial<HomeProfile> = {}): void {
    current = { ...DEFAULT_HOME_PROFILE, ...initial };
    saved = [];
    pending = [];
    ensureLoadedCalls = 0;
    activeHouseholdId = signal<string | null>(null);

    TestBed.configureTestingModule({
      providers: [
        { provide: TasteProfileService, useClass: FakeTasteService },
        { provide: HouseholdService, useValue: { activeHouseholdId } }
      ]
    });

    service = TestBed.inject(ModulesService);
  }

  /** Estado guardado real (lo que veria el servidor tras resolver). */
  function storedModules(): HomeModule[] {
    return current.modules;
  }

  it('aplaza el perfil protegido hasta tener hogar activo y lo carga al crear o unirse', () => {
    configure();
    TestBed.flushEffects();
    expect(ensureLoadedCalls).toBe(0);

    activeHouseholdId.set('home-1');
    TestBed.flushEffects();
    expect(ensureLoadedCalls).toBe(1);
  });

  it('expone si el perfil inicial ya permite editar los modulos', () => {
    configure({ modules: [] });
    const taste = TestBed.inject(TasteProfileService) as unknown as FakeTasteService;

    expect(service.profileLoaded()).toBeTrue();
    taste.isLoaded.set(false);
    expect(service.profileLoaded()).toBeFalse();
    taste.isLoading.set(true);
    expect(service.profileLoading()).toBeTrue();

    taste.isLoaded.set(true);
    taste.isLoading.set(false);
    expect(service.profileLoaded()).toBeTrue();
    expect(service.profileLoading()).toBeFalse();
  });

  it('sin seleccion deja visibles todos los modulos que trae el build', () => {
    configure({ modules: [] });

    expect(service.active()).toEqual(['meals', 'pantry', 'shopping', 'receipts']);
    expect(service.isPathVisible('/calendar')).toBeTrue();
    expect(service.isPathVisible('/recipes')).toBeTrue();
    expect(service.isPathVisible('/pantry')).toBeTrue();
  });

  it('el nucleo nunca se oculta: inicio, hogar, preferencias y ajustes', () => {
    configure({ modules: [] });

    // La agenda es de la casa, no de la cocina: apagar «comer» no la borra, asi que vive en el
    // nucleo y ningun modulo la gobierna (lo que se apaga dentro es el contenido de cocina).
    for (const path of [
      '/dashboard',
      '/calendar',
      '/account',
      '/household',
      '/preferences',
      '/settings',
      '/logs',
      '/ai-config'
    ]) {
      expect(service.isPathVisible(path)).withContext(path).toBeTrue();
    }
    expect(moduleOwningPath('/settings')).toBeUndefined();
    expect(moduleOwningPath('/calendar')).toBeUndefined();
  });

  it('una seleccion explicita filtra: lo que no esta marcado, fuera', () => {
    configure({ modules: ['pantry'] });

    expect(service.isPathVisible('/pantry')).toBeTrue();
    // El calendario NO entra en este filtro: es la agenda de la casa. Lo que «comer» apaga son las
    // recetas y, dentro del calendario, lo que se ve de cocina —eso lo decide la propia vista.
    expect(service.isPathVisible('/calendar')).toBeTrue();
    expect(service.isPathVisible('/recipes')).toBeFalse();
  });

  it('un modulo marcado que el build no trae no anade ninguna ruta', () => {
    configure({ modules: ['meals', 'home'] });

    expect(service.isEnabled('home')).toBeTrue();
    expect(service.isAvailable('home')).toBeFalse();
    // Todavia no existe la pantalla: enlazarla seria mandarle a un 404.
    expect(service.isPathVisible('/tasks')).toBeFalse();
    expect(service.isPathVisible('/calendar')).toBeTrue();
  });

  it('apagar un modulo quita sus rutas al instante, sin recargar', () => {
    configure({ modules: [] });
    expect(service.isPathVisible('/pantry')).toBeTrue();

    service.toggle('pantry');

    // Optimista: la navegacion ya refleja el cambio, sin respuesta del server.
    const remainingModules = MODULE_REGISTRY.filter(
      (definition) => definition.available && definition.id !== 'pantry'
    ).map((definition) => definition.id);
    expect(service.selected()).toEqual(remainingModules);
    expect(service.isPathVisible('/pantry')).toBeFalse();
    expect(service.isPathVisible('/calendar')).toBeTrue();

    pending[0].next(current);
    expect(storedModules()).toEqual(remainingModules);
    expect(service.isSaving()).toBeFalse();
  });

  it('encender un modulo disponible anade sus rutas y lo guarda', () => {
    configure({ modules: ['pantry'] });

    service.toggle('meals');

    expect(service.selected()).toEqual(['pantry', 'meals']);
    // Lo que «comer» anade son las recetas; la agenda ya estaba, porque no es suya.
    expect(service.isPathVisible('/calendar')).toBeTrue();
    expect(service.isPathVisible('/recipes')).toBeTrue();
    expect(saved.length).toBe(1);
    expect(saved[0].modules).toEqual(['pantry', 'meals']);
    expect(service.isSaving()).toBeTrue();

    pending[0].next(current);
    expect(service.isSaving()).toBeFalse();
    expect(service.lastError()).toBeNull();
  });

  it('si el guardado falla, se vuelve al estado anterior', () => {
    configure({ modules: ['pantry', 'meals'] });

    service.toggle('pantry');
    expect(service.isPathVisible('/pantry')).toBeFalse();

    pending[0].error(new Error('500'));

    expect(storedModules()).toEqual(['pantry', 'meals']);
    expect(service.isPathVisible('/pantry')).toBeTrue();
    expect(service.isSaving()).toBeFalse();
    expect(service.lastError()).toBe('MODULE_SAVE_FAILED');

    service.toggle('pantry');
    expect(service.selected()).toEqual(['meals']);
    expect(service.isSaving()).toBeTrue();

    pending[1].next(current);

    expect(storedModules()).toEqual(['meals']);
    expect(service.isSaving()).toBeFalse();
    expect(service.lastError()).toBeNull();
  });

  it('el rollback no toca el resto del perfil (el nivel de cocina sigue)', () => {
    configure({ cookingLevel: 'expert', modules: ['pantry'] });

    service.toggle('meals');
    expect(service.isEnabled('meals')).toBeTrue();

    pending[0].error(new Error('500'));

    expect(current.cookingLevel).toBe('expert');
    expect(storedModules()).toEqual(['pantry']);
    expect(service.isEnabled('meals')).toBeFalse();
  });

  it('no deja apagar la ultima seccion visible (si no, la seleccion vacia la reviviria)', () => {
    configure({ modules: ['meals', 'pantry'] });

    expect(service.visibleNow()).toEqual(['meals', 'pantry']);
    expect(service.canSwitchOff('pantry')).toBeTrue();

    service.toggle('pantry');
    pending[0].next(current);

    expect(service.visibleNow()).toEqual(['meals']);
    expect(service.canSwitchOff('meals')).toBeFalse();
  });

  it('lo que el build no trae se puede apagar siempre: no ocupa navegacion', () => {
    configure({ modules: ['meals', 'pantry', 'home'] });

    expect(service.canSwitchOff('home')).toBeTrue();
    expect(service.canSwitchOff('meals')).toBeTrue();
  });

  it('restablecer vuelve a la seleccion vacia, que significa todo lo disponible', () => {
    configure({ modules: ['pantry'] });

    service.resetSelection();
    pending[0].next(current);

    expect(service.selected()).toEqual([]);
    expect(service.isPathVisible('/calendar')).toBeTrue();
    expect(service.isPathVisible('/pantry')).toBeTrue();
  });

  it('restablecer cuando ya estaba vacio no dispara ninguna peticion', () => {
    configure({ modules: [] });

    service.resetSelection();

    expect(saved.length).toBe(0);
    expect(service.isSaving()).toBeFalse();
  });

  it('un id desconocido no rompe nada: ni definicion, ni disponibilidad', () => {
    configure();

    expect(service.definition('no-existe' as never)).toBeUndefined();
    expect(service.isAvailable('no-existe' as never)).toBeFalse();
    expect(service.isPathVisible('/no-existe')).toBeTrue();
  });

  it('el registro cubre los modulos del modelo, sin rutas repetidas', () => {
    const paths = MODULE_REGISTRY.flatMap((definition) => definition.paths);
    const ids = MODULE_REGISTRY.map((definition) => definition.id);

    expect(MODULE_REGISTRY.length).toBe(HOME_MODULE_OPTIONS.length);
    expect(ids.sort()).toEqual(HOME_MODULE_OPTIONS.map((option) => option.value).sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(MODULE_REGISTRY.every((definition) => definition.hintKey.length > 0)).toBeTrue();
    // Y la clave no puede estar de adorno: si no resuelve en los dos idiomas, la pantalla sale a medias.
    for (const definition of MODULE_REGISTRY) {
      for (const idioma of ['es', 'en'] as const) {
        expect(DICTS[idioma][definition.labelKey])
          .withContext(`${definition.id} en ${idioma}`)
          .toBeTruthy();
        expect(DICTS[idioma][definition.hintKey])
          .withContext(`${definition.id} (pista) en ${idioma}`)
          .toBeTruthy();
      }
    }
    expect(MODULE_REGISTRY.filter((definition) => definition.available).length).toBe(4);
    // El registro de rutas y las opciones del perfil tienen que decir lo mismo de
    // cada modulo: el picker usa las segundas y la navegacion el primero. Cuando
    // divergen, la app enlaza una pantalla que se marca como «pronto» (o al reves).
    for (const definition of MODULE_REGISTRY) {
      const option = HOME_MODULE_OPTIONS.find((candidate) => candidate.value === definition.id);
      expect(option).withContext(`opcion de perfil para ${definition.id}`).toBeDefined();
      expect(option?.available)
        .withContext(`available de ${definition.id}`)
        .toBe(definition.available);
    }
  });
});
