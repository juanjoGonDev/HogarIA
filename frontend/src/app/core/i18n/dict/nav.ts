/**
 * La navegacion: lo que ve quien entra por la puerta y lo que dice el titulo de la pestana.
 *
 * Un fichero por dominio porque con 600 claves en el service cada retoque habria generado conflictos
 * en todas las tandas a la vez. `as const` no es decoracion: es lo que da el tipo union de claves y, con
 * el `Record<keyof typeof es, string>` del lado ingles, hace que **una traduccion que falte sea un error
 * de compilacion** en lugar de una pantalla medio en espanol.
 */
export const navEs = {
  'app.name': 'HogarIA',
  'nav.ai-config': 'IA Config',
  'nav.calendar': 'Calendario',
  'nav.dashboard': 'Inicio',
  'nav.guest': 'Tu cuenta',
  'nav.household': 'Hogar',
  'nav.logout': 'Cerrar sesión',
  'nav.logs': 'Logs',
  'nav.pantry': 'Inventario',
  'nav.preferences': 'Preferencias',
  'nav.recipes': 'Recetas',
  'nav.receipts': 'Tickets',
  'nav.settings': 'Configuración',
  'nav.shopping': 'Compra',
} as const;

export const navEn: Record<keyof typeof navEs, string> = {
  'app.name': 'HogarIA',
  'nav.ai-config': 'AI Config',
  'nav.calendar': 'Calendar',
  'nav.dashboard': 'Home',
  'nav.guest': 'Your account',
  'nav.household': 'Household',
  'nav.logout': 'Log out',
  'nav.logs': 'Logs',
  'nav.pantry': 'Inventory',
  'nav.preferences': 'Preferences',
  'nav.recipes': 'Recipes',
  'nav.receipts': 'Receipts',
  'nav.settings': 'Settings',
  'nav.shopping': 'Shopping',
};
