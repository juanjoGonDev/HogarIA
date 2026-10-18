import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { TranslationBundleName } from './index';
import { I18nService } from '../services/i18n.service';

/** Resolve a route's dictionaries before Angular renders its page. */
export function translationBundlesResolver(
  ...bundles: TranslationBundleName[]
): ResolveFn<boolean> {
  return () =>
    inject(I18nService)
      .loadTranslations(...bundles)
      .then(() => true);
}
