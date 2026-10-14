import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { RecipeService } from '../../core/services/recipe.service';
import { RecipeStepVideoCandidate } from '../../shared/models/recipe-step-video';
import { RecipeStepVideoPlayerComponent } from './recipe-step-video-player.component';
import { of } from 'rxjs';

const video: RecipeStepVideoCandidate = {
  id: 'a'.repeat(24),
  title: 'Mezclar verduras',
  author: 'Autora sintética',
  licenseName: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mixing.webm',
  thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Mixing.jpg',
  durationSeconds: 10,
  mimeType: 'video/webm'
};

describe('RecipeStepVideoPlayerComponent', () => {
  let fixture: ComponentFixture<RecipeStepVideoPlayerComponent>;
  let recipeService: jasmine.SpyObj<RecipeService>;
  let matchMediaSpy: jasmine.Spy;
  let originalConnection: PropertyDescriptor | undefined;

  beforeEach(async () => {
    originalConnection = Object.getOwnPropertyDescriptor(navigator, 'connection');
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: false }
    });
    matchMediaSpy = spyOn(window, 'matchMedia').and.returnValue({
      matches: false
    } as MediaQueryList);
    recipeService = jasmine.createSpyObj<RecipeService>('RecipeService', [
      'prepareStepVideoPlayback',
      'stepVideoStreamUrl'
    ]);
    recipeService.prepareStepVideoPlayback.and.returnValue(of(true));
    recipeService.stepVideoStreamUrl.and.returnValue(
      '/api/recipes/recipe-1/step-videos/video-1/stream'
    );
    await TestBed.configureTestingModule({
      imports: [RecipeStepVideoPlayerComponent],
      providers: [
        { provide: RecipeService, useValue: recipeService },
        { provide: I18nService, useValue: { t: (key: string) => key, changeTick: () => 0 } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RecipeStepVideoPlayerComponent);
  });

  afterEach(() => {
    fixture.destroy();
    if (originalConnection) {
      Object.defineProperty(navigator, 'connection', originalConnection);
    } else {
      delete (navigator as Navigator & { connection?: unknown }).connection;
    }
  });

  it('obtains a same-origin playback capability before loading the active clip', () => {
    fixture.componentRef.setInput('recipeId', 'recipe-1');
    fixture.componentRef.setInput('videoId', video.id);
    fixture.componentRef.setInput('video', video);
    fixture.detectChanges();

    expect(recipeService.prepareStepVideoPlayback).toHaveBeenCalledWith('recipe-1', video.id);
    expect(recipeService.stepVideoStreamUrl).toHaveBeenCalledWith('recipe-1', video.id);
    expect(fixture.nativeElement.querySelector('video')?.getAttribute('src')).toBeNull();
    expect(fixture.nativeElement.querySelector('source')?.getAttribute('src')).toBe(
      '/api/recipes/recipe-1/step-videos/video-1/stream'
    );
    expect(fixture.nativeElement.querySelector('video')?.getAttribute('autoplay')).toBe('');
    expect(fixture.nativeElement.querySelector('video')?.getAttribute('crossorigin')).toBe(
      'use-credentials'
    );
  });

  it('waits for a user gesture when reduced motion is enabled', () => {
    matchMediaSpy.and.returnValue({ matches: true } as MediaQueryList);
    fixture.componentRef.setInput('recipeId', 'recipe-1');
    fixture.componentRef.setInput('videoId', video.id);
    fixture.componentRef.setInput('video', video);
    fixture.detectChanges();

    expect(recipeService.prepareStepVideoPlayback).not.toHaveBeenCalled();
    fixture.componentInstance.play();
    fixture.detectChanges();
    expect(recipeService.prepareStepVideoPlayback).toHaveBeenCalledWith('recipe-1', video.id);
  });

  it('honors data saver, retries a media error and stays idle without a selected clip', () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true }
    });
    fixture.componentRef.setInput('recipeId', 'recipe-1');
    fixture.componentRef.setInput('videoId', video.id);
    fixture.componentRef.setInput('video', video);
    fixture.detectChanges();

    expect(recipeService.prepareStepVideoPlayback).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.recipe-step-video__action')).not.toBeNull();
    fixture.componentInstance.play();
    fixture.detectChanges();
    expect(recipeService.prepareStepVideoPlayback).toHaveBeenCalledTimes(1);

    fixture.componentInstance.onPlaybackError();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.recipe-step-video__error button')?.click();
    fixture.detectChanges();
    expect(recipeService.prepareStepVideoPlayback).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('video', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('recipes.cooking.video_unavailable');
  });

  it('exposes a recoverable inline error when authorization or playback fails', () => {
    recipeService.prepareStepVideoPlayback.and.returnValue(of(false));
    fixture.componentRef.setInput('recipeId', 'recipe-1');
    fixture.componentRef.setInput('videoId', video.id);
    fixture.componentRef.setInput('video', video);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('recipes.cooking.video_unavailable');
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });
});
