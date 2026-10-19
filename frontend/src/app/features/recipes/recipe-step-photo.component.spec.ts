import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { RecipeService } from '../../core/services/recipe.service';
import { RecipeStepPhotoComponent } from './recipe-step-photo.component';

describe('RecipeStepPhotoComponent', () => {
  let fixture: ComponentFixture<RecipeStepPhotoComponent>;
  let service: {
    searchStepPhoto: jasmine.Spy;
    loadStepPhotoImage: jasmine.Spy;
    retryStepPhoto: jasmine.Spy;
    forgetStepPhotoImage: jasmine.Spy;
  };

  const photo = {
    id: 'a'.repeat(24),
    altText: 'Fresh vegetables on a board',
    author: 'Ana & Luis',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cooking_step.jpg'
  };

  beforeEach(async () => {
    service = {
      searchStepPhoto: jasmine.createSpy().and.returnValue(of(photo)),
      loadStepPhotoImage: jasmine.createSpy().and.returnValue(of('blob:recipe-step-photo')),
      retryStepPhoto: jasmine.createSpy().and.returnValue(of(photo)),
      forgetStepPhotoImage: jasmine.createSpy()
    };
    await TestBed.configureTestingModule({
      imports: [RecipeStepPhotoComponent],
      providers: [
        { provide: RecipeService, useValue: service },
        {
          provide: I18nService,
          useValue: {
            changeTick: () => 0,
            t: (key: string, params?: Record<string, string>) =>
              key === 'recipes.step_photo_credit'
                ? `Foto de ${params?.['author'] ?? ''}`
                : key
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RecipeStepPhotoComponent);
    fixture.componentRef.setInput('instruction', 'Pica las verduras.');
    fixture.detectChanges();
  });

  it('shows a real photo from the same-origin proxy with its author and license links', () => {
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(service.searchStepPhoto).toHaveBeenCalledWith('cut');
    expect(service.loadStepPhotoImage).toHaveBeenCalledWith(photo.id);
    expect(image.getAttribute('src')).toBe('blob:recipe-step-photo');
    expect(image.alt).toBe(photo.altText);
    expect(fixture.nativeElement.textContent).toContain(photo.author);
    expect(fixture.nativeElement.querySelector('a[rel="noopener noreferrer"]')?.getAttribute('href')).toBe(
      photo.licenseUrl
    );
    expect(fixture.nativeElement.querySelector('a[data-test="recipe-step-photo-source"]')?.getAttribute('href')).toBe(
      photo.sourceUrl
    );
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('keeps the step usable when no photo exists and offers an accessible retry', () => {
    service.searchStepPhoto.and.returnValue(of(null));
    fixture.componentRef.setInput('instruction', 'Lava las verduras.');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    const retry = fixture.nativeElement.querySelector(
      '[data-test="recipe-step-photo-retry"]'
    ) as HTMLButtonElement;
    expect(retry.textContent).toContain('recipes.step_photo_retry');
    retry.click();
    fixture.detectChanges();
    expect(service.retryStepPhoto).toHaveBeenCalledWith('wash');
  });

  it('offers retry after search or image failure and invalidates a failed blob', () => {
    service.loadStepPhotoImage.and.returnValue(throwError(() => new Error('offline')));
    fixture.componentRef.setInput('instruction', 'Lava las verduras.');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="recipe-step-photo-retry"]')).not.toBeNull();

    service.loadStepPhotoImage.and.returnValue(of('blob:recipe-step-photo'));
    fixture.componentRef.setInput('instruction', 'Pica las verduras.');
    fixture.detectChanges();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(service.forgetStepPhotoImage).toHaveBeenCalledWith(photo.id);
    expect(fixture.nativeElement.querySelector('[data-test="recipe-step-photo-retry"]')).not.toBeNull();
  });

  it('prefers a stored user-selected photo and renders only verified attribution', () => {
    const storedImage = `/api/recipe-images/${'c'.repeat(24)}`;
    const credit = {
      altText: 'Cebolla cortada en dados',
      author: 'Fotógrafa de prueba',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cebolla.jpg'
    };
    service.searchStepPhoto.calls.reset();
    service.loadStepPhotoImage.calls.reset();
    fixture.componentRef.setInput('image', storedImage);
    fixture.componentRef.setInput('imageAttribution', credit);
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(storedImage);
    expect(image.alt).toBe(credit.altText);
    expect(fixture.nativeElement.textContent).toContain(credit.author);
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe(credit.licenseUrl);
    expect(service.searchStepPhoto).not.toHaveBeenCalled();
    expect(service.loadStepPhotoImage).not.toHaveBeenCalled();
  });
});
