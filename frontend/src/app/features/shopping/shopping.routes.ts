import { Routes } from '@angular/router';

export const SHOPPING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./shopping-lists.component').then(m => m.ShoppingListsComponent)
  },
  {
    path: ':id',
    loadComponent: () => import('./shopping-list-detail.component').then(m => m.ShoppingListDetailComponent)
  }
];
