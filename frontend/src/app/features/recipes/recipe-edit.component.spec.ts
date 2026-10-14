import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { of, Subject, throwError } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { AiService } from '../../core/services/ai.service';
import { RecipeService } from '../../core/services/recipe.service';
import { AuthService } from '../../core/services/auth.service';
import { Recipe } from '../../shared/models/recipe.model';
import { AIRecipeImproveResponse, AIRecipeResponse } from '../../shared/models/ai-config.model';
import { RecipeStepVideoCandidate } from '../../shared/models/recipe-step-video';
import { RecipeEditComponent } from './recipe-edit.component';

const recipe: Recipe = {
  id: 'recipe-editor-qa',
  name: 'Tortilla de prueba',
  description: 'Receta de prueba',
  difficulty: 'easy',
  cuisine: 'española',
  countryCode: 'ES',
  mealType: ['dinner'],
  totalTime: 30,
  prepTime: 10,
  cookTime: 20,
  servings: 2,
  ingredients: [{ name: 'Patata QA', quantity: 300, unit: 'g', isOptional: false }],
  utensils: ['Sartén'],
  instructionsByLevel: {
    basic: [{ stepNumber: 1, instruction: 'Pela las patatas.' }],
    intermediate: [{ stepNumber: 1, instruction: 'Pela y corta las patatas en láminas finas.' }],
    expert: [{ stepNumber: 1, instruction: 'Corta las patatas en láminas regulares.' }]
  },
  author: 'user',
  authorId: 'user-qa',
  timesCooked: 4,
  tags: ['casera'],
  isFavorite: true,
  isPublic: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z')
};

function fillValidCreateDraft(component: RecipeEditComponent): void {
  const draft = component.draft!;
  draft.name = 'Crema de calabaza';
  draft.mealType = ['dinner'];
  draft.ingredients[0].name = 'Calabaza';
  draft.instructionsByLevel!.basic[0].instruction = 'Pela y trocea la calabaza.';
  draft.instructionsByLevel!.intermediate[0].instruction = 'Pela y trocea la calabaza.';
  draft.instructionsByLevel!.expert[0].instruction = 'Pela y trocea la calabaza.';
}

describe('RecipeEditComponent', () => {
  let recipeService: jasmine.SpyObj<RecipeService>;
  let aiService: jasmine.SpyObj<AiService>;
  let router: jasmine.SpyObj<Router>;
  let routeParams: BehaviorSubject<ParamMap>;

  beforeEach(async () => {
    recipeService = jasmine.createSpyObj<RecipeService>('RecipeService', [
      'getRecipe',
      'createRecipe',
      'updateRecipe',
      'searchRecipePhotos',
      'searchStepPhoto',
      'searchStepVideos'
    ]);
    recipeService.getRecipe.and.returnValue(of(recipe));
    recipeService.createRecipe.and.returnValue(of(recipe));
    recipeService.updateRecipe.and.returnValue(of(recipe));
    recipeService.searchRecipePhotos.and.returnValue(of([]));
    recipeService.searchStepPhoto.and.returnValue(of(null));
    recipeService.searchStepVideos.and.returnValue(of([]));
    aiService = jasmine.createSpyObj<AiService>('AiService', ['improveRecipe']);
    aiService.improveRecipe.and.returnValue(of(null));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    routeParams = new BehaviorSubject(convertToParamMap({ id: recipe.id }));

    await TestBed.configureTestingModule({
      imports: [RecipeEditComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: routeParams.asObservable() }
        },
        { provide: Router, useValue: router },
        { provide: RecipeService, useValue: recipeService },
        { provide: AiService, useValue: aiService },
        { provide: AuthService, useValue: { userId: () => 'user-qa' } },
        {
          provide: I18nService,
          useValue: { t: (key: string) => key, changeTick: () => 0 }
        }
      ]
    }).compileComponents();
  });

  it('opens a blank create draft without fetching or creating until explicit save', async () => {
    routeParams.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.querySelector('[data-test="recipe-editor-form"]')).not.toBeNull();
    expect(component.isCreateMode).toBeTrue();
    expect(component.draft?.name).toBe('');
    expect(recipeService.getRecipe).not.toHaveBeenCalled();
    expect(recipeService.createRecipe).not.toHaveBeenCalled();

    fillValidCreateDraft(component);
    component.save();

    expect(recipeService.createRecipe).toHaveBeenCalledTimes(1);
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/recipes'], {
      queryParams: { recipe: recipe.id }
    });
    fixture.destroy();
  });

  it('deduplicates create submits while in flight and keeps creation explicit', async () => {
    routeParams.next(convertToParamMap({}));
    const pending = new Subject<Recipe | null>();
    recipeService.createRecipe.and.returnValue(pending.asObservable());
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    fillValidCreateDraft(component);

    component.save();
    component.save();

    expect(recipeService.createRecipe).toHaveBeenCalledTimes(1);
    expect(component.saving).toBeTrue();
    pending.next(recipe);
    pending.complete();
    expect(component.saving).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/recipes'], {
      queryParams: { recipe: recipe.id }
    });
    fixture.destroy();
  });

  it('preserves failed create drafts and permits an explicit retry', async () => {
    routeParams.next(convertToParamMap({}));
    recipeService.createRecipe.and.returnValues(of(null), of(recipe));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    fillValidCreateDraft(component);

    component.save();
    expect(component.draft?.name).toBe('Crema de calabaza');
    expect(component.formError).toBe('recipes.editor.create_failed');
    expect(router.navigate).not.toHaveBeenCalled();

    component.save();
    expect(recipeService.createRecipe).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith(['/recipes'], {
      queryParams: { recipe: recipe.id }
    });
    fixture.destroy();
  });

  it('shows one editor panel at a time and keeps independent level drafts when switching', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const editInstruction = (level: string, value: string): void => {
      const input = fixture.nativeElement.querySelector(
        `#step-instruction-${level}-0`
      ) as HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    editInstruction('basic', 'Básico editado');
    component.setActiveDetailLevel('expert');
    fixture.detectChanges();
    editInstruction('expert', 'Experto editado');
    component.setActiveTab('ingredients');
    fixture.detectChanges();

    const ingredientsPanel = fixture.nativeElement.querySelector(
      '[data-test="editor-panel-ingredients"]'
    ) as HTMLElement;
    const instructionsPanel = fixture.nativeElement.querySelector(
      '[data-test="editor-panel-instructions"]'
    ) as HTMLElement;
    expect(ingredientsPanel.hidden).toBeFalse();
    expect(instructionsPanel.hidden).toBeTrue();
    expect(component.draft?.instructionsByLevel?.basic[0].instruction).toBe('Básico editado');
    expect(component.draft?.instructionsByLevel?.expert[0].instruction).toBe('Experto editado');
    component.setActiveTab('instructions');
    fixture.detectChanges();
    expect(ingredientsPanel.hidden).toBeTrue();
    expect(instructionsPanel.hidden).toBeFalse();
    expect(component.activeDetailLevel).toBe('expert');
    expect(fixture.nativeElement.querySelector('#step-instruction-expert-0')?.value).toBe(
      'Experto editado'
    );
    component.setActiveDetailLevel('basic');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#step-instruction-basic-0')?.value).toBe(
      'Básico editado'
    );
    fixture.destroy();
  });

  it('loads an owned recipe into a dedicated form with all instruction levels', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="recipe-editor-page"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="recipe-editor-form"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('recipes.editor.basic');
    expect(fixture.nativeElement.textContent).toContain('recipes.editor.intermediate');
    expect(fixture.nativeElement.textContent).toContain('recipes.editor.expert');
    fixture.componentInstance.setActiveTab('media');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="recipe-photo-search"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'recipes.editor.generate_image_unavailable'
    );
  });

  it('debounces explicit photo searches, lets the user choose a result, and submits its stable id', fakeAsync(() => {
    const photo = {
      id: 'a'.repeat(24),
      altText: 'Tortilla recién hecha',
      author: 'María',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tortilla.jpg',
      previewUrl: '/api/recipe-photo-previews/' + 'a'.repeat(24)
    };
    recipeService.searchRecipePhotos.and.returnValue(of([photo]));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    fixture.componentInstance.searchCoverPhotos('tortilla española');
    tick(319);
    expect(recipeService.searchRecipePhotos).not.toHaveBeenCalled();
    tick(1);
    fixture.detectChanges();
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledOnceWith('tortilla española');
    expect(fixture.componentInstance.imageSearchResults).toEqual([photo]);

    fixture.componentInstance.selectCoverPhoto(fixture.componentInstance.draft!, photo);
    expect(fixture.componentInstance.draft?.imageAttribution?.author).toBe('María');
    fixture.componentInstance.save();

    expect(recipeService.updateRecipe).toHaveBeenCalledWith(
      recipe.id,
      jasmine.objectContaining({ imagePhotoId: photo.id })
    );
    fixture.destroy();
  }));

  it('debounces step-photo search independently and submits only the stable candidate id', fakeAsync(() => {
    const photo = {
      id: 'b'.repeat(24),
      altText: 'Cebolla picada',
      author: 'Fotógrafa de prueba',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cebolla.jpg',
      previewUrl: '/api/recipe-photo-previews/' + 'b'.repeat(24)
    };
    recipeService.searchRecipePhotos.and.returnValue(of([photo]));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const step = fixture.componentInstance.draft!.instructionsByLevel!.basic[0];

    fixture.componentInstance.searchStepPhotos(step, ' cebolla   picada ');
    tick(319);
    expect(recipeService.searchRecipePhotos).not.toHaveBeenCalled();
    tick(1);
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledOnceWith('cebolla picada');
    expect(fixture.componentInstance.stepPhotoResults(step)).toEqual([photo]);

    fixture.componentInstance.selectStepPhoto(step, photo);
    expect(step.imageAttribution?.author).toBe('Fotógrafa de prueba');
    fixture.componentInstance.save();
    const payload = recipeService.updateRecipe.calls.mostRecent().args[1];
    expect(payload.instructionsByLevel?.basic[0].imagePhotoId).toBe(photo.id);
    expect(payload.instructionsByLevel?.basic[0].image).toBeUndefined();
    fixture.destroy();
  }));

  it('does not expose an editor for catalog or another user’s recipe', async () => {
    for (const inaccessible of [
      { ...recipe, author: 'catalog' as const, authorId: undefined },
      { ...recipe, authorId: 'another-user' }
    ]) {
      recipeService.getRecipe.and.returnValue(of(inaccessible));
      const fixture = TestBed.createComponent(RecipeEditComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-test="recipe-editor-form"]')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('recipes.editor.forbidden');
      expect(recipeService.updateRecipe).not.toHaveBeenCalled();
      fixture.destroy();
    }
  });

  it('asks before discarding an edited draft and only navigates after confirmation', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.draft!.name = 'Tortilla modificada';

    fixture.componentInstance.cancelEditing();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="recipe-editor-confirm-discard"]')
    ).not.toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();

    fixture.componentInstance.confirmDiscardChanges();
    expect(router.navigate).toHaveBeenCalled();
  });

  it('retains the draft and shows recoverable feedback when PATCH fails', async () => {
    recipeService.updateRecipe.and.returnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.draft!.name = 'Tortilla conservada';

    fixture.componentInstance.save();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.draft?.name).toBe('Tortilla conservada');
    expect(fixture.nativeElement.textContent).toContain('recipes.editor.save_failed');
  });

  it('validates before PATCH and can add, reorder, and remove nested ingredient and step rows', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const draft = fixture.componentInstance.draft!;
    draft.name = '   ';

    fixture.componentInstance.save();
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
    expect(fixture.componentInstance.formError).toBe('recipes.editor.invalid');

    draft.name = 'Tortilla de prueba';
    fixture.componentInstance.addIngredient(draft);
    draft.ingredients[1].name = 'Cebolla QA';
    fixture.componentInstance.moveIngredient(draft, 1, -1);
    expect(draft.ingredients[0].name).toBe('Cebolla QA');
    fixture.componentInstance.removeIngredient(draft, 0);
    expect(draft.ingredients).toHaveSize(1);

    fixture.componentInstance.addStep(draft, 'intermediate');
    draft.instructionsByLevel!.intermediate[1].instruction = 'Dora la cebolla.';
    fixture.componentInstance.moveStep(draft, 'intermediate', 1, -1);
    expect(draft.instructionsByLevel!.intermediate[0]).toEqual(
      jasmine.objectContaining({ stepNumber: 1, instruction: 'Dora la cebolla.' })
    );
    fixture.componentInstance.removeStep(draft, 'intermediate', 0);
    expect(draft.instructionsByLevel!.intermediate).toHaveSize(1);
  });

  it('saves editable fields only and navigates back to the saved recipe', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.draft!.name = 'Tortilla actualizada';

    fixture.componentInstance.save();

    const payload = recipeService.updateRecipe.calls.mostRecent().args[1];
    expect(payload.name).toBe('Tortilla actualizada');
    expect(payload).not.toEqual(jasmine.objectContaining({ author: 'user', authorId: 'user-qa' }));
    expect(router.navigate).toHaveBeenCalledWith(['/recipes'], {
      queryParams: { recipe: recipe.id }
    });
  });

  it('submits through the shared save button used by the form footer', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector(
      '[data-test="recipe-editor-save"] button'
    ) as HTMLButtonElement;
    saveButton.click();

    expect(recipeService.updateRecipe).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/recipes'], {
      queryParams: { recipe: recipe.id }
    });
  });

  it('preserves selected media only while its URL matches and validates editable choices', async () => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const draft = component.draft!;
    const photo = {
      id: 'c'.repeat(24),
      altText: 'Tortilla en una sartén',
      author: 'Autora QA',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tortilla.jpg',
      previewUrl: `/api/recipe-photo-previews/${'c'.repeat(24)}`
    };

    component.selectCoverPhoto(draft, photo);
    component.onCoverImageChange(draft, draft.image);
    expect(draft.imagePhotoId).toBe(photo.id);
    component.onCoverImageChange(draft, 'https://images.example.test/manual.jpg');
    expect(draft.imagePhotoId).toBeNull();
    expect(draft.imageAttribution).toBeNull();

    const step = draft.instructionsByLevel!.basic[0];
    component.selectStepPhoto(step, photo);
    component.onStepImageChange(step, step.imageUrl);
    expect(step.imagePhotoId).toBe(photo.id);
    component.onStepImageChange(step, 'https://images.example.test/other.jpg');
    expect(step.imagePhotoId).toBeNull();
    expect(step.imageAttribution).toBeNull();
    component.clearStepPhoto(step);
    expect(step.imageUrl).toBe('');

    expect(component.stepsFor(draft, 'basic')).toBe(draft.instructionsByLevel!.basic);
    expect(component.stepsFor(draft)).toEqual([]);
    component.toggleMealType(draft, 'breakfast', { target: { checked: true } } as unknown as Event);
    expect(draft.mealType).toContain('breakfast');
    component.toggleMealType(draft, 'breakfast', {
      target: { checked: false }
    } as unknown as Event);
    expect(draft.mealType).not.toContain('breakfast');

    component.setDifficulty(draft, 'hard');
    component.setDifficulty(draft, 'unknown');
    expect(draft.difficulty).toBe('hard');
    component.setIngredientUnit(draft.ingredients[0], 'kg');
    component.setIngredientUnit(draft.ingredients[0], null);
    expect(draft.ingredients[0].unit).toBe('kg');
    component.setTemperatureUnit(step, 'F');
    component.setTemperatureUnit(step, null);
    expect(step.temperatureUnit).toBe('F');
    component.moveIngredient(draft, -1, -1);
    component.moveIngredient(draft, 0, 1);
    expect(draft.ingredients[0].name).toBe('Patata QA');
    fixture.destroy();
  });

  it('deduplicates equal cover queries unless explicitly retried and rejects bounded step queries', fakeAsync(() => {
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const step = component.draft!.instructionsByLevel!.basic[0];

    component.searchCoverPhotos('tortilla española');
    tick(320);
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledOnceWith('tortilla española');
    component.searchCoverPhotos('tortilla española');
    tick(320);
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledTimes(1);
    component.retryCoverPhotoSearch();
    tick(320);
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledTimes(2);

    component.searchStepPhotos(step, 'x');
    expect(component.stepPhotoState(step)).toBe('idle');
    component.searchStepPhotos(step, 'x'.repeat(81));
    expect(component.stepPhotoState(step)).toBe('idle');
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledTimes(2);
    component.searchStepPhotos(step, ' cebolla picada ');
    tick(320);
    expect(recipeService.searchRecipePhotos).toHaveBeenCalledWith('cebolla picada');
    fixture.destroy();
  }));

  it('reviews an AI patch before applying it and keeps the recipe serving base and media', async () => {
    const response: AIRecipeImproveResponse = {
      proposal: {} as AIRecipeResponse,
      patch: {
        name: 'No aplicar nombre fuera del ámbito',
        ingredients: [
          {
            name: 'Patata',
            quantity: 160,
            unit: 'g',
            preparation: 'pelada',
            isOptional: false,
            substitutes: [],
            notes: null
          }
        ]
      },
      scopes: ['ingredients']
    };
    aiService.improveRecipe.and.returnValue(of(response));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const draft = component.draft!;
    const originalImage = draft.image;

    component.openRecipeImprovement();
    component.requestRecipeImprovement({ scopes: ['ingredients'], includeMedia: false });

    const request = aiService.improveRecipe.calls.mostRecent().args[0];
    expect(component.improvementResponse).toBe(response);
    expect(draft.ingredients[0].quantityText).toBe('300');
    expect(request.recipe.baseServings).toBe(1);
    expect(request.recipe.servings).toBe(2);
    expect(request.recipe.ingredients?.[0].quantity).toBe(150);
    expect(JSON.stringify(request.recipe)).not.toContain('ingredientId');
    expect(JSON.stringify(request.recipe)).not.toContain('imagePhotoId');
    expect(JSON.stringify(request.recipe)).not.toContain('photoSearchQuery');

    component.applyRecipeImprovement({
      patch: response.patch,
      scopes: response.scopes,
      includeMedia: false
    });

    expect(draft.servings).toBe('2');
    expect(draft.ingredients[0].quantityText).toBe('320');
    expect(draft.name).toBe('Tortilla de prueba');
    expect(draft.image).toBe(originalImage);
    expect(component.improveDialogOpen).toBeFalse();
    expect(component.hasUnsavedChanges()).toBeTrue();
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
    expect(recipeService.createRecipe).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('keeps media search separate from AI and selects a Commons clip only after user choice', async () => {
    const clip: RecipeStepVideoCandidate = {
      id: 'a'.repeat(24),
      title: 'Cortar verduras',
      author: 'Autora sintética',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cutting.webm',
      thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Cutting.jpg',
      durationSeconds: 10,
      mimeType: 'video/webm'
    };
    recipeService.searchStepVideos.and.returnValue(of([clip]));
    const instruction = (text: string, stepNumber = 1) => ({
      stepNumber,
      instruction: text,
      duration: 5,
      temperature: null,
      timerRequired: false,
      timerDuration: null,
      tips: 'Mantén un corte uniforme.',
      warning: null,
      illustration: null
    });
    const response: AIRecipeImproveResponse = {
      proposal: {} as AIRecipeResponse,
      patch: {
        instructionsByLevel: {
          basic: [instruction('Corta las patatas en cubos.')],
          intermediate: [instruction('Corta las patatas en cubos regulares.')],
          expert: [instruction('Brunoise las patatas con cortes uniformes.')]
        }
      },
      scopes: ['preparation']
    };
    aiService.improveRecipe.and.returnValue(of(response));
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openRecipeImprovement();
    component.requestRecipeImprovement({ scopes: ['preparation'], includeMedia: true });
    expect(aiService.improveRecipe.calls.mostRecent().args[0].scopes).toEqual(['preparation']);
    expect(JSON.stringify(aiService.improveRecipe.calls.mostRecent().args[0])).not.toContain(
      'includeMedia'
    );
    component.applyRecipeImprovement({
      patch: response.patch,
      scopes: response.scopes,
      includeMedia: true
    });

    expect(recipeService.searchStepPhoto).toHaveBeenCalledWith('cut');
    expect(recipeService.searchStepVideos).toHaveBeenCalledWith('cut');
    const basicStep = component.draft!.instructionsByLevel!.basic[0];
    expect(component.stepMediaResult(basicStep)?.videos).toEqual([clip]);
    expect(basicStep.instruction).toBe('Corta las patatas en cubos.');
    expect(basicStep.videoId).toBeNull();
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();

    component.selectStepVideo(basicStep, clip);
    expect(basicStep.videoId).toBe(clip.id);
    expect(basicStep.video).toEqual(clip);
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('cancels an in-flight improvement and ignores a late provider response', async () => {
    const pending = new Subject<AIRecipeImproveResponse | null>();
    aiService.improveRecipe.and.returnValue(pending.asObservable());
    const fixture = TestBed.createComponent(RecipeEditComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const originalName = component.draft!.name;
    const lateResponse: AIRecipeImproveResponse = {
      proposal: {} as AIRecipeResponse,
      patch: { name: 'No debe aplicarse sin revisión' },
      scopes: ['details']
    };

    component.openRecipeImprovement();
    component.requestRecipeImprovement({ scopes: ['details'], includeMedia: false });
    expect(component.improvingRecipe).toBeTrue();
    component.cancelRecipeImprovement();
    pending.next(lateResponse);

    expect(component.improvingRecipe).toBeFalse();
    expect(component.improveDialogOpen).toBeFalse();
    expect(component.improvementResponse).toBeNull();
    expect(component.draft!.name).toBe(originalName);
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
