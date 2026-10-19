import { Injectable, DestroyRef, effect, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpContext, HttpParams } from '@angular/common/http';
import { Observable, fromEvent, of, firstValueFrom } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { openResilientStream } from '../../core/sse';
import { ToastService } from './toast.service';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AuthService } from './auth.service';
import { HouseholdService } from './household.service';
import { originalHttpError } from './shopping-http-error';
import { photoAnalysisHttpContext } from './shopping-photo-http-context';
import type { ShoppingStreamPath } from './shopping-stream-path';
import {
  CompletePurchaseInput,
  CompleteReceipt,
  CreateItemInput,
  ListDiscount,
  ListEvent,
  ListsMeta,
  ListsQuery,
  DiscountInput,
  ListEstimate,
  KnownProduct,
  MissingPriceLine,
  CompleteResult,
  PhotoAnalysis,
  PhotoLine,
  PhotoOutcome,
  PriceObservation,
  productKeyOf,
  ShoppingCategory,
  ShoppingList,
  ShoppingListItem,
  ShoppingListStatus,
  StoreCount,
  SugerenciaDeCompra
} from '../../shared/models/shopping.model';
import { I18nService } from '../../core/services/i18n.service';

/** Operacion de escritura en espera: la misma observable, reintentable tal cual. */
interface QueuedWrite {
  key: string;
  householdId: string | null;
  send: () => Observable<unknown>;
}

/**
 * Servicio de la lista de la compra.
 *
 * Tres decisiones que vienen de la pantalla, no del backend:
 *  1. Todo lo que se marca, se edita o se arrastra pinta YA y se guarda detras
 *     (autosave). El unico feedback de guardado es una barra fina: nadie mira una
 *     tiquisima animacion mientras tiene las manos llenas.
 *  2. Si la red falla, la escritura no se pierde: entra en una cola claveada (marcar
 *     dos veces la misma linea apila una sola operacion) y se reintenta sola al
 *     volver la conexion. La copia local es la verdad visible mientras tanto.
 *  3. Un conflicto de version (`LIST_VERSION_CONFLICT`) nunca pisa lo del otro
 *     aparato: se recarga la lista y se avisa.
 */
@Injectable({ providedIn: 'root' })
export class ShoppingService {
  private readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdService);
  private readonly apiUrl = '/api/shopping';
  private lastContextRevision = this.household.contextRevision();
  private lastActiveHouseholdId = this.household.activeHouseholdId();

  private readonly queue: QueuedWrite[] = [];
  private onlineEventVersion = 0;
  private pausedAfterNetworkError = false;
  readonly lists = signal<ShoppingList[]>([]);
  readonly list = signal<ShoppingList | null>(null);
  readonly items = signal<ShoppingListItem[]>([]);
  readonly estimate = signal<ListEstimate | null>(null);
  readonly prices = signal<PriceObservation[]>([]);
  /** Catalogo improvisado: lo que la casa ya pago, agrupado por producto y por tienda. */
  readonly knownProducts = signal<KnownProduct[]>([]);
  readonly loadingLists = signal(false);
  readonly loadingList = signal(false);
  readonly saving = signal(false);
  readonly listsMeta = signal<ListsMeta>({ total: 0, limit: 25, offset: 0 });
  readonly stores = signal<StoreCount[]>([]);
  // ## 12al: la sugerencia estadistica y su lista abierta, si ya existe.
  readonly sugerencia = signal<SugerenciaDeCompra | null>(null);
  readonly cargandoSugerencia = signal(false);
  readonly categories = signal<ShoppingCategory[]>([]);
  readonly events = signal<ListEvent[]>([]);
  private listsQuery: ListsQuery = {};
  private categoriesLoaded = false;
  readonly pendingWrites = signal(0);

  constructor() {
    effect(() => {
      const revision = this.household.contextRevision();
      const activeHouseholdId = this.household.activeHouseholdId();
      const switchingHousehold = this.household.switchingHousehold();
      const revisionChanged = revision !== this.lastContextRevision;
      const activeHouseholdChanged = activeHouseholdId !== this.lastActiveHouseholdId;
      this.lastContextRevision = revision;
      this.lastActiveHouseholdId = activeHouseholdId;
      if (activeHouseholdChanged || (revisionChanged && switchingHousehold)) {
        this.clearHouseholdScopedState();
      }
    });

    // Al volver la conexion, la cola sale en orden. Sin reintentos agresivos:
    // un 4xx es un error de datos, no de red, y reintentarlo solo gastaria bateria.
    fromEvent(window, 'online')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.onlineEventVersion += 1;
        this.pausedAfterNetworkError = false;
        void this.flush();
      });
  }

  // ---------------------------------------------------------------- listas

  /**
   * Filtros, orden y paginacion van en la URL y los resuelve el server (`/lists?`).
   * No se filtra en memoria: con el historial de un ano, "las de este mes" tendria que
   * leer 400 listas para ensenar 25, y la bandeja se abre justo cuando hay prisa.
   */
  loadLists(query: ListsQuery | ShoppingListStatus = {}): void {
    const contextRevision = this.household.contextRevision();
    const normalized: ListsQuery = typeof query === 'string' ? { status: query } : query;
    this.listsQuery = normalized;
    this.loadingLists.set(true);
    let params = new HttpParams().set('status', normalized.status ?? 'active');
    if (normalized.q) params = params.set('q', normalized.q);
    if (normalized.store) params = params.set('store', normalized.store);
    if (normalized.minTotalMinor && normalized.minTotalMinor > 0)
      params = params.set('minTotalMinor', String(normalized.minTotalMinor));
    if (normalized.from) params = params.set('from', normalized.from);
    if (normalized.to) params = params.set('to', normalized.to);
    if (normalized.sort) params = params.set('sort', normalized.sort);
    if (normalized.dir) params = params.set('dir', normalized.dir);
    params = params
      .set('limit', String(normalized.limit ?? 25))
      .set('offset', String(normalized.offset ?? 0));
    this.http
      .get<{ data: ShoppingList[]; meta?: ListsMeta }>(`${this.apiUrl}/lists`, { params })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrentContext(contextRevision)) return;
          this.lists.set(response.data);
          if (response.meta) this.listsMeta.set(response.meta);
          this.loadingLists.set(false);
        },
        error: () => {
          if (this.isCurrentContext(contextRevision)) this.loadingLists.set(false);
        }
      });
  }

  /** Repetir la ultima lectura: lo que llama el SSE cuando avisa de un cambio ajeno. */
  reloadLists(): void {
    this.loadLists(this.listsQuery);
  }

  /**
   * ## 12al: la previsualizacion de la lista sugerida (ritmo de compra, stock, caducidad y
   * plan de la semana, SIN IA). Es una lectura: no escribe nada hasta que se pide.
   */
  cargarSugerencia(): void {
    const contextRevision = this.household.contextRevision();
    this.cargandoSugerencia.set(true);
    this.http
      .get<{ data: SugerenciaDeCompra }>(`${this.apiUrl}/suggested`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrentContext(contextRevision)) return;
          this.sugerencia.set(response.data);
          this.cargandoSugerencia.set(false);
        },
        error: () => {
          if (this.isCurrentContext(contextRevision)) this.cargandoSugerencia.set(false);
        }
      });
  }

  /**
   * Crear la lista sugerida… o actualizar la que ya este abierta: el server decide cual de
   * las dos toca, y devuelve `creada` para que el aviso diga la verdad.
   */
  async aplicarSugerida(): Promise<{ id: string; creada: boolean; sugeridos: number } | null> {
    const resultado = await this.request<{ id: string; creada: boolean; sugeridos: number }>(() =>
      this.http
        .post<{ data: { id: string; creada: boolean; sugeridos: number } }>(
          `${this.apiUrl}/suggested`,
          { name: this.i18n.t('shopping_suggested.nombre_lista') }
        )
        .pipe(
          map((response) => response.data),
          tap(() => {
            this.cargarSugerencia();
            this.reloadLists();
          })
        )
    );
    return resultado;
  }

  loadStores(): void {
    const contextRevision = this.household.contextRevision();
    this.http
      .get<{ data: StoreCount[] }>(`${this.apiUrl}/stores`)
      .pipe(
        map((response) => response.data),
        catchError(() => of([] as StoreCount[])),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((data) => {
        if (this.isCurrentContext(contextRevision)) this.stores.set(data);
      });
  }

  // ------------------------------------------------------- secciones / catalogo

  /** El catalogo es dato (HOGARIA-SPEC 8f): el prompt de la foto y la pantalla lo comparten. */
  loadCategories(force = false): void {
    if (this.categoriesLoaded && !force) return;
    const contextRevision = this.household.contextRevision();
    this.http
      .get<{ data: ShoppingCategory[] }>(`${this.apiUrl}/categories`)
      .pipe(
        map((response) => response.data),
        catchError(() => of([] as ShoppingCategory[])),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (categories) => {
          if (!this.isCurrentContext(contextRevision)) return;
          this.categoriesLoaded = true;
          // Catalogo vacio (sin red o seed pendiente): la pantalla conserva
          // LIST_CATEGORIES como fallback y no se queda sin agrupar.
          this.categories.set(categories);
        }
      });
  }

  createCategory(name: string, color?: string | null): Promise<ShoppingCategory | null> {
    return this.request<ShoppingCategory>(() =>
      this.http
        .post<{ data: ShoppingCategory }>(`${this.apiUrl}/categories`, {
          name,
          color: color ?? null
        })
        .pipe(
          map((response) => response.data),
          tap(() => this.loadCategories(true))
        )
    );
  }

  // ------------------------------------------------------------ descuentos

  setDiscount(listId: string, input: DiscountInput | null): Promise<ListDiscount | null> {
    if (input === null) {
      return this.request<ListDiscount | null>(() =>
        this.http
          .delete<{ data: ListDiscount | null }>(`${this.apiUrl}/lists/${listId}/discount`)
          .pipe(
            map((response) => response.data),
            tap(() => this.loadEstimate(listId))
          )
      );
    }
    return this.request<ListDiscount | null>(() =>
      this.http
        .put<{ data: ListDiscount | null }>(`${this.apiUrl}/lists/${listId}/discount`, input)
        .pipe(
          map((response) => response.data),
          tap(() => this.loadEstimate(listId))
        )
    );
  }

  // ------------------------------------------------------------- auditoria / en vivo

  loadEvents(listId: string, limit = 60): void {
    const contextRevision = this.household.contextRevision();
    const params = new HttpParams().set('limit', String(limit));
    this.http
      .get<{ data: ListEvent[] }>(`${this.apiUrl}/lists/${listId}/events`, { params })
      .pipe(
        map((response) => response.data),
        catchError(() => of([] as ListEvent[])),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((events) => {
        if (this.isCurrentContext(contextRevision)) this.events.set(events);
      });
  }

  /**
   * Suscripcion SSE. El token va por query porque `EventSource` no admite cabeceras, y el
   * server solo lo acepta en `/api/shopping/stream/*` — ver `auth.middleware.ts`.
   * Devuelve la funcion de cierre: quien suscribe es quien la llama en `ngOnDestroy`.
   */
  openStream(path: ShoppingStreamPath, onEvent: (payload: unknown) => void): () => void {
    const contextRevision = this.household.contextRevision();
    const token = this.auth.getToken();
    // El `access_token` por query sigue siendo la unica via del EventSource, pero el
    // reconnect now is ours: un token caducado produce un 401 tras el 401, y una tanda
    // de esos por cada pestana abierta es exactamente el bucle que deja la app sin
    // cupo para nada mas. `maxRetries` corto: mejor «sin conexion en vivo» visible.
    const stream = openResilientStream(
      `${this.apiUrl}/stream/${path}?access_token=${encodeURIComponent(token ?? '')}`,
      {
        events: ['change', 'ready'],
        maxRetries: 6,
        onMessage: (data) => {
          if (!this.isCurrentContext(contextRevision)) return;
          try {
            onEvent(JSON.parse(data) as unknown);
          } catch {
            onEvent(null);
          }
        }
      }
    );
    return () => stream.close();
  }

  // -------------------------------------------------------------- entrada por foto

  /**
   * Analizar NO escribe: la persona repasa la hoja y luego manda `applyLines`. Un modelo
   * que se equivoca con una etiqueta no deberia poder tocar la lista sin que nadie lo vea.
   * La hoja presenta los errores aqui; el interceptor no debe duplicarlos en un toast global.
   */
  analyzePhoto(
    listId: string,
    image: string,
    mode: 'auto' | 'ticket' | 'shelf' = 'auto',
    note?: string
  ): Promise<PhotoOutcome> {
    const failure = (
      status: number,
      message: string,
      data: Record<string, unknown>
    ): PhotoOutcome => ({ ok: false, status, message, data });
    return firstValue(
      this.http
        .post<{ data: PhotoAnalysis }>(
          `${this.apiUrl}/lists/${listId}/photo/analyze`,
          { image, mode, note: note?.trim() || undefined },
          { context: photoAnalysisHttpContext() }
        )
        .pipe(
          map((response) => ({ ok: true, data: response.data }) as PhotoOutcome),
          catchError((error: unknown) => {
            const response = originalHttpError(error);
            const body = (response.error ?? {}) as {
              message?: string;
              data?: Record<string, unknown>;
            };
            return of(
              failure(response?.status ?? 0, body.message ?? 'AI_UNAVAILABLE', body.data ?? {})
            );
          })
        )
    );
  }

  applyPhotoLines(
    listId: string,
    lines: PhotoLine[]
  ): Promise<{ added: number; merged: number[]; createdCategories: string[] } | null> {
    return this.request<{ added: number; merged: number[]; createdCategories: string[] }>(() =>
      this.http
        .post<{ data: { added: number; merged: number[]; createdCategories: string[] } }>(
          `${this.apiUrl}/lists/${listId}/items/apply`,
          { lines }
        )
        .pipe(
          map((response) => response.data),
          tap(() => {
            this.loadList(listId);
            this.loadCategories(true);
          })
        )
    );
  }

  createList(name: string, store?: string | null): Promise<ShoppingList | null> {
    return this.request<ShoppingList>(() =>
      this.http
        .post<{ data: ShoppingList }>(`${this.apiUrl}/lists`, {
          name,
          store: store?.trim() || null
        })
        .pipe(
          map((response) => response.data),
          tap(() => this.loadLists())
        )
    );
  }

  /**
   * El `version` del body es el CAS del server: se manda la version que uno tiene en
   * la mano y, si no coincide, llega 409 en lugar de pisar el cambio de la otra persona.
   */
  renameList(
    id: string,
    patch: { name?: string; store?: string | null; status?: ShoppingListStatus },
    version?: number
  ): Promise<ShoppingList | null> {
    const expected =
      version ?? this.list()?.version ?? this.lists().find((list) => list.id === id)?.version ?? 1;
    return this.request(
      () =>
        this.http
          .patch<{ data: ShoppingList }>(
            `${this.apiUrl}/lists/${id}`,
            {
              ...patch,
              version: expected
            },
            { context: new HttpContext().set(SILENT_TOAST, true) }
          )
          .pipe(
            map((response) => response.data),
            tap((list) =>
              this.list.update((current) => (current && current.id === list.id ? list : current))
            )
          ),
      true
    );
  }

  /**
   * `done` pasa por `/complete`, que ademas de archivar aprende los precios pagados.
   * Volver atras (el Deshacer de la barra) es un PATCH de estado: reabrir no necesita
   * endpoint propio, el estado es una columna mas.
   */
  setStatus(id: string, status: ShoppingListStatus): Promise<ShoppingList | CompleteResult | null> {
    if (status === 'done') {
      return this.complete(id).then((result) => {
        if (!result.ok && result.code === 'PRICES_MISSING') {
          // Desde la bandeja no hay hoja de precios a la que llevar a la persona: se le dice
          // lo que falta, y el detalle de la lista si que tiene donde escribirlo.
          this.toast.warning(
            this.i18n.t('ui.faltan_precios'),
            this.i18n.t(
              result.missing.length === 1
                ? 'ui.linea_sin_precio_uno'
                : 'ui.linea_sin_precio_varios',
              { n: result.missing.length }
            )
          );
        }
        if (!result.ok && result.code === 'STORE_REQUIRED') {
          this.toast.warning(
            this.i18n.t('ui.falta_el_establecimiento'),
            this.i18n.t('ui.el_precio_se_guarda')
          );
        }
        return result;
      });
    }
    return this.renameList(id, { status }).then((list) => {
      if (list) this.reloadLists();
      return list;
    });
  }

  /**
   * Cerrar la compra. Devuelve un RESULTADO, no una promesa que falla: los dos rechazos del
   * server (lineas sin precio, tienda sin decir) son un formulario que se abre en la propia
   * pantalla, y tratarlos como un error de red es la diferencia entre «lo arreglo aqui» y
   * «no se que ha pasado». Por eso la llamada se marca como silenciosa en el interceptor.
   */
  async complete(listId: string, body: CompletePurchaseInput = {}): Promise<CompleteResult> {
    try {
      const response = await firstValue(
        this.track(
          this.http.post<{ data: CompleteReceipt }>(
            `${this.apiUrl}/lists/${listId}/complete`,
            body,
            {
              context: new HttpContext().set(SILENT_TOAST, true)
            }
          )
        )
      );
      this.loadList(listId);
      this.loadLists();
      return { ok: true, ...response.data };
    } catch (error) {
      const original = originalHttpError(error);
      const status = (original as { status?: number })?.status;
      const payload = ((
        original as { error?: { message?: string; data?: { missing?: MissingPriceLine[] } } }
      )?.error ?? {}) as { message?: string; data?: { missing?: MissingPriceLine[] } };
      if (status === 409 && payload.message === 'PRICES_MISSING') {
        return { ok: false, code: 'PRICES_MISSING', missing: payload.data?.missing ?? [] };
      }
      if (status === 409 && payload.message === 'STORE_REQUIRED')
        return { ok: false, code: 'STORE_REQUIRED' };
      if (status === 400) return { ok: false, code: 'STALE_LIST' };
      return { ok: false, code: 'ERROR' };
    }
  }

  /**
   * Los productos que la casa ya conoce, con lo que cuesta cada uno en cada tienda. Sirve
   * para las dos cosas que sin esto se hacen a ciegas: enlazar «Leche semi» con la leche a la
   * que ya se puso precio, y saber si los 0,85 € eran de Mercadona o de hace un ano.
   */
  async loadKnownProducts(query = ''): Promise<KnownProduct[]> {
    const contextRevision = this.household.contextRevision();
    try {
      let params = new HttpParams().set('limit', '60');
      if (query.trim()) params = params.set('q', query.trim());
      const response = await firstValue(
        this.http.get<{ data: KnownProduct[] }>(`${this.apiUrl}/prices/products`, { params })
      );
      if (!this.isCurrentContext(contextRevision)) return [];
      this.knownProducts.set(response.data);
      return response.data;
    } catch {
      if (this.isCurrentContext(contextRevision)) this.knownProducts.set([]);
      return [];
    }
  }

  deleteList(id: string): Promise<unknown> {
    return this.request<unknown>(() =>
      this.http.delete(`${this.apiUrl}/lists/${id}`).pipe(tap(() => this.loadLists()))
    );
  }

  // ----------------------------------------------------------------- lineas

  loadList(id: string): void {
    const contextRevision = this.household.contextRevision();
    this.loadingList.set(true);
    this.http
      .get<{ data: ShoppingList & { items?: ShoppingListItem[] } }>(`${this.apiUrl}/lists/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrentContext(contextRevision)) return;
          // El server devuelve la lista CON las lineas dentro: una sola ida por abrir.
          const { items, ...list } = response.data;
          this.list.set(list);
          this.items.set(items ?? []);
          this.loadingList.set(false);
          void this.loadEstimate(id);
        },
        error: () => {
          if (this.isCurrentContext(contextRevision)) this.loadingList.set(false);
        }
      });
  }

  addItem(listId: string, input: CreateItemInput): Promise<ShoppingListItem | null> {
    return this.addItemWithFlag(listId, input).then((result) => result?.item ?? null);
  }

  /** Version cruda: `merged` le interesa a quien pegue una lista, no a la fila. */
  addItemWithFlag(
    listId: string,
    input: CreateItemInput
  ): Promise<{ item: ShoppingListItem; merged: boolean } | null> {
    const body = {
      name: input.name,
      quantity: input.quantity ?? 1,
      unit: input.unit ?? null,
      category: input.category ?? null,
      priceMinor: input.priceMinor ?? null,
      note: input.note ?? null,
      // La oferta y el descuento viajan en el alta: añadir «6 Cervexas 3x2 -10 %» y que la
      // fila nazca sin ninguna de las dos es obligar a entrar en la hoja a parchearla.
      ...(input.offer !== undefined ? { offer: input.offer } : {}),
      ...(input.discount !== undefined ? { discount: input.discount } : {})
    };
    return this.request<{ item: ShoppingListItem; merged: boolean }>(() =>
      this.http
        .post<{ data: ShoppingListItem & { merged: boolean } }>(
          `${this.apiUrl}/lists/${listId}/items`,
          body
        )
        .pipe(
          // `merged` es información del server sobre LO QUE PASO, no un campo de la
          // fila: se separa aqui para que el item que entra en la signal sea la fila.
          map((response) => {
            const { merged, ...item } = response.data;
            return { item, merged };
          }),
          tap(({ item }) => this.pushItem(item))
        )
    );
  }

  /** Pegar una lista entera (el portapapeles del movil) en una sola transaccion. */
  addLines(
    listId: string,
    text: string
  ): Promise<{
    added: number;
    merged: number;
    skipped: { name: string; reason: string }[];
  } | null> {
    return this.request(() =>
      this.http
        .post<{
          data: { added: number; merged: number; skipped: { name: string; reason: string }[] };
        }>(`${this.apiUrl}/lists/${listId}/items/bulk`, { lines: text })
        .pipe(
          map((response) => response.data),
          tap(() => this.loadList(listId))
        )
    );
  }

  /**
   * Autoguardado: pinta el cambio al instante y encola el PATCH. La clave es el item
   * y no el campo, porque teclear «1,9» y despues «5» en el precio es UNA escritura.
   */
  /**
   * Como `updateItem`, pero esperable y sin encolar: el enlace de producto cambia la clave
   * con la que se busca el precio, y si nadie espera, la hoja sigue ensenando el enlace
   * antiguo mientras el server ya ha puesto el nuevo.
   */
  async updateItemSync(
    listId: string,
    item: ShoppingListItem,
    patch: Partial<CreateItemInput>
  ): Promise<ShoppingListItem | null> {
    this.replaceItem({ ...item, ...this.fromPatch(patch, item) } as ShoppingListItem);
    try {
      const next = await firstValue(
        this.track(
          this.http
            .patch<{ data: ShoppingListItem }>(
              `${this.apiUrl}/lists/${listId}/items/${item.id}`,
              patch
            )
            .pipe(map((response) => response.data))
        )
      );
      this.replaceItem(next);
      await this.loadEstimate(listId);
      return next;
    } catch {
      this.loadList(listId);
      return null;
    }
  }

  updateItem(listId: string, item: ShoppingListItem, patch: Partial<CreateItemInput>): void {
    const householdId = this.household.activeHouseholdId();
    this.replaceItem({ ...item, ...this.fromPatch(patch, item) } as ShoppingListItem);
    this.enqueue(
      `item:${item.id}:patch`,
      () =>
        this.http
          .patch<{ data: ShoppingListItem }>(
            `${this.apiUrl}/lists/${listId}/items/${item.id}`,
            patch
          )
          .pipe(
            map((response) => response.data),
            tap((next) => {
              if (this.household.activeHouseholdId() !== householdId) return;
              this.replaceItem(next);
              void this.loadEstimate(listId);
            })
          ),
      householdId
    );
  }

  private fromPatch(
    patch: Partial<CreateItemInput>,
    item?: ShoppingListItem
  ): Partial<ShoppingListItem> {
    return {
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.priceMinor !== undefined ? { price_minor: patch.priceMinor } : {}),
      // El enlace viaja a la vez que el nombre: en dos llamadas, la segunda pisa la clave de
      // la primera y el precio vuelve a perderse, que es el bug que el enlace venia a cerrar.
      ...(patch.productKey !== undefined
        ? { product_key: patch.productKey?.trim() || (item ? productKeyOf(item.name) : undefined) }
        : {}),
      // La oferta optimisticamente: si no, al tocar 3x2 la fila no cambia hasta que
      // conteste el servidor, y el usuario toca otra vez.
      ...(patch.offer !== undefined
        ? { promo_buy: patch.offer?.buy ?? null, promo_take: patch.offer?.take ?? null }
        : {}),
      ...(patch.discount !== undefined
        ? {
            disc_kind: patch.discount?.kind ?? null,
            disc_value_minor:
              patch.discount?.kind === 'amount' ? (patch.discount.valueMinor ?? null) : null,
            disc_percent_bps:
              patch.discount?.kind === 'percent' ? (patch.discount.percentBps ?? null) : null,
            disc_units: patch.discount?.units ?? null
          }
        : {})
    };
  }

  /** Optimista: la casilla se marca al tocar, no cuando conteste el servidor. */
  toggleItem(listId: string, item: ShoppingListItem): void {
    const householdId = this.household.activeHouseholdId();
    const checked = item.checked ? 0 : 1;
    this.replaceItem({ ...item, checked });
    this.enqueue(
      `item:${item.id}:checked`,
      () =>
        this.http
          // `checked` viaja como booleano: la API pinta la columna 0/1 (SQLite) y
          // reenviar el entero leido es la tentacion obvia — el contrato lo acepta
          // desde esta ronda, pero el booleano es el que no se puede leer al reves.
          .patch<{ data: ShoppingListItem }>(`${this.apiUrl}/lists/${listId}/items/${item.id}`, {
            checked: checked === 1
          })
          .pipe(
            map((response) => response.data),
            tap((next) => {
              if (this.household.activeHouseholdId() === householdId) this.replaceItem(next);
            })
          ),
      householdId
    );
  }

  bumpItem(listId: string, item: ShoppingListItem): void {
    const householdId = this.household.activeHouseholdId();
    const quantity = item.quantity + 1;
    this.replaceItem({ ...item, quantity });
    this.enqueue(
      `item:${item.id}:qty`,
      () =>
        this.http
          .patch<{ data: ShoppingListItem }>(`${this.apiUrl}/lists/${listId}/items/${item.id}`, {
            quantity
          })
          .pipe(
            map((response) => response.data),
            tap((next) => {
              if (this.household.activeHouseholdId() !== householdId) return;
              this.replaceItem(next);
              void this.loadEstimate(listId);
            })
          ),
      householdId
    );
  }

  /** Borrado logico: la linea puede volver durante la ventana de deshacer. */
  removeItem(listId: string, item: ShoppingListItem): Promise<boolean> {
    this.items.update((items) => items.filter((candidate) => candidate.id !== item.id));
    return this.request<unknown>(() =>
      this.http
        .delete(`${this.apiUrl}/lists/${listId}/items/${item.id}`)
        .pipe(tap(() => void this.loadEstimate(listId)))
    ).then((result) => result !== null);
  }

  restoreItem(listId: string, itemId: string): Promise<unknown> {
    return this.request<unknown>(() =>
      this.http
        .post(`${this.apiUrl}/lists/${listId}/items/${itemId}/restore`, {})
        .pipe(tap(() => this.loadList(listId)))
    );
  }

  clearChecked(listId: string): Promise<unknown> {
    return this.request<unknown>(() =>
      this.http
        .post<{ data: { removed: number } }>(`${this.apiUrl}/lists/${listId}/clear-checked`, {})
        .pipe(tap(() => this.loadList(listId)))
    );
  }

  /**
   * No hay endpoint de multi-accion en el server, y no lo pedimos: marcar veinte
   * casillas son veinte escrituras conmutativas que entran por la misma cola. La
   * seleccion multiple gana asi su Deshacer linea a linea sin contratos nuevos.
   */
  bulkCheck(listId: string, itemIds: string[], checked: boolean): void {
    for (const id of itemIds) {
      const item = this.items().find((candidate) => candidate.id === id);
      if (!item) continue;
      this.toggleItem(listId, { ...item, checked: checked ? 0 : 1 });
    }
  }

  bulkRemove(listId: string, itemIds: string[]): void {
    for (const id of itemIds) {
      const item = this.items().find((candidate) => candidate.id === id);
      if (item) this.removeItem(listId, item);
    }
  }

  reorder(listId: string, orderedItemIds: string[]): Promise<unknown> {
    return this.request<unknown>(() =>
      this.http
        .put<{ data: unknown }>(`${this.apiUrl}/lists/${listId}/order`, {
          itemIds: orderedItemIds,
          version: this.list()?.version ?? 1
        })
        .pipe(tap(() => this.loadList(listId)))
    );
  }

  // ------------------------------------------------------------ estimacion

  loadEstimate(listId: string): Promise<ListEstimate | null> {
    const contextRevision = this.household.contextRevision();
    return this.request<ListEstimate>(() =>
      this.http.get<{ data: ListEstimate }>(`${this.apiUrl}/lists/${listId}/estimate`).pipe(
        map((response) => response.data),
        tap((estimate) => {
          if (this.isCurrentContext(contextRevision)) this.estimate.set(estimate);
        })
      )
    );
  }

  // --------------------------------------------------------------- precios

  loadPrices(): void {
    const contextRevision = this.household.contextRevision();
    this.http
      .get<{ data: PriceObservation[] }>(`${this.apiUrl}/prices`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.isCurrentContext(contextRevision)) this.prices.set(response.data);
        },
        error: () => {
          if (this.isCurrentContext(contextRevision)) this.prices.set([]);
        }
      });
  }

  /**
   * Las observaciones de precio de UNA clave de producto (## 12ai): la ficha del articulo pinta su
   * historia por tienda, y la historia no cabe en la pagina de siempre. El filtro es por clave exacta
   * —el mismo vocabulario con el que la cesta enlaza lineas— y se bucea hasta agotar las paginas,
   * con el mismo techo de rigor que el visor de la despensa.
   */
  async preciosDeProducto(productKey: string): Promise<PriceObservation[]> {
    const contextRevision = this.household.contextRevision();
    const todas: PriceObservation[] = [];
    const limit = 200;
    for (let pagina = 0; pagina < 10; pagina++) {
      const params = new HttpParams()
        .set('productKey', productKey)
        .set('limit', String(limit))
        .set('offset', String(pagina * limit));
      const response = await firstValueFrom(
        this.http
          .get<{ data: PriceObservation[] }>(`${this.apiUrl}/prices`, { params })
          .pipe(catchError(() => of(null)))
      );
      if (!this.isCurrentContext(contextRevision)) return [];
      const lote = response?.data ?? [];
      todas.push(...lote);
      if (lote.length < limit) break;
    }
    return todas;
  }

  addPrice(input: {
    productName: string;
    priceMinor: number;
    quantity?: number;
    unit?: string | null;
    store?: string | null;
  }): Promise<PriceObservation | null> {
    return this.request<PriceObservation>(() =>
      this.http.post<{ data: PriceObservation }>(`${this.apiUrl}/prices`, input).pipe(
        map((response) => response.data),
        tap(() => this.loadPrices())
      )
    );
  }

  deletePrice(id: string): Promise<unknown> {
    this.prices.update((prices) => prices.filter((price) => price.id !== id));
    return this.request<unknown>(() =>
      this.http.delete(`${this.apiUrl}/prices/${id}`).pipe(tap(() => this.loadPrices()))
    );
  }

  // ---------------------------------------------------------------- infra

  /** Numero de escrituras pendientes de confirmar, para la barra de estado. */
  private track<T>(source: Observable<T>): Observable<T> {
    this.pendingWrites.update((count) => count + 1);
    this.saving.set(true);
    return source.pipe(
      finalize(() => {
        const left = Math.max(0, this.pendingWrites() - 1);
        this.pendingWrites.set(left);
        this.saving.set(left > 0);
      })
    );
  }

  private clearHouseholdScopedState(): void {
    this.lists.set([]);
    this.list.set(null);
    this.items.set([]);
    this.estimate.set(null);
    this.prices.set([]);
    this.knownProducts.set([]);
    this.loadingLists.set(false);
    this.loadingList.set(false);
    this.saving.set(false);
    this.pendingWrites.set(0);
    this.listsMeta.set({ total: 0, limit: 25, offset: 0 });
    this.stores.set([]);
    this.sugerencia.set(null);
    this.cargandoSugerencia.set(false);
    this.categories.set([]);
    this.categoriesLoaded = false;
    this.events.set([]);
  }

  private isCurrentContext(revision: number): boolean {
    return revision === this.household.contextRevision();
  }

  /**
   * Encola en vez de perder la escritura. La clave evita el acoso: tocar cuatro
   * veces la casilla de una linea es una intencion, no cuatro peticiones.
   */
  private enqueue(
    key: string,
    send: () => Observable<unknown>,
    householdId = this.household.activeHouseholdId()
  ): void {
    const scopedKey = `${householdId ?? 'personal'}:${key}`;
    const existing = this.queue.findIndex((entry) => entry.key === scopedKey);
    const entry: QueuedWrite = { key: scopedKey, householdId, send: () => this.track(send()) };
    if (existing === -1) this.queue.push(entry);
    else this.queue[existing] = entry;
    void this.flush();
  }

  private flushing = false;

  private async flush(): Promise<void> {
    if (this.flushing || this.pausedAfterNetworkError) return;
    this.flushing = true;
    let observedOnlineEvent = this.onlineEventVersion;
    try {
      while (this.queue.length > 0) {
        const activeHouseholdId = this.household.activeHouseholdId();
        const queueIndex = this.queue.findIndex((entry) => entry.householdId === activeHouseholdId);
        if (queueIndex === -1) break;
        const entry = this.queue[queueIndex];
        const attemptRevision = this.household.contextRevision();
        const discardEntry = (): void => {
          const currentIndex = this.queue.indexOf(entry);
          if (currentIndex !== -1) this.queue.splice(currentIndex, 1);
        };
        try {
          await firstValue(entry.send());
          discardEntry();
        } catch (error) {
          // Si la selección cambió mientras el envío estaba en vuelo, su resultado no prueba
          // que la escritura se aceptara en el hogar de origen. Se conserva para reintentar allí.
          if (this.household.contextRevision() !== attemptRevision) continue;
          // Error de negocio (4xx): reintentar no lo arregla, se descarta y se avisa.
          if (isConflict(error)) {
            discardEntry();
            this.toast.warning(
              this.i18n.t('ui.la_lista_cambio_en'),
              this.i18n.t('ui.se_han_vuelto_a')
            );
            const listId = this.list()?.id;
            if (listId) this.loadList(listId);
            continue;
          }
          if (isNetworkError(error)) {
            // Si `online` llego mientras la request seguia pendiente, damos un unico
            // reintento porque el evento pudo preceder a la respuesta de red fallida.
            if (this.onlineEventVersion > observedOnlineEvent) {
              observedOnlineEvent = this.onlineEventVersion;
              continue;
            }
            // Conserva la escritura, pero no la reenvia en un bucle ni ante otro cambio
            // local hasta que el navegador confirme que vuelve la conexion.
            this.pausedAfterNetworkError = true;
            break;
          }
          discardEntry();
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Petición corta: se espera, se propaga el fallo al llamador y ya. */
  /** Respuestas del server, sin reintentos: un 4xx de datos se reenvia tal cual. */
  private async request<T>(factory: () => Observable<T>, reportFailure = false): Promise<T | null> {
    try {
      return await firstValue(this.track(factory()));
    } catch (error) {
      const failure = reportFailure ? originalHttpError(error) : error;
      if (isConflict(failure)) {
        const listId = this.list()?.id;
        this.toast.warning(
          this.i18n.t('ui.la_lista_cambio_en'),
          listId ? this.i18n.t('ui.se_han_vuelto_a') : undefined
        );
        if (listId) this.loadList(listId);
      } else if (isNetworkError(failure)) {
        this.toast.warning(
          this.i18n.t('ui.sin_conexion'),
          this.i18n.t('ui.el_cambio_se_reintentara')
        );
      } else if (failure instanceof HttpErrorResponse && failure.status !== 0) {
        const message =
          failure.status === 503 ? this.i18n.t('ui.servicio_no_disponible') : errorMessage(failure);
        this.toast.error(this.i18n.t('ui.no_se_ha_podido'), message);
      }
      return null;
    }
  }

  private pushItem(item: ShoppingListItem): void {
    this.items.update((items) =>
      items.some((candidate) => candidate.id === item.id)
        ? items.map((candidate) => (candidate.id === item.id ? item : candidate))
        : [...items, item]
    );
    void this.loadEstimate(item.list_id);
  }

  private replaceItem(next: ShoppingListItem): void {
    if (!next?.id) return;
    this.items.update((items) =>
      items.map((item) => (item.id === next.id ? { ...item, ...next } : item))
    );
  }
}

function firstValue<T>(source: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const subscription = source.subscribe({
      next: (value) => {
        settled = true;
        resolve(value);
        setTimeout(() => subscription.unsubscribe(), 0);
      },
      error: (error) => {
        if (!settled) reject(error);
      },
      complete: () => {
        if (!settled) reject(new Error('respuesta vacia'));
      }
    });
  });
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 409 || error.error?.code === 'LIST_VERSION_CONFLICT')
  );
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 0 || error.status === 502 || error.status === 504)
  );
}

function errorMessage(error: HttpErrorResponse): string {
  const message = error.error?.message;
  return typeof message === 'string' && message ? message : `Error ${error.status}`;
}
