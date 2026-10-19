/**
 * Configuracion: modulos encendidos, tema e idioma.
 *
 * Un fichero por dominio porque con 600 claves en el service cada retoque habria generado conflictos
 * en todas las tandas a la vez. `as const` no es decoracion: es lo que da el tipo union de claves y, con
 * el `Record<keyof typeof es, string>` del lado ingles, hace que **una traduccion que falte sea un error
 * de compilacion** en lugar de una pantalla medio en espanol.
 */
export const settingsEs = {
  'settings.themeDetected': 'Detectado: {theme}',
  'settings.today': 'Hoy',
  'settings.expiryDays': 'Avisar antes de caducidad (días)',
  'settings.expiryDaysHint': 'Incluye productos ya caducados. El valor inicial es 3 días.',
  'settings.expiryDaysError': 'Elige un número entero entre 1 y 30.',
  'settings.lang.auto': 'Detectar automáticamente',
  'settings.lang.en': 'English',
  'settings.lang.es': 'Español',
  'settings.language': 'Idioma',
  'settings.modules': 'Módulos',
  'settings.modulesAllOn': 'Sin marcar: se enseñan todas las secciones que trae esta version.',
  'settings.modulesFailed': 'No se pudo guardar el cambio; se ha vuelto al estado anterior.',
  'settings.modulesHint':
    'Qué secciones de HogarIA tienes encendidas. Se aplican al momento, sin recargar.',
  'settings.modulesReset': 'Volver a ver todas las secciones disponibles',
  'settings.modulesSoon': 'pronto',
  'settings.theme': 'Tema',
  'settings.theme.dark': 'Oscuro',
  'settings.theme.light': 'Claro',
  'settings.theme.system': 'Sistema',
  'settings.title': 'Configuración'
} as const;

export const settingsEn: Record<keyof typeof settingsEs, string> = {
  'settings.themeDetected': 'Detected: {theme}',
  'settings.today': 'Today',
  'settings.expiryDays': 'Expiry warning window (days)',
  'settings.expiryDaysHint': 'Includes items that have already expired. The default is 3 days.',
  'settings.expiryDaysError': 'Choose a whole number from 1 to 30.',
  'settings.lang.auto': 'Auto-detect',
  'settings.lang.en': 'English',
  'settings.lang.es': 'Spanish',
  'settings.language': 'Language',
  'settings.modules': 'Modules',
  'settings.modulesAllOn': 'Nothing selected: every section this build ships is shown.',
  'settings.modulesFailed': 'Could not save the change; reverted to the previous state.',
  'settings.modulesHint':
    'Which HogarIA sections you have switched on. Applied right away, no reload.',
  'settings.modulesReset': 'Show every available section again',
  'settings.modulesSoon': 'soon',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.system': 'System',
  'settings.title': 'Settings'
};
