import { Routes } from '@angular/router';

export const RECEIPTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./receipts.component').then((m) => m.ReceiptsComponent)
  },
  {
    path: ':id',
    loadComponent: () => import('./receipt-detail.component').then((m) => m.ReceiptDetailComponent)
  }
];
