import { Routes } from '@angular/router';

export const RECIPES_ROUTES: Routes = [
  {
    path: 'new',
    loadComponent: () => import('./recipe-edit.component').then((m) => m.RecipeEditComponent)
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./recipe-edit.component').then((m) => m.RecipeEditComponent)
  },
  {
    path: '',
    loadComponent: () => import('./recipes.component').then((m) => m.RecipesComponent)
  }
];
