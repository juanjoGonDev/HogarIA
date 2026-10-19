import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { RecipeImproveScope } from '../../shared/models/ai-config.model';
import { createRecipeEditDraft } from './recipe-edit.util';
import { RecipeImproveDialogComponent } from './recipe-improve-dialog.component';

describe('RecipeImproveDialogComponent', () => {
  let fixture: ComponentFixture<RecipeImproveDialogComponent>;
  let component: RecipeImproveDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecipeImproveDialogComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key, changeTick: () => 0 } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RecipeImproveDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function completeDraft() {
    const draft = createRecipeEditDraft();
    draft.name = 'Crema de calabaza';
    draft.ingredients[0].name = 'Calabaza';
    for (const level of ['basic', 'intermediate', 'expert'] as const) {
      draft.instructionsByLevel![level][0].instruction = 'Cocina la calabaza.';
    }
    return draft;
  }

  it('starts with no selected improvements and cannot submit incomplete recipes', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('draft', createRecipeEditDraft());
    fixture.detectChanges();

    expect(component.selectedScopes).toEqual([]);
    expect(component.canImprove).toBeFalse();
    expect(
      (
        fixture.nativeElement.querySelector(
          '.recipe-improve__actions app-button:last-child button'
        ) as HTMLButtonElement
      )?.disabled
    ).toBeTrue();
  });

  it('requests only explicitly selected sections for a complete draft', () => {
    const draft = completeDraft();
    const requested: Array<{ scopes: RecipeImproveScope[]; includeMedia: boolean }> = [];
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('draft', draft);
    fixture.detectChanges();
    component.request.subscribe((value) => requested.push(value));

    component.toggleScope('details', { target: { checked: true } } as unknown as Event);
    component.toggleScope('timing', { target: { checked: true } } as unknown as Event);
    component.toggleMediaSearch({ target: { checked: true } } as unknown as Event);
    component.requestImprovements();

    expect(requested).toEqual([{ scopes: ['details', 'timing'], includeMedia: true }]);
    expect(draft.name).toBe('Crema de calabaza');
  });

  it('removes deselected scopes, blocks requests while loading and rebuilds the review', () => {
    const draft = completeDraft();
    const requested: unknown[] = [];
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('draft', draft);
    fixture.detectChanges();
    component.request.subscribe((value) => requested.push(value));
    component.toggleScope('details', { target: { checked: true } } as unknown as Event);
    component.toggleScope('details', { target: { checked: true } } as unknown as Event);
    component.toggleScope('details', { target: { checked: false } } as unknown as Event);
    component.requestImprovements();
    expect(requested).toEqual([]);

    component.toggleScope('storage', { target: { checked: true } } as unknown as Event);
    fixture.componentRef.setInput('loading', true);
    component.requestImprovements();
    expect(requested).toEqual([]);
    expect(component.scopeDescription('storage')).toBe('recipes.improve.scope.storage_description');

    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('response', {
      proposal: {} as never,
      patch: {
        storage: {
          method: 'Refrigerar',
          duration: '3 días',
          reheatingInstructions: null,
          container: null,
          freezingPossible: false,
          freezingDuration: null
        }
      },
      scopes: ['storage']
    });
    fixture.detectChanges();
    expect(component.reviewGroups.length).toBe(1);
    expect(component.reviewGroups[0].changes.length).toBeGreaterThan(0);

    fixture.componentRef.setInput('draft', null);
    fixture.detectChanges();
    expect(component.reviewGroups).toEqual([]);
  });

  it('retains the explicit scope and offers a clear retry after a recoverable error', () => {
    const requested: unknown[] = [];
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('draft', completeDraft());
    fixture.detectChanges();
    component.request.subscribe((value) => requested.push(value));
    component.toggleScope('preparation', { target: { checked: true } } as unknown as Event);
    fixture.componentRef.setInput('errorKey', 'recipes.improve.failed');
    fixture.detectChanges();

    const retry = fixture.nativeElement.querySelector(
      '[data-test="recipe-improve-retry"] button'
    ) as HTMLButtonElement | null;
    expect(retry?.textContent).toContain('recipes.improve.retry');
    retry?.click();

    expect(requested).toEqual([{ scopes: ['preparation'], includeMedia: false }]);
  });
});
