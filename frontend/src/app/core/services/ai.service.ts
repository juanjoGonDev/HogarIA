import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, tap, map, catchError, of, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import {
  AIProviderConfig,
  AiFunctionKey,
  AiFunctionProviderAssignment,
  AIRecipeRequest,
  AIRecipeImproveRequest,
  AIRecipeImproveResponse,
  AIRecipeResponse,
  AITestConnectionResponse,
  AIReplacementCandidate,
  AIReplacementGuest
} from '../../shared/models/ai-config.model';

export interface AITestConnectionAccepted {
  status: 'testing';
  configId: string;
}

export type AITestConnectionOutcome = AITestConnectionResponse | AITestConnectionAccepted;

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private readonly apiUrl = `${environment.apiUrl}/ai`;
  private http = inject(HttpClient);
  private configLoadGeneration = 0;

  // Signals
  private configsSignal = signal<AIProviderConfig[]>([]);
  private configsLoadingSignal = signal(false);
  private configsErrorSignal = signal(false);
  private isGeneratingSignal = signal(false);
  private isImprovingRecipeSignal = signal(false);
  private generatedRecipeSignal = signal<AIRecipeResponse | null>(null);
  private generatedRecipesSignal = signal<AIRecipeResponse[]>([]);
  private functionProvidersSignal = signal<AiFunctionProviderAssignment[]>([]);
  private functionAssignmentGeneration = new Map<AiFunctionKey, number>();

  readonly configs = this.configsSignal.asReadonly();
  readonly configsLoading = this.configsLoadingSignal.asReadonly();
  readonly configsError = this.configsErrorSignal.asReadonly();
  readonly isGenerating = this.isGeneratingSignal.asReadonly();
  readonly isImprovingRecipe = this.isImprovingRecipeSignal.asReadonly();
  readonly generatedRecipe = this.generatedRecipeSignal.asReadonly();
  readonly generatedRecipes = this.generatedRecipesSignal.asReadonly();
  readonly functionProviders = this.functionProvidersSignal.asReadonly();

  // ═══════════════════════════════════════════════════════════════
  // Configurations
  // ═══════════════════════════════════════════════════════════════

  loadConfigs(): void {
    this.loadConfigsSnapshot().subscribe();
  }

  loadFunctionProviders(): void {
    this.loadFunctionProvidersSnapshot().subscribe();
  }

  loadFunctionProvidersSnapshot(): Observable<AiFunctionProviderAssignment[] | null> {
    return this.http
      .get<{ data?: AiFunctionProviderAssignment[] }>(`${this.apiUrl}/function-providers`, {
        context: this.silentContext()
      })
      .pipe(
        map((response) => (Array.isArray(response?.data) ? response.data : [])),
        tap((assignments) => {
          this.functionProvidersSignal.set(assignments);
          this.syncConfigAssignments(assignments);
        }),
        catchError(() => of(null))
      );
  }

  assignFunctionProvider(
    functionKey: AiFunctionKey,
    configId: string | null
  ): Observable<AiFunctionProviderAssignment | null> {
    const generation = (this.functionAssignmentGeneration.get(functionKey) ?? 0) + 1;
    this.functionAssignmentGeneration.set(functionKey, generation);
    return this.http
      .put<{ data?: AiFunctionProviderAssignment }>(
        `${this.apiUrl}/function-providers/${functionKey}`,
        { configId },
        { context: this.silentContext() }
      )
      .pipe(
        map((response) => response?.data ?? null),
        tap((assignment) => {
          if (!assignment || this.functionAssignmentGeneration.get(functionKey) !== generation)
            return;
          this.functionProvidersSignal.update((items) => [
            ...items.filter((item) => item.functionKey !== functionKey),
            assignment
          ]);
          this.syncConfigAssignments(this.functionProvidersSignal());
        }),
        catchError(() => of(null))
      );
  }

  /** Return the scoped provider list to callers that must sequence work after its authorization. */
  loadConfigsSnapshot(): Observable<AIProviderConfig[] | null> {
    const generation = ++this.configLoadGeneration;
    this.configsLoadingSignal.set(true);
    this.configsErrorSignal.set(false);
    return this.http
      .get<{ data?: AIProviderConfig[] }>(`${this.apiUrl}/configs`, {
        context: this.silentContext()
      })
      .pipe(
        map((response) => (Array.isArray(response?.data) ? response.data : [])),
        tap((configs) => {
          if (generation === this.configLoadGeneration) {
            this.configsSignal.set(configs);
          }
        }),
        catchError(() => {
          if (generation === this.configLoadGeneration) {
            this.configsErrorSignal.set(true);
          }
          return of(null);
        }),
        finalize(() => {
          if (generation === this.configLoadGeneration) {
            this.configsLoadingSignal.set(false);
          }
        })
      );
  }

  createConfig(config: Partial<AIProviderConfig>): Observable<AIProviderConfig | null> {
    return this.http
      .post<any>(`${this.apiUrl}/configs`, config, { context: this.silentContext() })
      .pipe(
        map((response) => response?.data ?? null),
        tap((created) => {
          if (created) {
            this.invalidateConfigLoads();
            this.configsSignal.update((list) => [...list, created]);
          }
        })
      );
  }

  updateConfig(id: string, config: Partial<AIProviderConfig>): Observable<AIProviderConfig | null> {
    return this.http
      .patch<any>(`${this.apiUrl}/configs/${id}`, config, { context: this.silentContext() })
      .pipe(
        map((response) => response?.data ?? null),
        tap((updated) => {
          if (!updated) return;
          this.invalidateConfigLoads();
          this.configsSignal.update((list) =>
            list.map((current) => (current.id === id ? updated : current))
          );
        })
      );
  }

  deleteConfig(id: string): Observable<boolean> {
    return this.http
      .delete<any>(`${this.apiUrl}/configs/${id}`, { context: this.silentContext() })
      .pipe(
        tap(() => {
          this.invalidateConfigLoads();
          this.configsSignal.update((list) => list.filter((c) => c.id !== id));
        }),
        map(() => true),
        catchError(() => of(false))
      );
  }

  /**
   * La prueba de conexion (## 8f, revisada): contra una config guardada (`configId`) o contra
   * los datos del formulario tal cual (baseUrl+apiKey+model), que es lo que permite probar
   * ANTES de guardar. El veredicto llega con la respuesta —hasta entonces no hay nada que
   * ensenar, y mucho menos un aviso de exito.
   */
  testConnection(params: {
    configId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeout?: number;
  }): Observable<AITestConnectionOutcome | null> {
    return this.http
      .post<any>(`${this.apiUrl}/test-connection`, params, { context: this.silentContext() })
      .pipe(map((response) => (response as { data?: AITestConnectionOutcome })?.data ?? null));
  }

  // ═══════════════════════════════════════════════════════════════
  // Recipe Generation
  // ═══════════════════════════════════════════════════════════════

  generateRecipe(request: AIRecipeRequest): Observable<AIRecipeResponse | null> {
    this.isGeneratingSignal.set(true);

    return this.http
      .post<{ data?: AIRecipeResponse | null }>(`${this.apiUrl}/generate-recipe`, request, {
        context: this.silentContext()
      })
      .pipe(
        map((response) => response?.data ?? null),
        tap((recipe) => {
          if (recipe) {
            this.generatedRecipeSignal.set(recipe);
            this.generatedRecipesSignal.set([]);
          }
        }),
        catchError(() => of(null)),
        finalize(() => this.isGeneratingSignal.set(false))
      );
  }

  generateMultipleRecipes(request: AIRecipeRequest): Observable<AIRecipeResponse[] | null> {
    this.isGeneratingSignal.set(true);

    return this.http
      .post<{ data?: AIRecipeResponse[] | null }>(
        `${this.apiUrl}/generate-multiple-recipes`,
        request,
        { context: this.silentContext() }
      )
      .pipe(
        map((response) => (Array.isArray(response?.data) ? response.data : [])),
        tap((recipes) => {
          if (recipes.length > 0) {
            this.generatedRecipeSignal.set(null);
            this.generatedRecipesSignal.set(recipes);
          }
        }),
        catchError(() => of(null)),
        finalize(() => this.isGeneratingSignal.set(false))
      );
  }

  improveRecipe(request: AIRecipeImproveRequest): Observable<AIRecipeImproveResponse | null> {
    this.isImprovingRecipeSignal.set(true);

    return this.http
      .post<{ data?: AIRecipeImproveResponse | null }>(`${this.apiUrl}/improve-recipe`, request, {
        context: this.silentContext()
      })
      .pipe(
        map((response) => response?.data ?? null),
        catchError(() => of(null)),
        finalize(() => this.isImprovingRecipeSignal.set(false))
      );
  }

  getRecommendations(params: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/recommendations`, params);
  }

  generateWeeklyPlan(params: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/plan-week`, params);
  }

  replaceMeal(request: {
    mealId: string;
    guests?: AIReplacementGuest[];
    householdMemberIds?: string[];
    goals?: { types: string[]; caloriesTarget?: number; customInstructions?: string };
  }): Observable<AIReplacementCandidate | null> {
    return this.http
      .post<{ data?: AIReplacementCandidate }>(`${this.apiUrl}/replace-meal`, request, {
        context: this.silentContext()
      })
      .pipe(
        map((response) => response?.data ?? null),
        catchError(() => of(null))
      );
  }

  clearGenerated(): void {
    this.generatedRecipeSignal.set(null);
    this.generatedRecipesSignal.set([]);
  }

  private silentContext(): HttpContext {
    return new HttpContext().set(SILENT_TOAST, true);
  }

  private invalidateConfigLoads(): void {
    this.configLoadGeneration += 1;
    this.configsLoadingSignal.set(false);
  }

  private syncConfigAssignments(assignments: AiFunctionProviderAssignment[]): void {
    const byConfig = new Map<string, AiFunctionKey[]>();
    for (const assignment of assignments) {
      if (!assignment.configId) continue;
      byConfig.set(assignment.configId, [
        ...(byConfig.get(assignment.configId) ?? []),
        assignment.functionKey
      ]);
    }
    this.configsSignal.update((configs) =>
      configs.map((config) => ({ ...config, assignedFunctions: byConfig.get(config.id) ?? [] }))
    );
  }
}
