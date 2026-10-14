import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { RecipeService } from '../../core/services/recipe.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { RecipeStepVideoCandidate } from '../../shared/models/recipe-step-video';

type PlaybackState = 'idle' | 'preparing' | 'ready' | 'error';

@Component({
  selector: 'app-recipe-step-video-player',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ButtonComponent],
  template: `
    <section class="recipe-step-video" data-test="recipe-step-video-player">
      <ng-container *ngIf="video as clip; else unavailableClip">
        <video
          *ngIf="streamUrl"
          controls
          muted
          loop
          playsinline
          crossorigin="use-credentials"
          preload="none"
          [attr.autoplay]="autoPlay ? '' : null"
          [attr.aria-label]="'recipes.cooking.video_label' | t: { title: clip.title }"
          [poster]="clip.thumbnailUrl"
          (error)="onPlaybackError()"
          data-test="recipe-step-video"
        >
          <source [src]="streamUrl" [type]="clip.mimeType" />
        </video>

        <p *ngIf="playbackState === 'preparing'" class="recipe-step-video__status" role="status">
          {{ 'recipes.cooking.video_prepare' | t }}
        </p>
        <div *ngIf="playbackState === 'idle'" class="recipe-step-video__action">
          <app-button variant="outline" (onClick)="play()">
            {{ 'recipes.cooking.video_play' | t }}
          </app-button>
        </div>
        <div *ngIf="playbackState === 'error'" class="recipe-step-video__error" role="status">
          <span>{{ 'recipes.cooking.video_unavailable' | t }}</span>
          <app-button variant="outline" (onClick)="play()">
            {{ 'recipes.cooking.video_retry' | t }}
          </app-button>
        </div>
        <p class="recipe-step-video__credit">
          {{
            'recipes.cooking.video_credit' | t: { author: clip.author, license: clip.licenseName }
          }}
          <a [href]="clip.licenseUrl" target="_blank" rel="noopener noreferrer">{{
            clip.licenseName
          }}</a>
          <a [href]="clip.sourceUrl" target="_blank" rel="noopener noreferrer">{{
            'recipes.step_video_source' | t
          }}</a>
        </p>
      </ng-container>
      <ng-template #unavailableClip>
        <p class="recipe-step-video__status" role="note">
          {{ 'recipes.cooking.video_unavailable' | t }}
        </p>
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .recipe-step-video {
        min-width: 0;
        display: grid;
        gap: var(--space-2);
        margin-top: var(--space-3);
      }
      .recipe-step-video video {
        display: block;
        width: min(100%, 640px);
        aspect-ratio: 16 / 9;
        border-radius: var(--radius-md);
        background: var(--bg-tertiary);
        object-fit: contain;
      }
      .recipe-step-video__status,
      .recipe-step-video__error,
      .recipe-step-video__credit {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
        overflow-wrap: anywhere;
      }
      .recipe-step-video__error,
      .recipe-step-video__action {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .recipe-step-video__credit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-2);
      }
      .recipe-step-video__credit a {
        color: var(--primary);
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }
    `
  ]
})
export class RecipeStepVideoPlayerComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) recipeId = '';
  @Input({ required: true }) videoId = '';
  @Input() video: RecipeStepVideoCandidate | null = null;

  private readonly recipeService = inject(RecipeService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private playbackRequest: Subscription | null = null;
  playbackState: PlaybackState = 'idle';
  streamUrl = '';
  autoPlay = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['videoId'] && !changes['recipeId'] && !changes['video']) return;
    this.playbackRequest?.unsubscribe();
    this.playbackRequest = null;
    this.streamUrl = '';
    this.playbackState = 'idle';
    this.autoPlay = false;
    if (!this.recipeId || !this.videoId || !this.video) return;
    if (this.shouldAutoplay()) this.preparePlayback(true);
  }

  ngOnDestroy(): void {
    this.playbackRequest?.unsubscribe();
    this.playbackRequest = null;
  }

  play(): void {
    this.preparePlayback(true);
  }

  onPlaybackError(): void {
    this.streamUrl = '';
    this.autoPlay = false;
    this.playbackState = 'error';
  }

  private preparePlayback(autoplay: boolean): void {
    if (!this.recipeId || !this.videoId || !this.video || this.playbackState === 'preparing')
      return;
    this.playbackRequest?.unsubscribe();
    this.playbackState = 'preparing';
    this.autoPlay = autoplay;
    this.playbackRequest = this.recipeService
      .prepareStepVideoPlayback(this.recipeId, this.videoId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ready) => {
        if (!ready) {
          this.playbackState = 'error';
          this.autoPlay = false;
          return;
        }
        this.streamUrl = this.recipeService.stepVideoStreamUrl(this.recipeId, this.videoId);
        this.playbackState = 'ready';
      });
  }

  private shouldAutoplay(): boolean {
    const view = this.document.defaultView;
    const reduceMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const connection = (
      view?.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined
    )?.connection;
    return !reduceMotion && connection?.saveData !== true;
  }
}
