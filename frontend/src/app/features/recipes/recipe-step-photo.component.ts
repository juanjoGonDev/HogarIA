import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { map, of, switchMap, Subscription } from 'rxjs';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { RecipeService } from '../../core/services/recipe.service';
import { RecipeStepPhoto } from '../../shared/models/recipe-step-photo';
import { RecipeStepImageAttribution } from '../../shared/models/recipe-instructions';
import { recipeStepPhotoScene } from './recipe-step-photo.util';

type PhotoState = 'loading' | 'photo' | 'empty' | 'error';

@Component({
  selector: 'app-recipe-step-photo',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <figure
      *ngIf="image && !ignoreSelectedImage"
      class="step-photo"
      [class.step-photo--cooking]="cookingMode"
      data-test="recipe-step-photo"
    >
      <img
        [src]="image"
        [alt]="imageAttribution?.altText || instruction"
        loading="lazy"
        (error)="markSelectedImageUnavailable()"
      />
      <figcaption *ngIf="imageAttribution as credit">
        <span>{{ 'recipes.step_photo_credit' | t: { author: credit.author } }}</span>
        <a [href]="credit.licenseUrl" target="_blank" rel="noopener noreferrer">{{
          credit.licenseName
        }}</a>
        <a [href]="credit.sourceUrl" target="_blank" rel="noopener noreferrer">{{
          'recipes.step_photo_source' | t
        }}</a>
      </figcaption>
    </figure>

    <div *ngIf="image && savedImageFailed && !ignoreSelectedImage" class="step-photo__fallback">
      <span role="status" aria-live="polite">{{ 'recipes.step_photo_failed' | t }}</span>
      <button type="button" (click)="searchAlternative()">
        {{ 'recipes.step_photo_retry' | t }}
      </button>
    </div>

    <figure
      *ngIf="
        (!image || ignoreSelectedImage) && state() === 'photo' && photo() && imageUrl() as source
      "
      class="step-photo"
      [class.step-photo--cooking]="cookingMode"
      data-test="recipe-step-photo"
    >
      <img
        [src]="source"
        [alt]="photo()!.altText"
        loading="lazy"
        (error)="markImageUnavailable()"
      />
      <figcaption>
        <span>{{ 'recipes.step_photo_credit' | t: { author: photo()!.author } }}</span>
        <a [href]="photo()!.licenseUrl" target="_blank" rel="noopener noreferrer">
          {{ photo()!.licenseName }}
        </a>
        <a
          data-test="recipe-step-photo-source"
          [href]="photo()!.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ 'recipes.step_photo_source' | t }}</a
        >
        <span>{{ 'recipes.step_photo_resized' | t }}</span>
      </figcaption>
    </figure>

    <span
      *ngIf="(!image || ignoreSelectedImage) && state() === 'loading'"
      class="step-photo__status"
      role="status"
      aria-live="polite"
    >
      {{ 'recipes.step_photo_loading' | t }}
    </span>

    <div
      *ngIf="(!image || ignoreSelectedImage) && (state() === 'empty' || state() === 'error')"
      class="step-photo__fallback"
    >
      <span role="status" aria-live="polite">
        {{ (state() === 'empty' ? 'recipes.step_photo_missing' : 'recipes.step_photo_failed') | t }}
      </span>
      <button type="button" data-test="recipe-step-photo-retry" (click)="retry()">
        {{ 'recipes.step_photo_retry' | t }}
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .step-photo {
        margin: 0 0 var(--space-4);
      }

      .step-photo img {
        display: block;
        width: 100%;
        max-height: 24rem;
        border-radius: var(--radius-lg);
        object-fit: cover;
        background: var(--bg-tertiary);
      }

      .step-photo--cooking img {
        max-height: 28rem;
        aspect-ratio: 16 / 9;
      }

      .step-photo figcaption {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-2);
        margin-top: var(--space-2);
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .step-photo a,
      .step-photo__fallback button {
        color: var(--primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }

      .step-photo__status,
      .step-photo__fallback {
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .step-photo__fallback {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-block: var(--space-2) var(--space-4);
      }

      .step-photo__fallback button {
        border: 0;
        padding: 0;
        background: none;
        font: inherit;
        cursor: pointer;
      }

      a:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    `
  ]
})
export class RecipeStepPhotoComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) instruction = '';
  @Input() image: string | null | undefined;
  @Input() imageAttribution: RecipeStepImageAttribution | null | undefined;
  @Input() cookingMode = false;

  private readonly recipeService = inject(RecipeService);
  private request?: Subscription;
  readonly state = signal<PhotoState>('loading');
  readonly photo = signal<RecipeStepPhoto | null>(null);
  readonly imageUrl = signal<string | null>(null);
  savedImageFailed = false;
  ignoreSelectedImage = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['image']) {
      this.savedImageFailed = false;
      this.ignoreSelectedImage = false;
      this.request?.unsubscribe();
      if (this.image) {
        this.state.set('photo');
        return;
      }
      this.loadPhoto(false);
      return;
    }
    if (changes['instruction'] && !this.image) this.loadPhoto(false);
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  retry(): void {
    this.loadPhoto(true);
  }

  markImageUnavailable(): void {
    const image = this.photo();
    if (image) this.recipeService.forgetStepPhotoImage(image.id);
    this.photo.set(null);
    this.imageUrl.set(null);
    this.state.set('error');
  }

  markSelectedImageUnavailable(): void {
    this.savedImageFailed = true;
  }

  searchAlternative(): void {
    this.ignoreSelectedImage = true;
    this.retry();
  }

  private loadPhoto(retry: boolean): void {
    this.request?.unsubscribe();
    this.photo.set(null);
    this.imageUrl.set(null);
    this.state.set('loading');
    const scene = recipeStepPhotoScene(this.instruction);
    const search = retry
      ? this.recipeService.retryStepPhoto(scene)
      : this.recipeService.searchStepPhoto(scene);

    this.request = search
      .pipe(
        switchMap((photo) =>
          photo
            ? this.recipeService
                .loadStepPhotoImage(photo.id)
                .pipe(map((imageUrl) => ({ photo, imageUrl })))
            : of(null)
        )
      )
      .subscribe({
        next: (result) => {
          if (!result) {
            this.state.set('empty');
            return;
          }
          this.photo.set(result.photo);
          this.imageUrl.set(result.imageUrl);
          this.state.set('photo');
        },
        error: () => {
          this.state.set('error');
        }
      });
  }
}
