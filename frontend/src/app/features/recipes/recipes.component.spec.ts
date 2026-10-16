import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, type ParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { RecipesComponent } from './recipes.component';
import { RecipeService } from '../../core/services/recipe.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdService } from '../../core/services/household.service';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { AiService } from '../../core/services/ai.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import type { Recipe } from '../../shared/models/recipe.model';
import type { AIRecipeResponse } from '../../shared/models/ai-config.model';
import type { HomeProfile } from '../../shared/models/home-profile';

const RECIPE: Recipe = {
  id: 'synthetic-recipe',
  name: 'Sopa sintética',
  description: 'Receta de prueba',
  difficulty: 'medium',
  cuisine: 'casera',
  countryCode: 'ES',
  mealType: ['dinner'],
  totalTime: 35,
  prepTime: 10,
  cookTime: 25,
  servings: 4,
  calories: 320,
  ingredients: [],
  utensils: [],
  steps: [{ stepNumber: 1, instruction: 'Preparar los ingredientes' }],
  author: 'catalog',
  timesCooked: 0,
  tags: ['casera'],
  isFavorite: false,
  isPublic: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z')
};

const GENERATED: AIRecipeResponse = {
  name: 'Guiso sintético',
  description: 'Borrador local',
  difficulty: 'medium',
  cuisine: 'casera',
  totalTime: 45,
  prepTime: 15,
  cookTime: 30,
  restTime: 0,
  baseServings: 1,
  calories: 410,
  ingredients: [
    {
      name: 'Tomate',
      quantity: 2,
      unit: 'unit',
      preparation: 'troceado',
      isOptional: false,
      substitutes: ['tomate en conserva'],
      notes: 'maduro'
    }
  ],
  utensils: ['cazuela'],
  guidance: {
    appliances: ['fogón'],
    parallelTasks: ['Lavar la tabla'],
    tipsAndVariations: ['Añadir perejil'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Cocinar',
        duration: 10,
        temperature: null,
        timerRequired: true,
        timerDuration: 10,
        tips: 'Remover',
        warning: null,
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Cocinar removiendo',
        duration: 10,
        temperature: null,
        timerRequired: true,
        timerDuration: 10,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Cocinar hasta el punto deseado',
        duration: 10,
        temperature: null,
        timerRequired: true,
        timerDuration: 10,
        tips: null,
        warning: null,
        illustration: null
      }
    ]
  },
  tags: ['guiso'],
  nutrition: { calories: 410, protein: 12, carbs: 50, fat: 14, fiber: 6 },
  storage: {
    method: 'frigorífico',
    duration: '2 días',
    reheatingInstructions: null,
    container: 'recipiente',
    freezingPossible: true,
    freezingDuration: null
  }
};

describe('RecipesComponent', () => {
  let fixture: ComponentFixture<RecipesComponent>;
  let component: RecipesComponent;
  let queryParams: BehaviorSubject<ParamMap>;
  let fragment: BehaviorSubject<string | null>;
  let route: {
    queryParamMap: BehaviorSubject<ParamMap>;
    fragment: BehaviorSubject<string | null>;
    snapshot: { fragment: string | null; queryParamMap: ParamMap };
  };
  let router: jasmine.SpyObj<Router>;
  let recipes: ReturnType<typeof createRecipeService>;
  let ai: ReturnType<typeof createAiService>;
  let pantry: ReturnType<typeof createPantryService>;
  let household: ReturnType<typeof createHouseholdService>;
  let toast: jasmine.SpyObj<ToastService>;
  let authUserId: string | null;
  let authCurrentUser: any;
  let authUpdateProfile: jasmine.Spy;
  let cookingProfile: WritableSignal<HomeProfile>;

  function createRecipeService() {
    return {
      recipes: signal<Recipe[]>([]),
      total: signal(0),
      isLoading: signal(false),
      recipesLoadError: signal(false),
      loadRecipes: jasmine.createSpy('loadRecipes'),
      getRecipe: jasmine.createSpy('getRecipe').and.returnValue(of(null)),
      createRecipe: jasmine.createSpy('createRecipe').and.returnValue(of(RECIPE)),
      toggleFavorite: jasmine.createSpy('toggleFavorite'),
      recordCooking: jasmine.createSpy('recordCooking').and.returnValue(of(true))
    };
  }

  function createAiService() {
    return {
      generatedRecipe: signal<AIRecipeResponse | null>(null),
      generatedRecipes: signal<AIRecipeResponse[]>([]),
      clearGenerated: jasmine.createSpy('clearGenerated'),
      generateRecipe: jasmine.createSpy('generateRecipe').and.returnValue(of(GENERATED)),
      generateMultipleRecipes: jasmine
        .createSpy('generateMultipleRecipes')
        .and.returnValue(of([GENERATED, GENERATED]))
    };
  }

  function createPantryService() {
    const ingredients = signal([
      { id: 'tomato', name: 'Tomate', quantity: 2, unit: 'unit', category: 'vegetables' },
      { id: 'rice', name: 'Arroz', quantity: 300, unit: 'g', category: 'grains' }
    ]);
    const categories: Record<string, { name: string; position: number }> = {
      vegetables: { name: 'Verduras', position: 1 },
      grains: { name: 'Cereales', position: 2 }
    };
    return {
      ingredients,
      loadIngredients: jasmine.createSpy('loadIngredients'),
      loadCategories: jasmine.createSpy('loadCategories'),
      categoryByKey: jasmine
        .createSpy('categoryByKey')
        .and.callFake((key: string) => categories[key])
    };
  }

  function createHouseholdService() {
    return {
      activeHouseholdId: signal<string | null>(null),
      household: signal<any>(null),
      defaultServings: jasmine.createSpy('defaultServings').and.returnValue(2),
      ensureHousehold: jasmine.createSpy('ensureHousehold')
    };
  }

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({}));
    fragment = new BehaviorSubject<string | null>(null);
    route = {
      queryParamMap: queryParams,
      fragment,
      snapshot: { fragment: null, queryParamMap: convertToParamMap({}) }
    };
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    recipes = createRecipeService();
    ai = createAiService();
    pantry = createPantryService();
    household = createHouseholdService();
    cookingProfile = signal({ cookingLevel: 'intermediate', modules: [] });
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    authUserId = 'synthetic-user';
    authCurrentUser = signal({
      id: authUserId,
      preferences: {
        theme: 'system',
        language: 'es',
        detailLevel: 'intermediate',
        notifications: {
          expirationAlerts: true,
          mealReminders: true,
          recipeSuggestions: true
        },
        recipeViewMode: 'grid'
      }
    });
    authUpdateProfile = jasmine.createSpy('updateProfile').and.callFake((patch: any) => {
      const user = {
        ...authCurrentUser(),
        preferences: { ...authCurrentUser().preferences, ...patch.preferences }
      };
      authCurrentUser.set(user);
      return of(user);
    });

    await TestBed.configureTestingModule({
      imports: [RecipesComponent],
      providers: [
        { provide: RecipeService, useValue: recipes },
        {
          provide: AuthService,
          useValue: {
            userId: () => authUserId,
            currentUser: authCurrentUser,
            updateProfile: authUpdateProfile
          }
        },
        { provide: HouseholdService, useValue: household },
        {
          provide: TasteProfileService,
          useValue: {
            profile: cookingProfile,
            ensureLoaded: jasmine.createSpy('ensureLoaded')
          }
        },
        { provide: AiService, useValue: ai },
        { provide: PantryService, useValue: pantry },
        { provide: ToastService, useValue: toast },
        {
          provide: I18nService,
          useValue: {
            t: (key: string) => key,
            plural: (n: number, one: string, many: string) => (n === 1 ? one : many)
          }
        },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router }
      ]
    })
      .overrideComponent(RecipesComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(RecipesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads dependencies and builds a normalized catalog filter from route state', () => {
    queryParams.next(
      convertToParamMap({
        collection: 'book',
        search: '  pupusa  ',
        country: 'sv',
        mealType: 'dessert',
        cuisine: ' salvadoreña ',
        tags: 'maíz,  tradicional ',
        difficulty: 'easy',
        maxTime: '45',
        author: 'ai',
        page: '2',
        pageSize: '120'
      })
    );

    expect(pantry.loadIngredients).toHaveBeenCalled();
    expect(household.ensureHousehold).toHaveBeenCalled();
    expect(recipes.loadRecipes).toHaveBeenCalledWith({
      page: 2,
      pageSize: 100,
      search: 'pupusa',
      countryCode: 'SV',
      mealType: 'dessert',
      cuisine: 'salvadoreña',
      tags: ['maíz', 'tradicional'],
      difficulty: 'easy',
      maxTime: 45,
      author: 'ai',
      catalogOnly: true
    });
    expect(component.collection()).toBe('book');
    expect(component.page()).toBe(2);
    expect(component.activeFilter()).toBe('ai');

    queryParams.next(convertToParamMap({ maxTime: '30' }));
    expect(component.activeFilter()).toBe('quick');
    expect(recipes.loadRecipes).toHaveBeenCalledWith({ page: 1, pageSize: 9, maxTime: 30 });
    queryParams.next(convertToParamMap({ author: 'user' }));
    expect(component.activeFilter()).toBe('');
    queryParams.next(convertToParamMap({ collection: 'book' }));
    expect(component.page()).toBe(1);
    expect(recipes.loadRecipes).toHaveBeenCalledWith({ page: 1, pageSize: 9, catalogOnly: true });
  });

  it('restores and saves the list/grid preference on the signed-in user', () => {
    expect(component.viewMode()).toBe('grid');

    component.setViewMode('list');

    expect(component.viewMode()).toBe('list');
    expect(authUpdateProfile).toHaveBeenCalledWith({
      preferences: jasmine.objectContaining({ recipeViewMode: 'list' })
    });
    expect(authCurrentUser().preferences.recipeViewMode).toBe('list');
  });

  it('navigates to the dedicated manual recipe creation form', () => {
    component.createManualRecipe();

    expect(router.navigate).toHaveBeenCalledWith(['/recipes', 'new']);
  });

  it('ignores malformed query values and maps quick filters and favorites to the URL', () => {
    queryParams.next(
      convertToParamMap({
        countryCode: 'SV',
        mealType: 'invalid',
        difficulty: 'medium',
        maxTime: '9999999999999999999',
        isFavorite: '1',
        page: '0',
        pageSize: '0'
      })
    );
    expect(recipes.loadRecipes).toHaveBeenCalledWith({
      page: 1,
      pageSize: 9,
      countryCode: 'SV',
      difficulty: 'medium',
      isFavorite: true
    });
    expect(component.activeFilter()).toBe('favorites');

    component.setFilter('quick');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: { isFavorite: null, author: null, maxTime: '30', page: null }
      })
    );
    component.setFilter('ai');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: { isFavorite: null, author: 'ai', maxTime: null, page: null }
      })
    );
    component.setFilter('');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: { isFavorite: null, author: null, maxTime: null, page: null }
      })
    );
  });

  it('keeps book filters in the URL, rejects invalid pages, and clears every filter alias', () => {
    component.setCollection('book');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { collection: 'book', page: null, pageSize: null } })
    );
    component.setCollection('all');
    component.searchInput.set('  tortilla  ');
    component.applySearch();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { search: 'tortilla', page: null } })
    );
    component.setViewMode('grid');
    expect(component.viewMode()).toBe('grid');
    component.setViewMode('list');
    expect(component.viewMode()).toBe('list');
    component.setViewMode('grid');
    recipes.total.set(18);
    component.page.set(1);
    expect(component.pageCount()).toBe(2);
    component.changePage(0);
    component.changePage(3);
    expect(router.navigate).toHaveBeenCalledTimes(3);
    component.changePage(2);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { page: '2' } })
    );
    component.clearFilters();
    expect(component.searchInput()).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({
          country: null,
          countryCode: null,
          mealTypes: null,
          tags: null,
          page: null
        })
      })
    );
  });

  it('returns to the last valid page when a refreshed result total shrinks', () => {
    recipes.total.set(25);
    recipes.loadRecipes.and.callFake(() => recipes.isLoading.set(true));

    queryParams.next(convertToParamMap({ page: '2' }));
    expect(component.page()).toBe(2);
    expect(recipes.loadRecipes).toHaveBeenCalledWith(jasmine.objectContaining({ page: 2 }));

    recipes.total.set(7);
    recipes.isLoading.set(false);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: jasmine.objectContaining({ page: '1' }) })
    );
  });

  it('applies draft filters and reports active filter states and localized labels', () => {
    expect(component.hasActiveFilters()).toBeFalse();
    component.searchInput.set(' search ');
    expect(component.hasActiveFilters()).toBeTrue();
    component.searchInput.set('');
    const state = component as any;
    state.country.set('ES');
    expect(component.hasActiveFilters()).toBeTrue();
    state.country.set(null);
    state.mealType.set('lunch');
    expect(component.hasActiveFilters()).toBeTrue();
    state.mealType.set(null);
    state.cuisine.set('casera');
    expect(component.hasActiveFilters()).toBeTrue();
    state.cuisine.set('');
    state.tags.set(['casera']);
    expect(component.hasActiveFilters()).toBeTrue();
    state.tags.set([]);
    state.difficulty.set('easy');
    expect(component.hasActiveFilters()).toBeTrue();
    state.difficulty.set(null);
    state.maxTime.set(30);
    expect(component.hasActiveFilters()).toBeTrue();
    state.maxTime.set(null);
    component.activeFilter.set('favorites');
    expect(component.hasActiveFilters()).toBeTrue();
    component.activeFilter.set('');
    component.openFilterModal();
    expect(component.isFilterModalOpen()).toBeTrue();
    component.draftCountry.set('ES');
    component.draftMealType.set('lunch');
    component.draftCuisine.set(' valenciana ');
    component.draftTags.set('arroz,  tradicional');
    component.draftDifficulty.set('hard');
    component.draftMaxTime.set(35);
    component.applyFilters();
    expect(component.isFilterModalOpen()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({
          country: 'ES',
          countryCode: null,
          mealType: 'lunch',
          cuisine: 'valenciana',
          tags: 'arroz,  tradicional',
          difficulty: 'hard',
          maxTime: '35'
        })
      })
    );
    component.draftMaxTime.set(0);
    component.applyFilters();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: jasmine.objectContaining({ maxTime: null }) })
    );
    component.closeFilterModal();
    expect(component.countryLabel('ES')).toBe('recipes.book.country_es');
    expect(component.countryLabel('SV')).toBe('recipes.book.country_sv');
    expect(component.countryLabel('XX')).toBe('XX');
    expect(component.mealTypeLabel('brunch')).toBe('recipes.book.meal_brunch');
    expect(component.mealTypeLabel('dessert')).toBe('recipes.book.meal_dessert');
  });

  it('validates media URLs, scales quantities and formats recipe metadata', () => {
    expect(
      component.recipeImageUrl({ ...RECIPE, image: '/api/recipe-images/0123456789abcdef01234567' })
    ).toBe('/api/recipe-images/0123456789abcdef01234567');
    expect(
      component.recipeImageUrl({ ...RECIPE, image: 'https://images.example.test/dish.jpg' })
    ).toBe('https://images.example.test/dish.jpg');
    for (const image of [
      'http://images.example.test/dish.jpg',
      'javascript:alert(1)',
      'https://user:pass@images.example.test/dish.jpg',
      '/api/recipe-images/not-an-id'
    ]) {
      expect(component.recipeImageUrl({ ...RECIPE, image })).toBeNull();
    }
    expect(
      component.attributionUrl({
        ...RECIPE,
        sourceAttribution: {
          publisher: 'Fuente',
          title: 'Ficha',
          url: 'https://example.test',
          note: ''
        }
      })
    ).toBe('https://example.test/');
    expect(
      component.attributionUrl({
        ...RECIPE,
        sourceAttribution: { publisher: 'Fuente', title: 'Ficha', url: 'javascript:bad', note: '' }
      })
    ).toBeNull();
    expect(component.displayedRecipeCalories(RECIPE)).toBe(320);
    expect(
      component.displayedRecipeCalories({
        ...RECIPE,
        calories: null,
        nutrition: { calories: 280, protein: 10, carbs: 20, fat: 5 }
      })
    ).toBe(280);
    expect(
      component.displayedRecipeCalories({ ...RECIPE, calories: null, nutrition: undefined })
    ).toBeNull();
    component.setRecipeServings(6);
    expect(component.scaledIngredientQuantity(RECIPE, 200)).toBe(300);
    component.setRecipeServings(0);
    expect(component.recipeServings()).toBe(6);
    component.setRecipeServings('2.5');
    expect(component.recipeServings()).toBe(6);
    expect(component.scaledIngredientQuantity({ ...RECIPE, servings: 0 }, 200)).toBe(600);
    expect(component.getDifficultyVariant('easy')).toBe('success');
    expect(component.getDifficultyVariant('hard')).toBe('error');
    expect(component.getDifficultyVariant('medium')).toBe('warning');
    expect(component.getDifficultyVariant('unknown')).toBe('warning');
    expect(component.trackById(0, RECIPE)).toBe(RECIPE.id);
  });

  it('manages selected recipe permissions, detail levels, servings, favorites, and cooking', () => {
    const owned = { ...RECIPE, author: 'user' as const, authorId: 'synthetic-user' };
    expect(component.canEditRecipe(owned)).toBeTrue();
    expect(component.canEditRecipe(RECIPE)).toBeFalse();
    expect(component.canEditRecipe({ ...owned, authorId: 'someone-else' })).toBeFalse();
    component.editRecipe(RECIPE);
    expect(router.navigate).not.toHaveBeenCalledWith(['/recipes', RECIPE.id, 'edit']);
    component.editRecipe(owned);
    expect(router.navigate).toHaveBeenCalledWith(['/recipes', RECIPE.id, 'edit']);
    authUserId = null;
    expect(component.canEditRecipe(owned)).toBeFalse();
    authUserId = 'synthetic-user';

    recipes.getRecipe.and.returnValue(of(owned));
    component.viewRecipe(owned);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { recipe: owned.id } })
    );
    component.selectedRecipe.set(owned);
    component.setSelectedRecipeDetailLevel('expert');
    component.setRecipeServings('5');
    expect(component.selectedRecipeDetailLevel()).toBe('expert');
    expect(component.recipeServings()).toBe(5);
    expect(component.getRecipeSteps(owned, 'basic')).toEqual(owned.steps ?? []);
    component.toggleFavorite(owned);
    component.cookRecipe(owned);
    expect(recipes.toggleFavorite).toHaveBeenCalledWith(owned.id);
    expect(recipes.recordCooking).toHaveBeenCalledWith(owned.id);
    expect(toast.success).toHaveBeenCalledWith(
      'recipes.a_cocinar',
      'recipes.disfruta_preparando_tu_receta'
    );
    component.closeRecipeDetail();
    expect(component.selectedRecipe()).toBeNull();
    route.snapshot.queryParamMap = convertToParamMap({});
    component.closeRecipeDetail();
    expect(router.navigate).not.toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { recipe: null } })
    );
  });

  it('defaults each recipe to the current profile level and remembers explicit per-recipe choices', () => {
    cookingProfile.set({ cookingLevel: 'expert', modules: [] });
    const firstRecipe = { ...RECIPE, id: 'recipe-a' };
    const secondRecipe = { ...RECIPE, id: 'recipe-b' };
    recipes.getRecipe.and.returnValue(of(firstRecipe));

    queryParams.next(convertToParamMap({ recipe: firstRecipe.id }));
    expect(component.selectedRecipeDetailLevel()).toBe('expert');

    component.setSelectedRecipeDetailLevel('basic');
    recipes.getRecipe.and.returnValue(of(secondRecipe));
    queryParams.next(convertToParamMap({ recipe: secondRecipe.id }));
    expect(component.selectedRecipeDetailLevel()).toBe('expert');

    recipes.getRecipe.and.returnValue(of(firstRecipe));
    queryParams.next(convertToParamMap({ recipe: firstRecipe.id }));
    expect(component.selectedRecipeDetailLevel()).toBe('basic');
  });

  it('defaults saved recipe servings to the household count instead of its base yield', () => {
    household.defaultServings.and.returnValue(3);
    recipes.getRecipe.and.returnValue(of(RECIPE));

    queryParams.next(convertToParamMap({ recipe: RECIPE.id }));

    expect(component.recipeServings()).toBe(3);
    component.setRecipeServings(5);
    expect(component.recipeServings()).toBe(5);
  });

  it('tracks household loading until servings are edited, then preserves the explicit value', () => {
    household.defaultServings.and.callFake(() => {
      const activeMembers =
        household.household()?.members.filter((member: { isActive: boolean }) => member.isActive)
          .length ?? 0;
      return activeMembers || 2;
    });
    recipes.getRecipe.and.returnValue(of(RECIPE));
    queryParams.next(convertToParamMap({ recipe: RECIPE.id }));
    expect(component.recipeServings()).toBe(2);

    household.household.set({
      id: 'home-a',
      members: [
        { id: 'active-a', isActive: true },
        { id: 'active-b', isActive: true },
        { id: 'inactive', isActive: false }
      ]
    });
    fixture.detectChanges();
    expect(component.recipeServings()).toBe(2);

    component.setRecipeServings(5);
    household.household.set({
      id: 'home-b',
      members: [
        { id: 'active-a', isActive: true },
        { id: 'active-b', isActive: true },
        { id: 'active-c', isActive: true }
      ]
    });
    fixture.detectChanges();
    expect(component.recipeServings()).toBe(5);
  });

  it('uses the profile cooking level as the untouched AI-generation default', () => {
    cookingProfile.set({ cookingLevel: 'expert', modules: [] });
    fixture.detectChanges();
    component.openAiModal();
    expect(component.aiOptions.detailLevel).toBe('expert');

    cookingProfile.set({ cookingLevel: 'intermediate', modules: [] });
    fixture.detectChanges();
    expect(component.aiOptions.detailLevel).toBe('intermediate');

    component.setAiDetailLevel('basic');
    cookingProfile.set({ cookingLevel: 'expert', modules: [] });
    fixture.detectChanges();
    expect(component.aiOptions.detailLevel).toBe('basic');

    component.closeAiModal();
    component.openAiModal();
    fixture.detectChanges();
    expect(component.aiOptions.detailLevel).toBe('expert');
  });

  it('waits for cooking confirmation, rejects duplicate clicks, and keeps retry available', () => {
    const owned = { ...RECIPE, author: 'user' as const, authorId: 'synthetic-user' };
    const pending = new Subject<boolean>();
    recipes.recordCooking.and.returnValues(pending.asObservable(), of(true));
    component.selectedRecipe.set(owned);

    component.cookRecipe(owned);
    component.cookRecipe(owned);

    expect(recipes.recordCooking).toHaveBeenCalledTimes(1);
    expect(component.cookingRecipeId()).toBe(owned.id);
    expect(component.selectedRecipe()).toEqual(owned);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    pending.next(false);
    pending.complete();

    expect(component.cookingRecipeId()).toBeNull();
    expect(component.selectedRecipe()).toEqual(owned);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'recipes.no_se_pudo_registrar_cocina');

    component.cookRecipe(owned);

    expect(recipes.recordCooking).toHaveBeenCalledTimes(2);
    expect(component.cookingRecipeId()).toBeNull();
    expect(component.selectedRecipe()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      'recipes.a_cocinar',
      'recipes.disfruta_preparando_tu_receta'
    );
  });

  it('handles URL-driven recipe and AI details, including missing recipes', () => {
    recipes.getRecipe.and.returnValue(of(RECIPE));
    queryParams.next(convertToParamMap({ recipe: RECIPE.id }));
    expect(recipes.getRecipe).toHaveBeenCalledWith(RECIPE.id);
    expect(component.selectedRecipe()).toEqual(RECIPE);
    expect(component.recipeServings()).toBe(2);

    fragment.next('ai');
    expect(component.isAiModalOpen()).toBeTrue();
    recipes.getRecipe.and.returnValue(of(null));
    queryParams.next(convertToParamMap({ recipe: 'missing' }));
    expect(component.selectedRecipe()).toBeNull();

    route.snapshot.queryParamMap = convertToParamMap({ recipe: RECIPE.id });
    component.closeRecipeDetail();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { recipe: null }, replaceUrl: true })
    );
    route.snapshot.fragment = 'ai';
    component.closeAiModal();
    expect(ai.clearGenerated).toHaveBeenCalled();
    component.closeAiModal();
    expect(component.isAiModalOpen()).toBeFalse();
    fragment.next(null);
    component.selectedRecipe.set(RECIPE);
    queryParams.next(convertToParamMap({}));
    expect(component.selectedRecipe()).toBeNull();
  });

  it('builds pantry categories, filters ingredients and maintains the full selection', () => {
    const categories = component.recipeIngredientCategoryOptions();
    expect(categories.map((category) => category.key)).toEqual(['vegetables', 'grains']);
    expect(component.trackRecipeIngredientCategory(0, categories[0])).toBe('vegetables');
    component.setRecipeIngredientCategory('vegetables');
    expect(component.visibleRecipeIngredients().map((ingredient) => ingredient.id)).toEqual([
      'tomato'
    ]);
    component.setRecipeIngredientCategory('all');
    component.toggleIngredientSelection(pantry.ingredients()[0]);
    component.toggleIngredientSelection(pantry.ingredients()[0]);
    component.selectAllRecipeIngredients();
    expect(component.selectedIngredients().map((ingredient) => ingredient.id)).toEqual([
      'tomato',
      'rice'
    ]);
    expect(component.isIngredientSelected('rice')).toBeTrue();
    component.removeIngredient(pantry.ingredients()[0]);
    expect(component.selectedIngredients().map((ingredient) => ingredient.id)).toEqual(['rice']);
    component.clearRecipeIngredients();
    expect(component.selectedIngredients()).toEqual([]);
    component.setRecipeAiStep(10);
    expect(component.aiGenerationStep()).toBe(3);
    component.setRecipeAiStep(0);
    expect(component.aiGenerationStep()).toBe(1);
    component.setRecipeAiStep(1);
    expect(component.aiGenerationStep()).toBe(1);

    pantry.ingredients.set([
      ...pantry.ingredients(),
      { id: 'pantry', name: 'Legumbre', quantity: 1, unit: 'g', category: 'canned-goods' }
    ]);
    pantry.categoryByKey.and.returnValue(undefined);
    const fallback = component
      .recipeIngredientCategoryOptions()
      .find((option) => option.key === 'canned-goods');
    expect(fallback?.label).toBe('Canned Goods');
  });

  it('resets the AI wizard and switches generated previews between form and options', () => {
    component.openAiModal();
    expect(component.isAiModalOpen()).toBeTrue();
    expect(component.aiGenerationStep()).toBe(1);
    expect(component.recipeIngredientCategory()).toBe('all');
    expect(pantry.loadCategories).toHaveBeenCalled();
    expect(ai.clearGenerated).toHaveBeenCalled();
    expect(component.aiPreviewModalSize()).toBe('lg');
    ai.generatedRecipes.set([GENERATED, GENERATED]);
    expect(component.hasGeneratedRecipePreview()).toBeTrue();
    expect(component.aiPreviewModalSize()).toBe('full');
    expect(component.generatedPreviewRecipe()).toBeNull();
    expect(component.isAiFormVisible()).toBeFalse();
    component.viewGeneratedOption(99);
    expect(component.selectedGeneratedOptionIndex()).toBeNull();
    component.viewGeneratedOption(1);
    expect(component.generatedPreviewRecipe()).toBe(GENERATED);
    component.setGeneratedPreviewDetailLevel('expert');
    expect(component.generatedPreviewDetailLevel()).toBe('expert');
    component.toggleAiFormExpanded();
    expect(component.isAiFormVisible()).toBeTrue();
    component.returnToGeneratedOptions();
    expect(component.selectedGeneratedOptionIndex()).toBeNull();
    component.discardGeneratedPreviews();
    expect(ai.clearGenerated).toHaveBeenCalledTimes(2);
    ai.generatedRecipe.set(GENERATED);
    expect(component.generatedPreviewRecipe()).toBe(GENERATED);
    component.setGeneratedPreviewDetailLevel('basic');
    expect(component.singleGeneratedDetailLevel()).toBe('basic');
    component.closeAiModal();
    expect(component.isAiModalOpen()).toBeFalse();
    expect(component.recipeGuests()).toEqual([]);
    component.closeAiModal();
  });

  it('uses only active members from the matching household and keeps touched servings', () => {
    household.activeHouseholdId.set('home-a');
    household.household.set({
      id: 'home-a',
      members: [
        { id: 'member-active', isActive: true },
        { id: 'member-inactive', isActive: false }
      ]
    });
    component.openAiModal();
    fixture.detectChanges();
    expect(component.recipeMemberIds()).toEqual(['member-active']);
    expect(component.aiOptions.servings).toBe(1);
    component.recipeGuests.set([
      { allergies: [], intolerances: [], diets: [], likes: ['picante'], dislikes: [], notes: '' }
    ]);

    household.activeHouseholdId.set('home-b');
    fixture.detectChanges();
    expect(component.recipeMemberIds()).toEqual([]);
    expect(component.recipeGuests()).toEqual([]);
    household.household.set({ id: 'home-b', members: [{ id: 'member-b', isActive: true }] });
    fixture.detectChanges();
    expect(component.recipeMemberIds()).toEqual(['member-b']);
    expect(component.aiOptions.servings).toBe(1);
    component.setAiServings(5);
    component.recipeGuests.set([
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ]);
    fixture.detectChanges();
    expect(component.aiOptions.servings).toBe(5);
    component.setAiDetailLevel('expert');
    expect(component.aiOptions.detailLevel).toBe('expert');
  });

  it('validates servings and handles successful, empty, and failed single recipe generation', () => {
    component.openAiModal();
    component.setAiServings(0);
    expect(component.validRecipeServings()).toBeFalse();
    component.generateSingle();
    expect(ai.generateRecipe).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'recipes.servings_range_error');

    component.setAiServings(3);
    component.selectedIngredients.set([pantry.ingredients()[0]]);
    ai.generateRecipe.and.returnValue(of(GENERATED));
    component.generateSingle();
    expect(ai.generateRecipe).toHaveBeenCalledWith(
      jasmine.objectContaining({
        servings: 3,
        ingredients: [{ id: 'tomato', name: 'Tomate', quantity: 2, unit: 'unit' }]
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      'recipes.receta_generada',
      'recipes.la_ia_ha_creado'
    );
    expect(component.generatedPreviewServings()).toBe(3);
    expect(
      component.generatedPreviewIngredientQuantity(GENERATED, GENERATED.ingredients[0].quantity)
    ).toBe(6);
    component.setGeneratedPreviewServings(5);
    expect(
      component.generatedPreviewIngredientQuantity(GENERATED, GENERATED.ingredients[0].quantity)
    ).toBe(10);
    expect(GENERATED.ingredients[0].quantity).toBe(2);
    expect(ai.generateRecipe).toHaveBeenCalledTimes(1);
    ai.generateRecipe.and.returnValue(of(null));
    component.generateSingle();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'recipes.no_se_pudo_generar');
    ai.generateRecipe.and.returnValue(throwError(() => new Error('synthetic')));
    component.generateSingle();
    expect(toast.error).toHaveBeenCalledTimes(3);
  });

  it('handles successful, empty, and failed multi-recipe generation with per-option levels', () => {
    component.openAiModal();
    component.setAiServings(4);
    ai.generateMultipleRecipes.and.returnValue(
      of([GENERATED, { ...GENERATED, selectedDetailLevel: 'expert' }])
    );
    component.generateMultiple();
    expect(ai.generateMultipleRecipes).toHaveBeenCalledWith(
      jasmine.objectContaining({ servings: 4, count: 3 })
    );
    expect(component.generatedPreviewServings()).toBe(4);
    component.setGeneratedPreviewServings(6);
    expect(
      component.generatedPreviewIngredientQuantity(GENERATED, GENERATED.ingredients[0].quantity)
    ).toBe(12);
    expect(GENERATED.ingredients[0].quantity).toBe(2);
    expect(component.generatedRecipeDetailLevel(0)).toBe('intermediate');
    expect(component.generatedRecipeDetailLevel(1)).toBe('expert');
    ai.generateMultipleRecipes.and.returnValue(of([]));
    component.generateMultiple();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'recipes.no_se_pudieron_generar');
    ai.generateMultipleRecipes.and.returnValue(throwError(() => new Error('synthetic')));
    component.generateMultiple();
    expect(toast.error).toHaveBeenCalledTimes(2);
    component.setGeneratedRecipeDetailLevel(0, 'basic');
    expect(component.generatedRecipeDetailLevel(0)).toBe('basic');
    component.setSingleGeneratedDetailLevel('expert');
    expect(component.generatedPreviewDetailLevel()).toBe('expert');
  });

  it('persists all generated levels and optional detail once, and reports save errors', () => {
    const multi = {
      ...GENERATED,
      instructionsByLevel: {
        basic: [
          {
            ...GENERATED.instructionsByLevel.basic[0],
            instruction: 'Paso básico',
            duration: 5,
            temperature: { value: 90, unit: 'C' as const },
            timerRequired: true,
            timerDuration: 5,
            tips: 'Cuidado'
          }
        ],
        intermediate: [
          {
            ...GENERATED.instructionsByLevel.intermediate[0],
            instruction: 'Paso medio',
            warning: 'Caliente'
          }
        ],
        expert: [{ ...GENERATED.instructionsByLevel.expert[0], instruction: 'Paso experto' }]
      }
    };
    component.openAiModal();
    component.saveGeneratedRecipe(multi, 'expert');
    const payload = recipes.createRecipe.calls.mostRecent().args[0] as any;
    expect(payload.author).toBe('ai');
    expect(payload.servings).toBe(1);
    expect(payload.ingredients[0].quantity).toBe(2);
    expect(payload.instructionsByLevel.basic[0]).toEqual(
      jasmine.objectContaining({
        instruction: 'Paso básico',
        temperature: { value: 90, unit: 'C' },
        timerRequired: true,
        timerDuration: 5,
        illustration: null
      })
    );
    expect(payload.instructionsByLevel.intermediate[0].warning).toBe('Caliente');
    expect(payload.instructionsByLevel.expert[0].instruction).toBe('Paso experto');
    expect(payload.ingredients[0]).toEqual(
      jasmine.objectContaining({
        isOptional: false,
        substitutes: ['tomate en conserva'],
        notes: 'maduro'
      })
    );
    expect(payload.guidance).toEqual(GENERATED.guidance);
    expect(component.singleGeneratedDetailLevel()).toBe('expert');
    expect(toast.success).toHaveBeenCalledWith('recipes.guardada', 'recipes.la_receta_se_ha');
    expect(component.isAiModalOpen()).toBeFalse();

    recipes.createRecipe.and.returnValue(throwError(() => new Error('synthetic')));
    component.saveGeneratedRecipe(multi, 'basic');
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'recipes.no_se_pudo_guardar');

    recipes.createRecipe.and.returnValue(of(RECIPE));
    component.aiOptions.detailLevel = 'expert';
    component.saveGeneratedRecipe({
      ...GENERATED,
      selectedDetailLevel: 'basic',
      ingredients: [
        {
          ...GENERATED.ingredients[0],
          name: 'Agua',
          quantity: 1,
          unit: 'l'
        }
      ],
      nutrition: null,
      storage: null,
      tags: []
    });
    const defaults = recipes.createRecipe.calls.mostRecent().args[0] as any;
    expect(component.singleGeneratedDetailLevel()).toBe('basic');
    expect(defaults.ingredients[0]).toEqual(
      jasmine.objectContaining({
        isOptional: false,
        substitutes: ['tomate en conserva']
      })
    );
    expect(defaults.instructionsByLevel.basic[0]).toEqual(
      jasmine.objectContaining({
        instruction: GENERATED.instructionsByLevel.basic[0].instruction,
        timerRequired: true,
        timerDuration: 10
      })
    );
    expect(defaults.nutrition).toBeUndefined();
    expect(defaults.storage).toBeUndefined();
    expect(defaults.tags).toEqual([]);
  });
});
