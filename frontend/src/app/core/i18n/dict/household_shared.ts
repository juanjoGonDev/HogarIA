// Textos de hogar que se muestran fuera de la ruta Hogar; se mantienen en el diccionario inicial.
export const householdSharedEs = {
  'household.ahora_eres_miembro_del': 'Ahora eres miembro del hogar',
  'household.no_se_pudo_actualizar': 'No se pudo actualizar',
  'household.copiado': 'Copiado',
  'household.hogar_activo': 'Hogar activo',
  'household.selecciona_hogar': 'Selecciona un hogar',
  'household.cambiando_hogar': 'Cambiando de hogar…',
  'household.no_se_pudo_cambiar_hogar': 'No se pudo cambiar de hogar. Inténtalo de nuevo.',
  'household.automation.title': 'Automatización semanal',
  'household.automation.description':
    'Elige qué planificar, cómo hacerlo y cuándo se ejecutará cada semana.',
  'household.automation.loading': 'Cargando automatización…',
  'household.automation.load_error': 'No se pudo cargar la configuración automática.',
  'household.automation.retry': 'Reintentar',
  'household.automation.read_only': 'Puedes consultar la configuración, pero no cambiarla.',
  'household.automation.mode': 'Qué debe hacer',
  'household.automation.generate': 'Generar una planificación nueva con IA',
  'household.automation.generate_help':
    'Prepara tareas, comidas o ambas; solo publica el plan cuando todas las partes sean válidas.',
  'household.automation.repeat': 'Repetir la última planificación confirmada',
  'household.automation.repeat_help':
    'Copia la última semana confirmada a nuevas fechas sin volver a llamar a la IA.',
  'household.automation.scopes': 'Qué incluir',
  'household.automation.tasks': 'Tareas del hogar',
  'household.automation.meals': 'Comidas',
  'household.automation.weekday': 'Día de la semana',
  'household.automation.select_weekday': 'Elige un día',
  'household.automation.monday': 'Lunes',
  'household.automation.tuesday': 'Martes',
  'household.automation.wednesday': 'Miércoles',
  'household.automation.thursday': 'Jueves',
  'household.automation.friday': 'Viernes',
  'household.automation.saturday': 'Sábado',
  'household.automation.sunday': 'Domingo',
  'household.automation.local_time': 'Hora local',
  'household.automation.time_zone': 'Zona horaria IANA',
  'household.automation.time_zone_placeholder': 'Europe/Madrid',
  'household.automation.time_zone_help':
    'Escribe la zona del hogar, por ejemplo Europe/Madrid. No se usa la zona del dispositivo ni del servidor.',
  'household.automation.invalid_schedule':
    'Selecciona al menos un tipo de planificación e indica el día, la hora y una zona IANA válida.',
  'household.automation.save': 'Guardar configuración',
  'household.automation.saving': 'Guardando configuración…',
  'household.automation.saved':
    'Configuración guardada. Actívala desde el aviso fijo cuando quieras.',
  'household.automation.save_error':
    'No se pudo guardar. Tus cambios siguen aquí; vuelve a intentarlo.',
  'household.automation.permission_error':
    'Tus permisos han cambiado. Recarga el hogar antes de volver a intentarlo.',
  'household.automation.version_conflict':
    'La configuración cambió en otra pestaña. Recarga la versión actual antes de guardar.',
  'household.automation.reload_current': 'Cargar configuración actual',
  'household.automation.notice_title': 'Próxima planificación automática',
  'household.automation.notice_active': '{dateTime} · {timeZone}',
  'household.automation.notice_paused': 'Planificación pausada',
  'household.automation.notice_paused_schedule':
    'Se ejecutará cada {day} a las {time} · {timeZone}',
  'household.automation.notice_loading': 'Consultando la próxima ejecución…',
  'household.automation.notice_next_unavailable': 'No se recibió la próxima fecha de ejecución.',
  'household.automation.notice_load_error': 'No se pudo consultar la planificación automática.',
  'household.automation.notice_pause': 'Pausar planificación automática',
  'household.automation.notice_resume': 'Reanudar planificación automática',
  'household.automation.notice_toggling': 'Actualizando estado…',
  'household.automation.notice_toggle_error': 'No se pudo cambiar el estado. Inténtalo de nuevo.',
  'household.automation.notice_permission':
    'No tienes permiso para cambiar la automatización de este hogar.',
  'household.automation.notice_activate_permission':
    'Necesitas permiso para editar el calendario para activar la planificación automática.',
  'household.automation.last_run': 'Última ejecución registrada',
  'household.automation.target_week': 'Semana planificada',
  'household.automation.updated_at': 'Última actualización',
  'household.automation.run_status_in_progress': 'En curso',
  'household.automation.run_status_review_required': 'Revisión necesaria',
  'household.automation.run_status_completed': 'Completada',
  'household.automation.run_status_cancelled': 'Cancelada',
  'household.automation.run_status_skipped': 'Omitida',
  'household.automation.run_status_unknown': 'Estado no disponible',
  'household.automation.review_required_help':
    'La ejecución no se confirmó. Comprueba el estado antes de solicitar otro intento.',
  'household.automation.review_retry': 'Revisar y reintentar',
  'household.automation.retrying': 'Enviando la solicitud y actualizando el estado…',
  'household.automation.retry_accepted': 'La solicitud se aceptó. El estado se ha actualizado.',
  'household.automation.refresh_run': 'Actualizar estado',
  'household.automation.retry_refresh_error':
    'No se pudo confirmar el estado actual. Actualízalo antes de volver a intentarlo.',
  'household.automation.retry_error':
    'No se pudo confirmar el resultado del intento. Actualiza el estado antes de volver a intentarlo.',
  'household.automation.retry_busy': 'Ya hay una ejecución en curso para esa semana.',
  'household.automation.retry_already_completed': 'Esa planificación ya se completó.',
  'household.automation.retry_review_required':
    'La ejecución requiere revisión antes de continuar.',
  'household.automation.retry_cancelled': 'Esa ejecución fue cancelada y no puede reintentarse.',
  'household.automation.retry_stale_config':
    'La configuración cambió. Actualiza el estado y revisa los ajustes actuales.',
  'household.automation.retry_authorization_invalid':
    'La autorización ya no es válida. Comprueba la configuración de acceso del hogar.',
  'household.automation.retry_not_authorized':
    'No tienes permiso para reintentar esta planificación.',
  'household.automation.retry_skipped': 'Esa ejecución se omitió y no puede reintentarse.',
  'household.automation.retry_not_retryable': 'Esa ejecución no admite otro intento.',
  'household.automation.retry_not_found': 'No se encontró la ejecución que querías revisar.'
} as const;

export const householdSharedEn: Record<keyof typeof householdSharedEs, string> = {
  'household.ahora_eres_miembro_del': 'You are now a member of the household',
  'household.no_se_pudo_actualizar': 'Could not update',
  'household.copiado': 'Copied',
  'household.hogar_activo': 'Active household',
  'household.selecciona_hogar': 'Select a household',
  'household.cambiando_hogar': 'Switching household…',
  'household.no_se_pudo_cambiar_hogar': 'Could not switch household. Please try again.',
  'household.automation.title': 'Weekly automation',
  'household.automation.description': 'Choose what to plan, how, and when it runs each week.',
  'household.automation.loading': 'Loading automation…',
  'household.automation.load_error': 'Could not load the automation settings.',
  'household.automation.retry': 'Retry',
  'household.automation.read_only': 'You can view the settings, but cannot change them.',
  'household.automation.mode': 'What to do',
  'household.automation.generate': 'Generate a new plan with AI',
  'household.automation.generate_help':
    'Prepare tasks, meals, or both; publish only when every selected part is valid.',
  'household.automation.repeat': 'Repeat the last confirmed plan',
  'household.automation.repeat_help':
    'Copy the last confirmed week to new dates without calling AI again.',
  'household.automation.scopes': 'What to include',
  'household.automation.tasks': 'Household tasks',
  'household.automation.meals': 'Meals',
  'household.automation.weekday': 'Day of the week',
  'household.automation.select_weekday': 'Choose a day',
  'household.automation.monday': 'Monday',
  'household.automation.tuesday': 'Tuesday',
  'household.automation.wednesday': 'Wednesday',
  'household.automation.thursday': 'Thursday',
  'household.automation.friday': 'Friday',
  'household.automation.saturday': 'Saturday',
  'household.automation.sunday': 'Sunday',
  'household.automation.local_time': 'Local time',
  'household.automation.time_zone': 'IANA time zone',
  'household.automation.time_zone_placeholder': 'Europe/Madrid',
  'household.automation.time_zone_help':
    'Enter the household time zone, for example Europe/Madrid. The device/server zone is not used.',
  'household.automation.invalid_schedule':
    'Select at least one planning type and enter a day, time, and valid IANA time zone.',
  'household.automation.save': 'Save settings',
  'household.automation.saving': 'Saving settings…',
  'household.automation.saved': 'Settings saved. Start it from the persistent notice when ready.',
  'household.automation.save_error': 'Could not save. Your changes are still here; try again.',
  'household.automation.permission_error':
    'Your permissions changed. Reload the household before trying again.',
  'household.automation.version_conflict':
    'The settings changed in another tab. Reload the current version before saving.',
  'household.automation.reload_current': 'Load current settings',
  'household.automation.notice_title': 'Next automatic plan',
  'household.automation.notice_active': '{dateTime} · {timeZone}',
  'household.automation.notice_paused': 'Planning is paused',
  'household.automation.notice_paused_schedule': 'Scheduled for {day} at {time} · {timeZone}',
  'household.automation.notice_loading': 'Checking the next run…',
  'household.automation.notice_next_unavailable': 'The next run date was not returned.',
  'household.automation.notice_load_error': 'Could not check the automatic plan.',
  'household.automation.notice_pause': 'Pause automatic planning',
  'household.automation.notice_resume': 'Resume automatic planning',
  'household.automation.notice_toggling': 'Updating status…',
  'household.automation.notice_toggle_error': 'Could not change the status. Try again.',
  'household.automation.notice_permission':
    'You do not have permission to change this household automation.',
  'household.automation.notice_activate_permission':
    'Calendar edit permission is required to start automatic planning.',
  'household.automation.last_run': 'Latest recorded run',
  'household.automation.target_week': 'Planned week',
  'household.automation.updated_at': 'Last updated',
  'household.automation.run_status_in_progress': 'In progress',
  'household.automation.run_status_review_required': 'Review required',
  'household.automation.run_status_completed': 'Completed',
  'household.automation.run_status_cancelled': 'Cancelled',
  'household.automation.run_status_skipped': 'Skipped',
  'household.automation.run_status_unknown': 'Status unavailable',
  'household.automation.review_required_help':
    'The run was not confirmed. Check its status before requesting another attempt.',
  'household.automation.review_retry': 'Review and retry',
  'household.automation.retrying': 'Submitting the request and refreshing its status…',
  'household.automation.retry_accepted': 'The request was accepted. Its status has been refreshed.',
  'household.automation.refresh_run': 'Refresh status',
  'household.automation.retry_refresh_error':
    'Could not confirm the current status. Refresh it before trying again.',
  'household.automation.retry_error':
    'Could not confirm the retry result. Refresh its status before trying again.',
  'household.automation.retry_busy': 'A run for that week is already in progress.',
  'household.automation.retry_already_completed': 'That plan has already completed.',
  'household.automation.retry_review_required': 'The run needs review before it can continue.',
  'household.automation.retry_cancelled': 'That run was cancelled and cannot be retried.',
  'household.automation.retry_stale_config':
    'The settings changed. Refresh the status and review the current settings.',
  'household.automation.retry_authorization_invalid':
    'Authorization is no longer valid. Check the household access configuration.',
  'household.automation.retry_not_authorized': 'You are not allowed to retry this plan.',
  'household.automation.retry_skipped': 'That run was skipped and cannot be retried.',
  'household.automation.retry_not_retryable': 'That run cannot be retried.',
  'household.automation.retry_not_found': 'The run you tried to review could not be found.'
};
