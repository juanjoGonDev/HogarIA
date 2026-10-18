import { AnimationBuilder } from '@angular/animations';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';

describe('application animation runtime', () => {
  it('does not register Angular animations when the app has no animation triggers', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });

    expect(() => TestBed.inject(AnimationBuilder)).toThrow();
  });
});
