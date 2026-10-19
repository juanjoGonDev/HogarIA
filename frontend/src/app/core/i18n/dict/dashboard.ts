/**
 * La portada, con el nombre de quien entra y lo de hoy.
 *
 * Un fichero por dominio porque con 600 claves en el service cada retoque habria generado conflictos
 * en todas las tandas a la vez. `as const` no es decoracion: es lo que da el tipo union de claves y, con
 * el `Record<keyof typeof es, string>` del lado ingles, hace que **una traduccion que falte sea un error
 * de compilacion** en lugar de una pantalla medio en espanol.
 */
export const dashboardEs = {
  'dashboard.aiQueueCounts': 'En espera: {queued} · En curso: {running} · Fallidos: {failed}',
  'dashboard.aiQueueLoadError': 'No se pudieron cargar los trabajos de IA.',
  'dashboard.aiQueueLoading': 'Cargando los trabajos de IA…',
  'dashboard.aiQueueProviderLoadError': 'No se pudo cargar la cola de {provider}.',
  'dashboard.aiQueueProviderLoading': 'Cargando la cola de {provider}…',
  'dashboard.aiQueueProviderSummary':
    '{provider}: en espera {queued}, en curso {running} y fallidos {failed}',
  'dashboard.aiQueueRetry': 'Reintentar',
  'dashboard.aiQueueTitle': 'Trabajos de IA',
  'dashboard.minutes_short': '{time} min',
  'dashboard.cooked': 'Cocinadas',
  'dashboard.expiryCountShown': 'Vista previa: {count}',
  'dashboard.expiryEmpty': 'No hay productos que caduquen en este plazo',
  'dashboard.expiryLoadError': 'No se pudieron cargar las caducidades.',
  'dashboard.expiryRetry': 'Reintentar',
  'dashboard.expiryStatusDays': 'En {days} días',
  'dashboard.expiryStatusExpired': 'Caducado',
  'dashboard.expiryStatusToday': 'Caduca hoy',
  'dashboard.expiryTitle': 'Caducidades próximas',
  'dashboard.expiryViewAll': 'Ver caducidades →',
  'dashboard.genAI': 'Generar con IA',
  'dashboard.greeting': '¡Hola, {name}!',
  'dashboard.ingredients': 'Ingredientes',
  'dashboard.members': 'Miembros',
  'dashboard.noMeals': 'No hay comidas planificadas para hoy',
  'dashboard.nextMealBadge': 'Siguiente',
  'dashboard.nextMealEmpty': 'No hay más comidas planificadas en los próximos días',
  'dashboard.nextMealLoadError': 'No se pudo cargar la próxima comida.',
  'dashboard.nextMealTitle': 'Próxima comida',
  'dashboard.noSuggested': 'No hay recetas sugeridas',
  'dashboard.pantry': 'Mi Inventario',
  'dashboard.plan': 'Planificar',
  'dashboard.planNow': 'Planificar ahora',
  'dashboard.subtitle': 'Tu casa, de un vistazo',
  'dashboard.suggested': 'Recetas sugeridas',
  'dashboard.todayMeals': 'Comidas de hoy',
  'dashboard.viewAll': 'Ver todo →'
} as const;

export const dashboardEn: Record<keyof typeof dashboardEs, string> = {
  'dashboard.aiQueueCounts': 'Waiting: {queued} · Running: {running} · Failed: {failed}',
  'dashboard.aiQueueLoadError': 'Could not load AI jobs.',
  'dashboard.aiQueueLoading': 'Loading AI jobs…',
  'dashboard.aiQueueProviderLoadError': 'Could not load the {provider} queue.',
  'dashboard.aiQueueProviderLoading': 'Loading the {provider} queue…',
  'dashboard.aiQueueProviderSummary':
    '{provider}: {queued} waiting, {running} running, {failed} failed',
  'dashboard.aiQueueRetry': 'Retry',
  'dashboard.aiQueueTitle': 'AI jobs',
  'dashboard.minutes_short': '{time} min',
  'dashboard.cooked': 'Cooked',
  'dashboard.expiryCountShown': 'Preview: {count}',
  'dashboard.expiryEmpty': 'Nothing expires within this window',
  'dashboard.expiryLoadError': 'Could not load expiry dates.',
  'dashboard.expiryRetry': 'Retry',
  'dashboard.expiryStatusDays': 'In {days} days',
  'dashboard.expiryStatusExpired': 'Expired',
  'dashboard.expiryStatusToday': 'Expires today',
  'dashboard.expiryTitle': 'Expiring soon',
  'dashboard.expiryViewAll': 'View expiries →',
  'dashboard.genAI': 'Generate with AI',
  'dashboard.greeting': 'Hi, {name}!',
  'dashboard.ingredients': 'Ingredients',
  'dashboard.members': 'Members',
  'dashboard.noMeals': 'No meals planned for today',
  'dashboard.nextMealBadge': 'Next',
  'dashboard.nextMealEmpty': 'No more meals are planned in the coming days',
  'dashboard.nextMealLoadError': 'Could not load the next meal.',
  'dashboard.nextMealTitle': 'Next meal',
  'dashboard.noSuggested': 'No suggested recipes',
  'dashboard.pantry': 'My Inventory',
  'dashboard.plan': 'Plan',
  'dashboard.planNow': 'Plan now',
  'dashboard.subtitle': 'Your home at a glance',
  'dashboard.suggested': 'Suggested recipes',
  'dashboard.todayMeals': "Today's meals",
  'dashboard.viewAll': 'See all →'
};
