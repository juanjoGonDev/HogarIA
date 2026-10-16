import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { I18nService } from '../../core/services/i18n.service';

const recipeTranslationsResolver: ResolveFn<boolean> = () =>
  inject(I18nService)
    .loadRecipeTranslations()
    .then(() => true);

export const RECIPES_ROUTES: Routes = [
  {
    path: 'new',
    resolve: { recipeTranslations: recipeTranslationsResolver },
    loadComponent: () => import('./recipe-edit.component').then((m) => m.RecipeEditComponent)
  },
  {
    path: ':id/edit',
    resolve: { recipeTranslations: recipeTranslationsResolver },
    loadComponent: () => import('./recipe-edit.component').then((m) => m.RecipeEditComponent)
  },
  {
    path: '',
    resolve: { recipeTranslations: recipeTranslationsResolver },
    loadComponent: () => import('./recipes.component').then((m) => m.RecipesComponent)
  }
];
