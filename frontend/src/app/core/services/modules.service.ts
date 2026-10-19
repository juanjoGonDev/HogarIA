import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { finalize } from 'rxjs';
import type { HomeModule } from '../../shared/models/home-profile';
import { MODULE_REGISTRY, moduleOwningPath, type ModuleDefinition } from '../modules.registry';
import { TasteProfileService } from './taste-profile.service';
import { HouseholdService } from './household.service';

/**
 * Módulos de HogarIA: qué secciones de la app tiene encendida esta cuenta.
 *
 * Es un flag de la APP (como el tema o el idioma), no del comensal: por eso se
 * edita en Configuración y no en Preferencias. El tour pregunta lo mismo, y lo
 * que se contesta ahí se puede cambiar aquí sin volver al tour.
 *
 * Tres reglas hacen que esto sea usable:
 *
 * 1. **Seleccion vacía = todo lo disponible.** Nadie pierde «Recetas» o
 *    «Despensa» por haber saltado el onboarding.
 * 2. **Se puede activar lo que aún no existe.** `available: false` significa
 *    «este build todavía no lo trae». Marcado se guarda, y la sección aparece
 *    sola cuando llegue el build que la contiene; mientras tanto no se enlaza,
 *    para no llevar a nadie a una ruta que no existe.
 * 3. **Se aplica sin recargar.** Todo deriva de la señal del perfil: la
 *    navegación y las tarjetas se repintan al pulsar el interruptor.
 */

// El registro vive en `core/modules.registry.ts` (puro, con su spec). Se reexporta para que las
// vistas que importaban el tipo o la tabla desde aqui no cambien de ruta.
export { MODULE_REGISTRY, moduleOwningPath, type ModuleDefinition } from '../modules.registry';

@Injectable({ providedIn: 'root' })
export class ModulesService {
  private readonly tasteService = inject(TasteProfileService);
  private readonly householdService = inject(HouseholdService);

  readonly registry = MODULE_REGISTRY;
  readonly isSaving = signal(false);
  readonly profileLoaded = this.tasteService.isLoaded.asReadonly();
  readonly profileLoading = this.tasteService.isLoading.asReadonly();
  /** Código del último guardado fallido: la vista lo traduce, el servicio no. */
  readonly lastError = signal<string | null>(null);

  /** Lo que hay guardado en la cuenta, sin interpretar. */
  readonly selected = computed(() => this.tasteService.profile().modules);

  /** Lo que de verdad está encendido: sin selección, todo lo del build. */
  readonly active = computed<HomeModule[]>(() => {
    const selected = this.selected();
    if (selected.length > 0) return selected;
    return MODULE_REGISTRY.filter((definition) => definition.available).map(
      (definition) => definition.id
    );
  });

  constructor() {
    // El perfil está protegido por hogar. Cárgalo cuando exista uno activo, tanto al
    // entrar con una membresía como después de crear/unirse sin recargar la app.
    effect(() => {
      if (this.householdService.activeHouseholdId()) {
        untracked(() => this.tasteService.ensureLoaded());
      }
    });
  }

  /** Secciones que de verdad se ven ahora mismo (disponibles y encendidas). */
  readonly visibleNow = computed(() => this.active().filter((id) => this.isAvailable(id)));

  /**
   * La ultima seccion visible no se apaga: con la seleccion vacia la regla es
   * «todo disponible», asi que apagar la ultima habria vuelto a encender todas
   * justo al reves de lo que pidio quien usa la app. Se restablece con
   * `resetSelection()`, que es la accion explicita.
   */
  canSwitchOff(id: HomeModule): boolean {
    if (!this.isEnabled(id)) return true;
    if (!this.isAvailable(id)) return true;
    return this.visibleNow().length > 1;
  }

  /** Vuelve al significado por defecto: todas las que trae este build. */
  resetSelection(): void {
    if (this.selected().length === 0) return;
    this.apply([]);
  }

  definition(id: HomeModule | string): ModuleDefinition | undefined {
    return MODULE_REGISTRY.find((definition) => definition.id === id);
  }

  isAvailable(id: HomeModule): boolean {
    return this.definition(id)?.available ?? false;
  }

  /** Marcado en la cuenta, exista o no la sección en este build. */
  isEnabled(id: HomeModule): boolean {
    return this.active().includes(id);
  }

  /**
   * Si una ruta debe aparecer en la navegación. Metodo, no signal: lo lee un
   * `computed` de la vista y asi la navegacion se repinta sola al pulsar.
   */
  isPathVisible(path: string): boolean {
    const owner = moduleOwningPath(path);
    if (!owner) return true;
    if (!owner.available) return false;
    return this.active().includes(owner.id);
  }

  /** Activa o apaga un módulo. Optimista: la UI responde al clic, no a la red. */
  toggle(id: HomeModule): void {
    const current = this.active();
    const next = this.isEnabled(id) ? current.filter((module) => module !== id) : [...current, id];

    this.apply(next);
  }

  private apply(next: HomeModule[]): void {
    const previous = this.tasteService.profile();
    this.tasteService.profile.set({ ...previous, modules: next });
    this.isSaving.set(true);
    this.lastError.set(null);

    this.tasteService
      .save({}, undefined, { modules: next })
      .pipe(finalize(() => this.isSaving.set(false)))
      .subscribe({
        error: () => {
          // Rollback: sin esto la navegacion mentiria sobre lo guardado.
          this.tasteService.profile.set(previous);
          this.lastError.set('MODULE_SAVE_FAILED');
        }
      });
  }
}
