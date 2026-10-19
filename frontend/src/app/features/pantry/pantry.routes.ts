import { Routes } from '@angular/router';

export const PANTRY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pantry.component').then(m => m.PantryComponent)
  },
  // La ficha del articulo de inventario (## 12ai): detalle con sus caracteristicas y su historia
  // de precios por tienda; la edicion es su propia pantalla, no un modal —pedida asi—. Ambas
  // viven en su URL para que un F5 o el boton atras signifiquen lo mismo que en el resto.
  // Las caducidades (## 12ak): la despensa ordenada por lo que se tira antes, con su grafica
  // y su ritmo de compra. Pantalla propia, no tab del gestor: se entra desde la despensa y
  // desde el aviso del planificador, y su URL se puede compartir igual que la ficha.
  {
    path: 'caducidades',
    loadComponent: () => import('./caducidades.component').then(m => m.CaducidadesComponent)
  },
  {
    path: 'inventario/:id/editar',
    loadComponent: () => import('./pantry-item-edit.component').then(m => m.PantryItemEditComponent)
  },
  {
    path: 'inventario/:id',
    loadComponent: () => import('./pantry-item.component').then(m => m.PantryItemComponent)
  },
  // El gestor del inventario (HOGARIA-SPEC ## 12x): dos pantallas enrutadas, cada una con su ficha, para que
  // un F5 a media edicion no la tire y el boton atras del navegador signifique lo que significa en el resto
  // de la app. `new` es el alta, no un modal: misma pantalla, sin fila que editar.
  {
    path: 'categories',
    loadComponent: () => import('./pantry-categories.component').then(m => m.PantryCategoriesComponent)
  },
  {
    path: 'categories/:id',
    loadComponent: () => import('./pantry-categories.component').then(m => m.PantryCategoriesComponent)
  },
  // El visor del catalogo pre-registrado (## 12aa): sin `:id`, la pantalla no tiene ficha —el catalogo no se
  // edita, se recorre y se anade desde la fila—. Su estado (pasillo, busqueda, pagina) viaja en la query.
  {
    path: 'catalogo',
    loadComponent: () => import('./pantry-catalog.component').then(m => m.PantryCatalogComponent)
  },
  {
    path: 'products',
    loadComponent: () => import('./pantry-products.component').then(m => m.PantryProductsComponent)
  },
  {
    path: 'products/:id',
    loadComponent: () => import('./pantry-products.component').then(m => m.PantryProductsComponent)
  }
];
