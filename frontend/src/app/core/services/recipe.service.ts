import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams, HttpContext } from '@angular/common/http';
import { Observable, tap, catchError, map, of, shareReplay, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Recipe, RecipeFilter, RecipeUpdateInput } from '../../shared/models/recipe.model';
import { RecipeStepPhoto, RecipeStepPhotoScene } from '../../shared/models/recipe-step-photo';
import {
  RecipeStepVideoCandidate,
  RecipeStepVideoScene
} from '../../shared/models/recipe-step-video';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { LatestRequest } from '../utils/latest-request';

function normalizeRecipe(recipe: Recipe): Recipe {
  type ApiStep = NonNullable<Recipe['steps']>[number] & {
    videoAttribution?: Omit<RecipeStepVideoCandidate, 'id'> | null;
  };
  const normalizeStep = (step: ApiStep): NonNullable<Recipe['steps']>[number] => {
    const { videoAttribution, ...normalized } = step;
    const video =
      step.video ??
      (step.videoId && videoAttribution ? { id: step.videoId, ...videoAttribution } : undefined);
    return { ...normalized, ...(video ? { video } : {}) };
  };
  const steps = Array.isArray(recipe.steps)
    ? recipe.steps.map((step) => normalizeStep(step as ApiStep))
    : recipe.steps;
  const instructionsByLevel = recipe.instructionsByLevel
    ? (Object.fromEntries(
        Object.entries(recipe.instructionsByLevel).map(([level, levelSteps]) => [
          level,
          Array.isArray(levelSteps)
            ? levelSteps.map((step) => normalizeStep(step as ApiStep))
            : levelSteps
        ])
      ) as Recipe['instructionsByLevel'])
    : recipe.instructionsByLevel;
  const normalizedRecipe = {
    ...recipe,
    ...(steps ? { steps } : {}),
    ...(instructionsByLevel ? { instructionsByLevel } : {})
  };
  if (normalizedRecipe.image != null) return normalizedRecipe;
  const { image: _missingImage, ...withoutImage } = normalizedRecipe;
  return withoutImage;
}

@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  private readonly apiUrl = `${environment.apiUrl}/recipes`;
  private http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stepPhotoSearchRequests = new Map<
    RecipeStepPhotoScene,
    Observable<RecipeStepPhoto | null>
  >();
  private readonly stepVideoSearchRequests = new Map<
    RecipeStepVideoScene,
    Observable<RecipeStepVideoCandidate[]>
  >();
  private readonly stepPhotoImageRequests = new Map<string, Observable<string>>();
  private readonly stepPhotoObjectUrls = new Map<string, string>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const url of this.stepPhotoObjectUrls.values()) URL.revokeObjectURL(url);
      this.stepPhotoObjectUrls.clear();
    });
  }

  // Signals
  private recipesSignal = signal<Recipe[]>([]);
  private currentRecipeSignal = signal<Recipe | null>(null);
  private isLoadingSignal = signal(false);
  private recipesLoadErrorSignal = signal(false);
  private totalSignal = signal(0);
  private currentFilter: RecipeFilter | undefined;
  private retryFilter: RecipeFilter | undefined;
  private readonly listRequests = new LatestRequest();

  readonly recipes = this.recipesSignal.asReadonly();
  readonly currentRecipe = this.currentRecipeSignal.asReadonly();
  readonly isLoading = this.isLoadingSignal.asReadonly();
  readonly recipesLoadError = this.recipesLoadErrorSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();

  searchStepPhoto(scene: RecipeStepPhotoScene): Observable<RecipeStepPhoto | null> {
    const cached = this.stepPhotoSearchRequests.get(scene);
    if (cached) return cached;

    let request$: Observable<RecipeStepPhoto | null>;
    request$ = this.http
      .get<{ data: RecipeStepPhoto | null }>(`${this.apiUrl}/step-photos`, {
        params: { scene }
      })
      .pipe(
        map((response) => response.data ?? null),
        catchError((error) => {
          if (this.stepPhotoSearchRequests.get(scene) === request$) {
            this.stepPhotoSearchRequests.delete(scene);
          }
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    this.stepPhotoSearchRequests.set(scene, request$);
    return request$;
  }

  retryStepPhoto(scene: RecipeStepPhotoScene): Observable<RecipeStepPhoto | null> {
    this.stepPhotoSearchRequests.delete(scene);
    return this.searchStepPhoto(scene);
  }

  searchStepVideos(scene: RecipeStepVideoScene): Observable<RecipeStepVideoCandidate[]> {
    const cached = this.stepVideoSearchRequests.get(scene);
    if (cached) return cached;

    let request$: Observable<RecipeStepVideoCandidate[]>;
    request$ = this.http
      .get<{ data?: RecipeStepVideoCandidate[] }>(`${this.apiUrl}/step-videos/search`, {
        params: { scene },
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        map((response) => (Array.isArray(response?.data) ? response.data.slice(0, 5) : [])),
        catchError((error) => {
          if (this.stepVideoSearchRequests.get(scene) === request$) {
            this.stepVideoSearchRequests.delete(scene);
          }
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    this.stepVideoSearchRequests.set(scene, request$);
    return request$;
  }

  retryStepVideos(scene: RecipeStepVideoScene): Observable<RecipeStepVideoCandidate[]> {
    this.stepVideoSearchRequests.delete(scene);
    return this.searchStepVideos(scene);
  }

  prepareStepVideoPlayback(recipeId: string, videoId: string): Observable<boolean> {
    return this.http
      .post<{ success?: boolean }>(
        `${this.apiUrl}/${encodeURIComponent(recipeId)}/step-videos/${encodeURIComponent(videoId)}/playback`,
        {},
        {
          withCredentials: true,
          context: new HttpContext().set(SILENT_TOAST, true)
        }
      )
      .pipe(
        map((response) => response?.success === true),
        catchError(() => of(false))
      );
  }

  stepVideoStreamUrl(recipeId: string, videoId: string): string {
    return `${this.apiUrl}/${encodeURIComponent(recipeId)}/step-videos/${encodeURIComponent(videoId)}/stream`;
  }

  searchRecipePhotos(query: string): Observable<RecipeStepPhoto[]> {
    return this.http
      .get<{ data?: RecipeStepPhoto[] }>(`${this.apiUrl}/step-photos/search`, {
        params: { q: query },
        // The editor owns an accessible empty/error/retry state for this optional search.
        // A global toast on top of that inline message duplicates the same failure.
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(map((response) => (Array.isArray(response?.data) ? response.data : [])));
  }

  loadStepPhotoImage(id: string): Observable<string> {
    const cached = this.stepPhotoImageRequests.get(id);
    if (cached) return cached;

    let request$: Observable<string>;
    request$ = this.http
      .get(`${this.apiUrl}/step-photos/${encodeURIComponent(id)}/image`, {
        responseType: 'blob'
      })
      .pipe(
        map((blob) => {
          if (
            blob.size === 0 ||
            blob.size > 4 * 1024 * 1024 ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type.toLowerCase())
          ) {
            throw new Error('Invalid step photo image');
          }
          const objectUrl = URL.createObjectURL(blob);
          this.stepPhotoObjectUrls.set(id, objectUrl);
          this.pruneStepPhotoImageCache();
          return objectUrl;
        }),
        catchError((error) => {
          if (this.stepPhotoImageRequests.get(id) === request$) {
            this.stepPhotoImageRequests.delete(id);
          }
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    this.stepPhotoImageRequests.set(id, request$);
    return request$;
  }

  forgetStepPhotoImage(id: string): void {
    this.stepPhotoImageRequests.delete(id);
    const objectUrl = this.stepPhotoObjectUrls.get(id);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    this.stepPhotoObjectUrls.delete(id);
  }

  private pruneStepPhotoImageCache(): void {
    while (this.stepPhotoObjectUrls.size > 8) {
      const oldestId = this.stepPhotoObjectUrls.keys().next().value;
      if (!oldestId) return;
      this.forgetStepPhotoImage(oldestId);
    }
  }

  loadRecipes(filter?: RecipeFilter): void {
    const requestId = this.listRequests.begin();
    this.retryFilter = filter;
    this.isLoadingSignal.set(true);
    this.recipesLoadErrorSignal.set(false);

    let params = new HttpParams();
    if (filter?.search) params = params.set('search', filter.search);
    if (filter?.difficulty) params = params.set('difficulty', filter.difficulty);
    if (filter?.mealType) params = params.set('mealType', filter.mealType);
    if (filter?.mealTypes?.length) params = params.set('mealTypes', filter.mealTypes.join(','));
    if (filter?.maxTime) params = params.set('maxTime', filter.maxTime.toString());
    if (filter?.cuisine) params = params.set('cuisine', filter.cuisine);
    if (filter?.countryCode) params = params.set('countryCode', filter.countryCode);
    if (filter?.tags?.length) params = params.set('tags', filter.tags.join(','));
    if (filter?.isFavorite) params = params.set('isFavorite', 'true');
    if (filter?.author) params = params.set('author', filter.author);
    if (filter?.catalogOnly) params = params.set('catalogOnly', 'true');
    if (filter?.page) params = params.set('page', filter.page.toString());
    if (filter?.pageSize) params = params.set('pageSize', filter.pageSize.toString());
    if (filter?.sortBy) params = params.set('sortBy', filter.sortBy);
    if (filter?.sortOrder) params = params.set('sortOrder', filter.sortOrder);

    this.http
      .get<any>(this.apiUrl, {
        params,
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        tap((response) => {
          if (!this.listRequests.isCurrent(requestId)) return;
          this.currentFilter = filter;
          this.retryFilter = filter;
          this.recipesSignal.set(response.data.recipes.map(normalizeRecipe));
          this.totalSignal.set(response.data.total);
          this.isLoadingSignal.set(false);
        }),
        catchError(() => {
          if (this.listRequests.isCurrent(requestId)) {
            this.recipesLoadErrorSignal.set(true);
            this.isLoadingSignal.set(false);
          }
          return of(null);
        })
      )
      .subscribe();
  }

  retryLoadRecipes(): void {
    this.loadRecipes(this.retryFilter);
  }

  getRecipe(id: string): Observable<Recipe | null> {
    return this.http.get<{ data: Recipe }>(`${this.apiUrl}/${id}`).pipe(
      map((response) => normalizeRecipe(response.data)),
      tap((recipe) => this.currentRecipeSignal.set(recipe)),
      catchError(() => of(null))
    );
  }

  createRecipe(recipe: Partial<Recipe> | RecipeUpdateInput): Observable<Recipe | null> {
    return this.http.post<{ data: Recipe }>(this.apiUrl, recipe).pipe(
      map((response) => normalizeRecipe(response.data)),
      tap((created) => {
        this.recipesLoadErrorSignal.set(false);
        this.recipesSignal.update((list) => [created, ...list]);
      }),
      catchError(() => of(null))
    );
  }

  updateRecipe(id: string, recipe: RecipeUpdateInput): Observable<Recipe> {
    return this.http
      .patch<{ data: Recipe }>(`${this.apiUrl}/${encodeURIComponent(id)}`, recipe)
      .pipe(
        map((response) => normalizeRecipe(response.data)),
        tap((updated) => {
          this.currentRecipeSignal.set(updated);
          this.recipesSignal.update((recipes) =>
            recipes.map((current) => (current.id === id ? updated : current))
          );
        })
      );
  }

  toggleFavorite(id: string): void {
    this.http
      .post<any>(`${this.apiUrl}/${id}/favorite`, {})
      .pipe(
        tap((response) => {
          const isFavorite = response.data.isFavorite;
          if (this.currentFilter?.isFavorite && !isFavorite) {
            const current = this.recipesSignal();
            const remaining = current.filter((recipe) => recipe.id !== id);
            this.recipesSignal.set(remaining);
            if (remaining.length < current.length) {
              this.totalSignal.update((total) => Math.max(0, total - 1));
            }
            return;
          }

          this.recipesSignal.update((list) =>
            list.map((r) => (r.id === id ? { ...r, isFavorite } : r))
          );
        }),
        catchError(() => of(null))
      )
      .subscribe();
  }

  recordCooking(id: string): Observable<boolean> {
    return this.http
      .post<{ success?: boolean }>(
        `${this.apiUrl}/${id}/cook`,
        {},
        {
          context: new HttpContext().set(SILENT_TOAST, true)
        }
      )
      .pipe(
        map((response) => response?.success === true),
        tap((recorded) => {
          if (!recorded) return;
          this.recipesSignal.update((list) =>
            list.map((r) => (r.id === id ? { ...r, timesCooked: r.timesCooked + 1 } : r))
          );
        }),
        catchError(() => of(false))
      );
  }

  adjustServings(id: string, servings: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${id}/adjust-servings`, { servings });
  }

  deleteRecipe(id: string): Observable<boolean> {
    return this.http.delete<unknown>(`${this.apiUrl}/${id}`).pipe(
      map(() => true),
      tap(() => {
        this.recipesSignal.update((list) => list.filter((r) => r.id !== id));
      }),
      catchError(() => of(false))
    );
  }
}
