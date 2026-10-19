import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, tap, catchError, map, of, switchMap, finalize, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Household,
  HouseholdMembership,
  InvitePreview,
  MemberPermissions,
  MemberRole
} from '../../shared/models/household.model';
import { STORAGE_KEYS } from './storage.service';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private readonly apiUrl = `${environment.apiUrl}/household`;
  private http = inject(HttpClient);

  private householdSignal = signal<Household | null>(null);
  private membershipsSignal = signal<HouseholdMembership[]>([]);
  private activeHouseholdIdSignal = signal<string | null>(null);
  private contextRevisionSignal = signal(0);
  private membershipsLoadingSignal = signal(false);
  private membershipsLoadedSignal = signal(false);
  private membershipsFailedSignal = signal(false);
  private switchingHouseholdSignal = signal(false);
  private isLoadingSignal = signal(false);
  private failedSignal = signal(false);
  /** Si la casa ya se pidio y la respuesta fue buena, incluso cuando la respuesta fue «no tienes casa». */
  private askedSignal = signal(false);

  readonly household = this.householdSignal.asReadonly();
  readonly memberships = this.membershipsSignal.asReadonly();
  readonly activeHouseholdId = this.activeHouseholdIdSignal.asReadonly();
  readonly contextRevision = this.contextRevisionSignal.asReadonly();
  readonly membershipsLoading = this.membershipsLoadingSignal.asReadonly();
  readonly membershipsLoaded = this.membershipsLoadedSignal.asReadonly();
  readonly membershipsFailed = this.membershipsFailedSignal.asReadonly();
  readonly switchingHousehold = this.switchingHouseholdSignal.asReadonly();
  readonly isLoading = this.isLoadingSignal.asReadonly();

  /** Default rations are the active members in the selected home, with a personal fallback. */
  defaultServings(): number {
    const activeMembers =
      this.householdSignal()?.members.filter((member) => member.isActive).length ?? 0;
    return activeMembers > 0 ? activeMembers : 2;
  }

  private membershipRequestId = 0;
  private membershipLoadInFlight: {
    requestId: number;
    revision: number;
    userId: string | null;
    observable: Observable<HouseholdMembership[]>;
  } | null = null;
  private membershipValidationForNavigation: {
    navigationId: number;
    revision: number;
    userId: string | null;
  } | null = null;
  private householdRequestId = 0;

  /**
   * Carga la casa si aun no la tenemos, y solo una vez.
   *
   * Existe porque `loadHousehold()` se llamaba desde el login, el registro, el dashboard y la pagina de
   * la casa: cualquiera que abriera /calendar directamente (o recargara ahi) no tenia casa en memoria, y
   * eso convertia «invitar a alguien» en un control que simplemente no estaba. Cada pantalla que
   * necesita la casa tiene que poder pedirla sin saber que la pidio otra.
   *
   * Si la peticiona fallo se permite reintentar la proxima vez: un `attempted` a secas dejaria la
   * pantalla sin casa para siempre despues de un 401 o un modo avion.
   */
  ensureHousehold(): void {
    // Ya la tenemos, o esta pidiendose: en los dos casos no hay nada que hacer. El `askedSignal` existe
    // porque «no tienes casa» TAMBIEN es una respuesta buena: sin el, cada visita al calendario
    // volveria a preguntar por una casa que no existe.
    if (this.householdSignal() || this.isLoadingSignal() || this.askedSignal()) return;
    // Un fallo anterior no es una condena: se limpia la marca y se reintenta. Sin esto, un 401 durante
    // el arranque dejaba la pantalla sin casa (y sin boton de invitar) hasta recargar.
    this.failedSignal.set(false);
    this.loadHousehold();
  }

  loadHousehold(): void {
    this.requestHousehold(this.contextRevisionSignal()).subscribe();
  }

  /** Lista las casas propias y adopta únicamente la selección validada por el servidor. */
  loadMemberships(forceRefresh = false): Observable<HouseholdMembership[]> {
    const revision = this.contextRevisionSignal();
    const userId = this.currentUserId();
    const pending = this.membershipLoadInFlight;
    if (!forceRefresh && pending && pending.revision === revision && pending.userId === userId) {
      return pending.observable;
    }

    const requestId = ++this.membershipRequestId;
    this.membershipsLoadingSignal.set(true);

    let request$: Observable<HouseholdMembership[]>;
    request$ = this.http.get<any>(`${this.apiUrl}/memberships`).pipe(
      map((response) => {
        const data = response?.data;
        const memberships = Array.isArray(data?.memberships)
          ? data.memberships.map((item: any) => this.mapMembership(item))
          : [];
        const serverActiveId =
          typeof data?.activeHouseholdId === 'string' ? data.activeHouseholdId : null;
        const activeId = memberships.some((item: HouseholdMembership) => item.id === serverActiveId)
          ? serverActiveId
          : null;

        if (requestId === this.membershipRequestId && revision === this.contextRevisionSignal()) {
          const previousId = this.activeHouseholdIdSignal();
          this.membershipsSignal.set(
            memberships.map((item: HouseholdMembership) => ({
              ...item,
              active: item.id === activeId
            }))
          );
          this.activeHouseholdIdSignal.set(activeId);
          if (
            previousId !== activeId ||
            (this.householdSignal() && this.householdSignal()?.id !== activeId)
          ) {
            this.advanceContextRevision();
            this.householdRequestId += 1;
            this.isLoadingSignal.set(false);
            this.householdSignal.set(null);
            this.askedSignal.set(false);
          }
          this.membershipsFailedSignal.set(false);
          this.membershipsLoadedSignal.set(true);
        }
        return memberships;
      }),
      catchError(() => {
        if (requestId === this.membershipRequestId && revision === this.contextRevisionSignal()) {
          this.membershipsFailedSignal.set(true);
          this.membershipsLoadedSignal.set(false);
          this.membershipsSignal.set([]);
          this.activeHouseholdIdSignal.set(null);
          this.householdRequestId += 1;
          this.isLoadingSignal.set(false);
          this.householdSignal.set(null);
          this.askedSignal.set(false);
          this.advanceContextRevision();
        }
        return of([] as HouseholdMembership[]);
      }),
      finalize(() => {
        if (requestId === this.membershipRequestId) this.membershipsLoadingSignal.set(false);
        if (this.membershipLoadInFlight?.requestId === requestId) {
          this.membershipLoadInFlight = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.membershipLoadInFlight = { requestId, revision, userId, observable: request$ };
    return request$;
  }

  /** Validate at most once per protected navigation, even across nested lazy routes. */
  loadMembershipsForNavigation(navigationId: number | null): Observable<HouseholdMembership[]> {
    const revision = this.contextRevisionSignal();
    const userId = this.currentUserId();
    const validation = this.membershipValidationForNavigation;
    if (
      navigationId !== null &&
      validation?.navigationId === navigationId &&
      validation.revision === revision &&
      validation.userId === userId
    ) {
      return of(this.membershipsSignal());
    }

    return this.loadMemberships().pipe(
      tap(() => {
        if (navigationId !== null && userId === this.currentUserId()) {
          this.membershipValidationForNavigation = {
            navigationId,
            revision: this.contextRevisionSignal(),
            userId
          };
        }
      })
    );
  }

  /** Reuse memberships validated for the current navigation unless an explicit refresh is needed. */
  ensureMemberships(forceRefresh = false): Observable<HouseholdMembership[]> {
    if (!forceRefresh && this.membershipsLoadedSignal()) return of(this.membershipsSignal());
    return this.loadMemberships(forceRefresh);
  }

  /** Pide al servidor cambiar el contexto y solo después carga los datos de esa casa. */
  selectActiveHousehold(householdId: string): Observable<boolean> {
    const requestedId = typeof householdId === 'string' ? householdId.trim() : '';
    if (!requestedId || this.switchingHouseholdSignal()) return of(false);

    this.switchingHouseholdSignal.set(true);
    const revision = this.advanceContextRevision();
    // Mientras se valida el cambio no se debe dejar visible un hogar cuyo contexto ya está obsoleto.
    this.householdSignal.set(null);
    this.askedSignal.set(false);

    return this.http.post<any>(`${this.apiUrl}/active`, { householdId: requestedId }).pipe(
      switchMap((response) => {
        if (response?.data?.activeHouseholdId !== requestedId) {
          return this.reconcileHouseholdContext(revision).pipe(map(() => false));
        }
        this.setActiveHousehold(requestedId);
        return this.requestHousehold(revision);
      }),
      catchError(() => {
        return this.reconcileHouseholdContext(revision).pipe(map(() => false));
      }),
      finalize(() => this.switchingHouseholdSignal.set(false))
    );
  }

  /** Fetch public info about an invite code (no auth needed on backend, but we have cookie/token anyway). */
  previewInvite(code: string): Observable<InvitePreview | null> {
    return this.http.get<any>(`${this.apiUrl}/invite/${code}`).pipe(
      map((response) => response?.data ?? null),
      catchError(() => of(null))
    );
  }

  /** Join household by invite code (for already-logged-in users). */
  joinByCode(code: string, options: { silentToast?: boolean } = {}): Observable<any> {
    const requestOptions = options.silentToast ? { context: this.silentToastContext() } : {};
    return this.http.post<any>(`${this.apiUrl}/join/${code}`, {}, requestOptions).pipe(
      switchMap((response) => this.refreshMembershipAndHousehold().pipe(map(() => response))),
      catchError((err) => {
        throw err;
      })
    );
  }

  createHousehold(name: string, sharedPantry = true): Observable<Household | null> {
    return this.http
      .post<any>(this.apiUrl, { name, sharedPantry }, { context: this.silentToastContext() })
      .pipe(
        map((response) => (response?.data ? this.mapHousehold(response.data) : null)),
        switchMap((household) => (household ? this.activateCreatedHousehold(household) : of(null))),
        catchError(() => of(null))
      );
  }

  joinHousehold(inviteCode: string): Observable<any> {
    return this.http
      .post<any>(`${this.apiUrl}/join`, { inviteCode }, { context: this.silentToastContext() })
      .pipe(
        switchMap((response) => this.refreshMembershipAndHousehold().pipe(map(() => response))),
        catchError(() => of(null))
      );
  }

  updateSettings(data: {
    name?: string;
    sharedPantry?: boolean;
    shareRecipes?: boolean;
    shareCalendar?: boolean;
  }): Observable<Household | null> {
    return this.http.patch<any>(this.apiUrl, data, { context: this.silentToastContext() }).pipe(
      map((response) => (response?.data ? this.mapHousehold(response.data) : null)),
      tap((household) => {
        this.householdSignal.set(household);
      }),
      catchError(() => of(null))
    );
  }

  setMemberActive(memberId: string, memberActive: boolean): Observable<Household | null> {
    return this.http
      .patch<any>(this.apiUrl, { memberId, memberActive }, { context: this.silentToastContext() })
      .pipe(
        map((response) => (response?.data ? this.mapHousehold(response.data) : null)),
        tap((household) => {
          if (household) this.householdSignal.set(household);
        }),
        catchError(() => of(null))
      );
  }

  updateMemberAccess(
    memberId: string,
    memberRole: MemberRole,
    memberPermissions: MemberPermissions
  ): Observable<Household | null> {
    return this.http
      .patch<any>(
        this.apiUrl,
        { memberId, memberRole, memberPermissions },
        { context: this.silentToastContext() }
      )
      .pipe(
        map((response) => (response?.data ? this.mapHousehold(response.data) : null)),
        tap((household) => {
          if (household) this.householdSignal.set(household);
        }),
        catchError(() => of(null))
      );
  }

  regenerateInviteCode(): Observable<string | null> {
    return this.http
      .post<any>(`${this.apiUrl}/regenerate-invite`, {}, { context: this.silentToastContext() })
      .pipe(
        map((response) => response?.data?.inviteCode ?? null),
        tap((inviteCode) => {
          if (inviteCode) {
            this.householdSignal.update((h) => (h ? { ...h, inviteCode } : null));
          }
        }),
        catchError(() => of(null))
      );
  }

  leaveHousehold(): Observable<boolean> {
    return this.http
      .delete<any>(`${this.apiUrl}/leave`, { context: this.silentToastContext() })
      .pipe(
        tap(() => {
          this.householdSignal.set(null);
        }),
        map(() => true),
        catchError(() => of(false))
      );
  }

  copyInviteCode(): void {
    const code = this.householdSignal()?.inviteCode;
    if (code) {
      const url = `${window.location.origin}/invite/${code}`;
      navigator.clipboard.writeText(url);
    }
  }

  getInviteLink(code?: string): string {
    const c = code ?? this.householdSignal()?.inviteCode;
    return `${window.location.origin}/invite/${c}`;
  }

  isAdmin(): boolean {
    return this.householdSignal()?.myRole === 'admin';
  }

  /** Map snake_case DB row to camelCase Household. */
  private mapHousehold(raw: any): Household {
    const me = raw.members?.find((m: any) => m.userId === this.currentUserId()) || raw.members?.[0];
    return {
      id: raw.id,
      name: raw.name,
      inviteCode: raw.inviteCode,
      members: (raw.members || []).map((m: any) => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        email: m.email,
        avatar: m.avatar ?? undefined,
        role: m.role,
        cookingLevel: m.cookingLevel,
        joinedAt: m.joinedAt,
        isActive: m.isActive !== false,
        permissions: m.permissions
      })),
      sharedPantry: !!raw.sharedPantry,
      shareRecipes: raw.shareRecipes !== false,
      shareCalendar: raw.shareCalendar !== false,
      myRole: me?.role,
      myPermissions: me?.permissions,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }

  private mapMembership(raw: any): HouseholdMembership {
    return {
      id: String(raw?.id ?? ''),
      name: String(raw?.name ?? ''),
      role: raw?.role as MemberRole,
      permissions: raw?.permissions as MemberPermissions,
      active: raw?.active === true
    };
  }

  private requestHousehold(revision: number): Observable<boolean> {
    const requestId = ++this.householdRequestId;
    this.isLoadingSignal.set(true);

    return this.http.get<any>(this.apiUrl).pipe(
      map((response) => {
        const isCurrent =
          revision === this.contextRevisionSignal() && requestId === this.householdRequestId;
        const household = response?.data ? this.mapHousehold(response.data) : null;
        const householdMatchesSelection =
          !household ||
          !this.activeHouseholdIdSignal() ||
          household.id === this.activeHouseholdIdSignal();
        if (isCurrent) {
          // A delayed response must not replace the selected context with another home's data.
          if (!householdMatchesSelection) {
            this.householdSignal.set(null);
            this.failedSignal.set(true);
          } else {
            this.householdSignal.set(household);
            this.failedSignal.set(false);
          }
          this.isLoadingSignal.set(false);
          this.askedSignal.set(true);
        }
        return isCurrent && householdMatchesSelection;
      }),
      catchError(() => {
        if (revision === this.contextRevisionSignal() && requestId === this.householdRequestId) {
          this.isLoadingSignal.set(false);
          this.failedSignal.set(true);
        }
        return of(false);
      })
    );
  }

  private setActiveHousehold(householdId: string | null): void {
    this.activeHouseholdIdSignal.set(householdId);
    this.membershipsSignal.update((memberships) =>
      memberships.map((membership) => ({ ...membership, active: membership.id === householdId }))
    );
  }

  private advanceContextRevision(): number {
    this.contextRevisionSignal.update((revision) => revision + 1);
    return this.contextRevisionSignal();
  }

  private reconcileHouseholdContext(revision: number): Observable<boolean> {
    if (revision !== this.contextRevisionSignal()) return of(false);
    this.activeHouseholdIdSignal.set(null);
    this.membershipsSignal.update((memberships) =>
      memberships.map((membership) => ({ ...membership, active: false }))
    );
    this.householdSignal.set(null);
    this.askedSignal.set(false);

    return this.loadMemberships(true).pipe(
      switchMap(() => {
        if (this.membershipsFailedSignal()) return of(false);
        return this.requestHousehold(this.contextRevisionSignal());
      })
    );
  }

  private refreshMembershipAndHousehold(): Observable<boolean> {
    this.householdSignal.set(null);
    this.askedSignal.set(false);
    return this.loadMemberships(true).pipe(
      switchMap(() => {
        if (this.membershipsFailedSignal()) return of(false);
        return this.requestHousehold(this.contextRevisionSignal());
      })
    );
  }

  private activateCreatedHousehold(household: Household): Observable<Household | null> {
    this.advanceContextRevision();
    this.setActiveHousehold(household.id);
    this.householdSignal.set(household);
    this.askedSignal.set(true);
    return this.loadMemberships(true).pipe(
      map(() => {
        if (
          this.membershipsFailedSignal() ||
          this.activeHouseholdIdSignal() !== household.id ||
          this.householdSignal()?.id !== household.id
        ) {
          this.householdSignal.set(null);
          this.askedSignal.set(false);
          return null;
        }
        return this.householdSignal();
      })
    );
  }

  private currentUserId(): string | null {
    try {
      // Read from localStorage without importing AuthService to avoid circular imports.
      const user = localStorage.getItem(STORAGE_KEYS.currentUser);
      return user ? JSON.parse(user).id : null;
    } catch {
      return null;
    }
  }

  private silentToastContext(): HttpContext {
    return new HttpContext().set(SILENT_TOAST, true);
  }
}
