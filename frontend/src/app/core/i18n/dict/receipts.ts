// Diccionario del dominio `receipts`: la lectura de tickets por IA (HOGARIA-SPEC ## 12aj).
// Aquí vive lo que la pantalla dice —estados de la cola, revisión de líneas, confirmación—.
// No va aquí lo que se le envía al modelo (eso es `ticket-prompt.ts`, en el server).
export const receiptsEs = {
  'receipts.titulo': 'Tickets',
  'receipts.subtitulo':
    'Sube un ticket (imagen o PDF) y la IA saca líneas, tienda y precios. Nada toca el inventario hasta que lo confirmas.',
  'receipts.suelta_el_ticket_aqui': 'Suelta el ticket aquí',
  'receipts.o_elige_el_fichero': 'o elige el fichero',
  'receipts.formatos_y_tamano': 'PNG, JPEG, WebP o PDF · máximo 10 MB',
  'receipts.subiendo': 'Subiendo…',
  'receipts.eso_no_es_un_ticket': 'Eso no es una imagen ni un PDF',
  'receipts.pesa_demasiado': 'El ticket pesa más de 10 MB',
  'receipts.no_se_ha_podido': 'No se ha podido subir el ticket',
  'receipts.error_operacion': 'No se pudo completar la operación.',
  'receipts.sin_tickets': 'Aún no hay tickets',
  'receipts.sin_tickets_hint':
    'Sube el primero: la IA leerá las líneas y tú las revisas antes de tocar el inventario.',
  'receipts.historial': 'Historial',
  'receipts.historial_vacio': 'Los tickets terminados aparecerán aquí.',
  'receipts.historial_error': 'No se pudo cargar el historial.',
  'receipts.reintentar_historial': 'Reintentar',
  'receipts.cargar_mas_historial': 'Cargar más',
  'receipts.fecha_compra': 'Fecha de compra',
  'receipts.fecha_no_detectada': 'Sin fecha',
  'receipts.subido': 'Subido',
  'receipts.abrir_ticket': 'Abrir ticket',
  'receipts.ver_el_fichero': 'Ver el fichero original',
  'receipts.volver_a_tickets': 'Volver a tickets',

  // ── el pipeline ──
  'receipts.estado.queued': 'En cola',
  'receipts.estado.analyzing': 'Leyendo…',
  'receipts.estado.review': 'A revisar',
  'receipts.estado.confirmed': 'Confirmado',
  'receipts.estado.failed': 'Falló',
  'receipts.estado.stopped': 'Parado',

  'receipts.leyendo_el_ticket': 'Leyendo el ticket…',
  'receipts.leyendo_hint': 'Las líneas van apareciendo según la IA las lee.',
  'receipts.lineas': '{n} líneas',
  'receipts.una_linea': '1 línea',
  'receipts.nada_leido_todavia': 'Todavía no ha leído nada',
  'receipts.error.NO_CONFIG': 'No hay configuración de IA: encaja el proveedor en Ajustes → IA',
  'receipts.error.BAD_JSON': 'El modelo no contestó con una estructura válida',
  'receipts.error.TIMEOUT': 'El proveedor tardó demasiado en contestar',
  'receipts.error.PROVIDER': 'El proveedor de IA falló',
  'receipts.error.WORKER_STALLED':
    'El worker del servidor dejó de responder. Copia el diagnóstico para ver la última etapa alcanzada.',
  'receipts.error.WORKER_EXCEPTION':
    'El worker del servidor falló inesperadamente. Copia el diagnóstico para consultar el detalle seguro.',
  'receipts.error.FILE_MISSING':
    'No encontramos el archivo original en el servidor. Vuelve a subir el ticket para leerlo.',
  'receipts.error.PROVIDER_AUTH':
    'El proveedor rechazó la autenticación. Revisa la clave y la configuración en Ajustes → IA.',
  'receipts.error.PROVIDER_RATE_LIMIT':
    'El proveedor limitó las solicitudes (HTTP 429). Espera un poco y revisa tu cuota.',
  'receipts.error.PROVIDER_SERVER':
    'El proveedor devolvió un error del servidor (HTTP 5xx). Inténtalo más tarde.',
  'receipts.error.PROVIDER_UNSUPPORTED_PARAMETER':
    'El proveedor rechazó temperature o top_p para este modelo. Revisa los ajustes del proveedor y del modelo en Ajustes → IA.',
  'receipts.error.PROVIDER_FILE_INPUT':
    'El proveedor rechazó un archivo adjunto (ticket o inventario). Revisa que admita su formato y tipo.',
  'receipts.copy_diagnostic': 'Copiar diagnóstico',
  'receipts.copy_diagnostic_success': 'Diagnóstico copiado.',
  'receipts.copy_diagnostic_failed':
    'No se pudo copiar el diagnóstico. Revisa el permiso del portapapeles.',

  // ── la revisión ──
  'receipts.tienda': 'Tienda',
  'receipts.tienda_no_detectada': 'Tienda no detectada',
  'receipts.direccion_tienda': 'Dirección de la tienda',
  'receipts.guardar_metadatos': 'Guardar cambios',
  'receipts.metadatos_guardados': 'Cambios guardados',
  'receipts.metadatos_error': 'No se pudieron guardar. Puedes reintentarlo.',
  'receipts.notas': 'Notas',
  'receipts.nota_linea': 'Nota de',
  'receipts.nota_vacia': 'Añadir nota…',
  'receipts.nombre': 'Nombre',
  'receipts.cantidad': 'Cant.',
  'receipts.cantidad_accesible': 'Cantidad',
  'receipts.unidad': 'Unidad',
  'receipts.categoria': 'Categoría',
  'receipts.precio': 'Precio',
  'receipts.oferta': 'Oferta',
  'receipts.oferta_de': 'Oferta de {name}',
  'receipts.editar_oferta': 'Editar oferta',
  'receipts.editar_oferta_de': 'Editar oferta de {name}. Ahora: {summary}.',
  'receipts.anadir_oferta': 'Añadir',
  'receipts.tipo_de_oferta': 'Tipo de oferta',
  'receipts.sin_descuento': 'Sin descuento',
  'receipts.porcentaje': 'Porcentaje',
  'receipts.importe_euros': 'Importe (€)',
  'receipts.personalizada': 'Personalizada',
  'receipts.ofertas_rapidas': 'Ofertas rápidas',
  'receipts.descuento_porcentaje': 'Descuento (%)',
  'receipts.descuento_importe': 'Descuento total (€)',
  'receipts.descuento_porcentaje_hint':
    'Se aplica a las unidades seleccionadas. Debe ser mayor que 0 y menor que 100; máximo 2 decimales.',
  'receipts.descuento_importe_total_hint':
    'Debe ser mayor que 0. Se descuenta una sola vez del conjunto de unidades seleccionadas, no por unidad; máximo 2 decimales.',
  'receipts.unidades_afectadas': 'Unidades con descuento',
  'receipts.unidades_afectadas_hint':
    'De {quantity} unidades. Déjalo vacío para aplicarlo a todas.',
  'receipts.unidades_compradas': 'Llevas',
  'receipts.unidades_pagadas': 'Pagas',
  'receipts.oferta_personalizada_hint': 'Indica cuántas unidades llevas y cuántas pagas.',
  'receipts.promocion_informativa_hint':
    'La oferta es informativa: no modifica el importe ya pagado que figura en el ticket.',
  'receipts.preview_promotion_offer':
    '{buy}x{take}: regala {free} de cada grupo de {buy} unidades.',
  'receipts.preview_promotion_percent': '{percent} % de descuento sobre {units} unidades.',
  'receipts.preview_promotion_amount': 'Descuento total de {amount} € sobre {units} unidades.',
  'receipts.guardar_oferta': 'Guardar oferta',
  'receipts.descuento_valor_invalido':
    'El importe debe ser mayor que 0; el porcentaje, mayor que 0 y menor que 100. Usa hasta 2 decimales.',
  'receipts.descuento_unidades_invalidas':
    'Indica unidades mayores que cero y no superiores a la cantidad de la línea.',
  'receipts.oferta_personalizada_invalida':
    'La oferta debe llevar al menos 2 unidades y hacer pagar menos unidades.',
  'receipts.promocion_guardado_error': 'No se pudo guardar la oferta. Puedes reintentarlo.',
  'receipts.anadir_linea': 'Añadir línea',
  'receipts.borrar_linea': 'Quitar la línea',
  'receipts.total_del_ticket': 'Total del ticket',
  'receipts.suma_de_lineas': 'Suma de líneas',
  'receipts.no_cuadra': 'No cuadra con el total del ticket',
  'receipts.avisos': 'Avisos de la lectura',
  'receipts.lineas_editables_hint':
    'Cada línea se puede retocar entera: nombre, cantidad, categoría, precio, oferta, nota.',

  // ── confirmar ──
  'receipts.confirmar': 'Confirmar y subir al inventario',
  'receipts.confirmado': 'Compra en el inventario',
  'receipts.confirmado_detalle':
    '{precios} precios apuntados · {nuevas} fichas nuevas · {sumadas} fichas que ya estaban',
  'receipts.ver_inventario': 'Ver el inventario',

  // ── parar / reintentar ──
  'receipts.reintentar': 'Volver a leer',
  'receipts.quitar_de_la_cola': 'Quitar de la cola',
  'receipts.queue_entry_removed_announcement': 'Lectura quitada de la cola.',
  'receipts.parar': 'Parar',
  'receipts.parar_todo': 'Parar todo',
  'receipts.borrar': 'Borrar',
  'receipts.borrar_el_ticket': 'Borrar el ticket',
  'receipts.ticket_borrado': 'Ticket borrado',

  // ── el icono de la cola ──
  'receipts.cola_de_lectura': 'Cola de lectura de tickets',
  'receipts.nada_en_cola': 'Nada en la cola',
  'receipts.nada_en_cola_hint': 'Los tickets que subas se leen aquí, uno a uno.',
  'receipts.en_curso': 'En curso',
  'receipts.en_cola_n': 'En cola: {n}',
  'receipts.fallo_n': 'Con fallos: {n}',
  'receipts.intentos': 'intento {n} de {m}',
  'receipts.abrir': 'Abrir',
  'receipts.parado': 'Parado'
} as const;

export const receiptsEn: Record<keyof typeof receiptsEs, string> = {
  'receipts.titulo': 'Receipts',
  'receipts.subtitulo':
    'Upload a receipt (image or PDF) and the AI pulls out lines, store and prices. Nothing touches the inventory until you confirm.',
  'receipts.suelta_el_ticket_aqui': 'Drop the receipt here',
  'receipts.o_elige_el_fichero': 'or pick the file',
  'receipts.formatos_y_tamano': 'PNG, JPEG, WebP or PDF · 10 MB max',
  'receipts.subiendo': 'Uploading…',
  'receipts.eso_no_es_un_ticket': "That's neither an image nor a PDF",
  'receipts.pesa_demasiado': 'The receipt is over 10 MB',
  'receipts.no_se_ha_podido': "Couldn't upload the receipt",
  'receipts.error_operacion': "Couldn't complete the operation.",
  'receipts.sin_tickets': 'No receipts yet',
  'receipts.sin_tickets_hint':
    'Upload the first one: the AI will read the lines and you review them before touching the inventory.',
  'receipts.historial': 'History',
  'receipts.historial_vacio': 'Completed receipts will appear here.',
  'receipts.historial_error': 'Could not load history.',
  'receipts.reintentar_historial': 'Retry',
  'receipts.cargar_mas_historial': 'Load more',
  'receipts.fecha_compra': 'Purchase date',
  'receipts.fecha_no_detectada': 'No date',
  'receipts.subido': 'Uploaded',
  'receipts.abrir_ticket': 'Open receipt',
  'receipts.ver_el_fichero': 'View the original file',
  'receipts.volver_a_tickets': 'Back to receipts',

  'receipts.estado.queued': 'Queued',
  'receipts.estado.analyzing': 'Reading…',
  'receipts.estado.review': 'To review',
  'receipts.estado.confirmed': 'Confirmed',
  'receipts.estado.failed': 'Failed',
  'receipts.estado.stopped': 'Stopped',

  'receipts.leyendo_el_ticket': 'Reading the receipt…',
  'receipts.leyendo_hint': 'Lines appear as the AI reads them.',
  'receipts.lineas': '{n} lines',
  'receipts.una_linea': '1 line',
  'receipts.nada_leido_todavia': 'Nothing read yet',
  'receipts.error.NO_CONFIG': 'No AI configuration: set the provider up in Settings → AI',
  'receipts.error.BAD_JSON': "The model didn't answer with a valid structure",
  'receipts.error.TIMEOUT': 'The provider took too long to answer',
  'receipts.error.PROVIDER': 'The AI provider failed',
  'receipts.error.WORKER_STALLED':
    'The server worker stopped responding. Copy diagnostics to see the last reached stage.',
  'receipts.error.WORKER_EXCEPTION':
    'The server worker failed unexpectedly. Copy diagnostics for the safe details.',
  'receipts.error.FILE_MISSING':
    'The original file is no longer available on the server. Upload the receipt again to read it.',
  'receipts.error.PROVIDER_AUTH':
    'The provider rejected authentication. Check the key and configuration in Settings → AI.',
  'receipts.error.PROVIDER_RATE_LIMIT':
    'The provider rate-limited the request (HTTP 429). Wait and check your quota.',
  'receipts.error.PROVIDER_SERVER':
    'The provider returned a server error (HTTP 5xx). Try again later.',
  'receipts.error.PROVIDER_UNSUPPORTED_PARAMETER':
    'The provider rejected temperature or top_p for this model. Review the provider and model settings in Settings → AI.',
  'receipts.error.PROVIDER_FILE_INPUT':
    'The provider rejected an attached file (receipt or inventory). Check that its format and type are supported.',
  'receipts.copy_diagnostic': 'Copy diagnostics',
  'receipts.copy_diagnostic_success': 'Diagnostics copied.',
  'receipts.copy_diagnostic_failed': 'Could not copy diagnostics. Check clipboard permission.',

  'receipts.tienda': 'Store',
  'receipts.tienda_no_detectada': 'Store not detected',
  'receipts.direccion_tienda': 'Store address',
  'receipts.guardar_metadatos': 'Save changes',
  'receipts.metadatos_guardados': 'Changes saved',
  'receipts.metadatos_error': "Couldn't save changes. You can retry.",
  'receipts.notas': 'Notes',
  'receipts.nota_linea': 'Note for',
  'receipts.nota_vacia': 'Add a note…',
  'receipts.nombre': 'Name',
  'receipts.cantidad': 'Qty',
  'receipts.cantidad_accesible': 'Quantity',
  'receipts.unidad': 'Unit',
  'receipts.categoria': 'Category',
  'receipts.precio': 'Price',
  'receipts.oferta': 'Offer',
  'receipts.oferta_de': 'Offer for {name}',
  'receipts.editar_oferta': 'Edit offer',
  'receipts.editar_oferta_de': 'Edit offer for {name}. Current: {summary}.',
  'receipts.anadir_oferta': 'Add',
  'receipts.tipo_de_oferta': 'Offer type',
  'receipts.sin_descuento': 'No discount',
  'receipts.porcentaje': 'Percentage',
  'receipts.importe_euros': 'Amount (€)',
  'receipts.personalizada': 'Custom',
  'receipts.ofertas_rapidas': 'Quick offers',
  'receipts.descuento_porcentaje': 'Discount (%)',
  'receipts.descuento_importe': 'Total discount (€)',
  'receipts.descuento_porcentaje_hint':
    'Applies to the selected units. Must be greater than 0 and below 100; up to 2 decimals.',
  'receipts.descuento_importe_total_hint':
    'Must be greater than 0. Deducted once from the selected units as a whole, not per unit; up to 2 decimals.',
  'receipts.unidades_afectadas': 'Units with discount',
  'receipts.unidades_afectadas_hint': 'Out of {quantity} units. Leave blank to apply to all.',
  'receipts.unidades_compradas': 'You take',
  'receipts.unidades_pagadas': 'You pay for',
  'receipts.oferta_personalizada_hint': 'Enter how many units you take and how many you pay for.',
  'receipts.promocion_informativa_hint':
    'The offer is informational: it does not change the amount already paid on the receipt.',
  'receipts.preview_promotion_offer': '{buy}x{take}: {free} free from each group of {buy}.',
  'receipts.preview_promotion_percent': '{percent}% discount on {units} units.',
  'receipts.preview_promotion_amount': 'Total discount of €{amount} on {units} units.',
  'receipts.guardar_oferta': 'Save offer',
  'receipts.descuento_valor_invalido':
    'Amount must be greater than 0; percentage must be greater than 0 and below 100. Use up to 2 decimals.',
  'receipts.descuento_unidades_invalidas':
    'Enter units greater than zero and no greater than the line quantity.',
  'receipts.oferta_personalizada_invalida':
    'The offer must include at least 2 units and make you pay for fewer units.',
  'receipts.promocion_guardado_error': 'Could not save the offer. You can try again.',
  'receipts.anadir_linea': 'Add line',
  'receipts.borrar_linea': 'Remove line',
  'receipts.total_del_ticket': 'Receipt total',
  'receipts.suma_de_lineas': 'Sum of lines',
  'receipts.no_cuadra': "Doesn't match the receipt total",
  'receipts.avisos': 'Reading warnings',
  'receipts.lineas_editables_hint':
    'Every line is fully editable: name, quantity, category, price, offer, note.',

  'receipts.confirmar': 'Confirm and add to inventory',
  'receipts.confirmado': 'Shopping in the inventory',
  'receipts.confirmado_detalle':
    '{precios} prices recorded · {nuevas} new items · {sumadas} items that already existed',
  'receipts.ver_inventario': 'View inventory',

  'receipts.reintentar': 'Read again',
  'receipts.quitar_de_la_cola': 'Remove from queue',
  'receipts.queue_entry_removed_announcement': 'Reading removed from the queue.',
  'receipts.parar': 'Stop',
  'receipts.parar_todo': 'Stop all',
  'receipts.borrar': 'Delete',
  'receipts.borrar_el_ticket': 'Delete the receipt',
  'receipts.ticket_borrado': 'Receipt deleted',

  'receipts.cola_de_lectura': 'Receipt reading queue',
  'receipts.nada_en_cola': 'Nothing in the queue',
  'receipts.nada_en_cola_hint': 'Receipts you upload are read here, one at a time.',
  'receipts.en_curso': 'Running',
  'receipts.en_cola_n': 'Queued: {n}',
  'receipts.fallo_n': 'Failed: {n}',
  'receipts.intentos': 'attempt {n} of {m}',
  'receipts.abrir': 'Open',
  'receipts.parado': 'Stopped'
};
