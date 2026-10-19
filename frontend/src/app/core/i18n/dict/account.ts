// Diccionario del dominio `account`: texto de la interfaz, lo que la app dice. No va aqui lo que se
// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El `en` lo escribe una persona.
export const accountEs = {
  'account.no_se_pudo_cambiar': 'No se pudo cambiar la contrasena.',
  'account.la_contrasena_actual_no': 'La contrasena actual no es esa.',
  'account.las_dos_contrasenas_nuevas': 'Las dos contrasenas nuevas no coinciden.',
  'account.la_nueva_contrasena_necesita':
    'La nueva contrasena necesita seis caracteres, una mayuscula y un numero.',
  'account.password_max_72_bytes':
    'La contraseña que has escrito no se puede guardar porque es demasiado larga. Prueba con una más corta.',
  'account.password_max_72_bytes_hint':
    'Si aparece un aviso de longitud, prueba con una contraseña más corta.',
  'account.falta_la_contrasena_actual': 'Falta la contrasena actual.',
  'account.no_se_pudo_guardar': 'No se pudo guardar el nombre. Intentalo otra vez.',
  'account.escribe_al_menos_dos': 'Escribe al menos dos caracteres.',
  'account.no_se_pudo_quitar': 'No se pudo quitar la foto.',
  'account.no_se_pudo_subir': 'No se pudo subir la foto. Intentalo otra vez.',
  'account.la_imagen_ha_llegado':
    'La imagen ha llegado al servidor, pero el servidor no ha podido escribirla en disco. La ruta donde intenta guardarla sale en sus logs.',
  'account.el_navegador_no_pudo': 'El navegador no pudo generar la imagen.',
  'account.la_foto_no_se': 'La foto no se pudo leer.',
  'account.la_proxima_vez_entra': 'La proxima vez entra con la nueva.',
  'account.contrasena_cambiada': 'Contrasena cambiada',
  'account.nombre_guardado': 'Nombre guardado',
  'account.imagen_quitada': 'Imagen quitada',
  'account.imagen_cambiada': 'Imagen cambiada',
  'account.tu_foto': 'Tu foto',
  'account.tu_cuenta': 'tu cuenta',
  'account.sustituir_la_foto': 'Sustituir la foto',
  'account.subir_una_foto_para': 'Subir una foto para {name}',
  'account.subir_una_foto': 'Subir una foto',
  'account.la_hora_se_muestra_en':
    'La hora se muestra en {tz}; es la del dispositivo, no hay que configurarla.',
  'account.encuadrar_la_foto': 'Encuadrar la foto',
  'account.cambiar_la_foto_de': 'Cambiar la foto de {name}',
  'account.aparece_en_el_historial':
    'Aparece en el historial de cada lista y en los apuntes de la agenda. Cambiarlo no toca lo que ya paso: se veran tus lineas antiguas con tu nombre de hoy.',
  'account.cambiar_la_contrasena': 'Cambiar la contrasena',
  'account.cerrar_sesion_en_este': 'Cerrar sesion en este dispositivo',
  'account.como_te_llamas_en': 'Como te llamas en casa',
  'account.con_el_que_entras':
    'Con el que entras. No se cambia desde aqui: si se te va, se crea la cuenta con el correo nuevo y se vuelve a invitar a la casa.',
  'account.contrasena_actual': 'Contrasena actual',
  'account.contrasena': 'Contrasena',
  'account.correo': 'Correo',
  'account.cuan_larga_o_cuan': 'Cuan larga o cuan al grano escribe la IA.',
  'account.en_este_navegador': 'En este navegador',
  'account.esta_sesion': 'Esta sesion',
  'account.guardar_el_nombre': 'Guardar el nombre',
  'account.identificador': 'Identificador',
  'account.la_contrasena_se_guarda':
    'La contrasena se guarda con hash: nadie puede leerla, ni esta app. El acceso vive en este navegador, y cerrar aqui no borra nada de la casa.',
  'account.la_foto_guardada_ya':
    'La foto guardada ya no esta en el servidor, y por eso se ve tu inicial en su lugar. Sube otra o quitala.',
  'account.las_listas_y_la': 'Las listas y la agenda compartidas viven ahi.',
  'account.mi_cuenta': 'Mi cuenta',
  'account.nueva_contrasena': 'Nueva contrasena',
  'account.para_nombrar_un_problema': 'Para nombrar un problema en el registro de la app.',
  'account.personas_de_la_casa': 'Personas de la casa',
  'account.pulsa_tu_cara_para':
    'Pulsa tu cara para cambiar la foto: se puede encuadrar y acercar antes de subirla. Sin foto se ve tu inicial sobre un color, y con foto un anillo alrededor.',
  'account.quitar_la_foto': 'Quitar la foto',
  'account.repite_la_nueva_contrasena': 'Repite la nueva contrasena',
  'account.seis_caracteres_como_minimo':
    'Seis caracteres como minimo, con una mayuscula y un numero.',
  'account.sin_casa_solo_lo': 'Sin casa, solo lo tuyo',
  'account.subiendo_la_foto': 'Subiendo la foto...',
  'account.todavia_no_tienes_foto':
    'Todavia no tienes foto. Sube una y recortala donde quieras: se guarda un cuadrado pequeno, no la foto entera del movil.',
  'account.tu_nombre_tu_foto':
    'Tu nombre, tu foto y tu acceso. Lo de comer —alergias, gustos y objetivo— se edita en',
  'account.version': 'Version',
  'account.y_lo_de_la': ', y lo de la casa (las personas y lo que ve cada una) en',
  'account.nada_pendiente_de': 'Nada pendiente de enviar',
  'account.una_escritura_esperando': '1 escritura esperando la red',
  'account.n_escrituras_esperando': '{n} escrituras esperando la red',
  'account.nada_guardado_en': 'Nada guardado en este navegador',
  'account.bytes_en_entradas': '{bytes} in {n} entries',
  'account.pestanja_cuenta': 'Cuenta',
  'account.pestanja_seguridad': 'Seguridad',
  'account.pestanja_informacion': 'Información',
  'account.sin_nivel': 'Sin marcar',
  'account.pw_muy_corta': 'muy corta',
  'account.pw_justa': 'justa',
  'account.pw_razonable': 'razonable',
  'account.pw_buena': 'buena',
  'account.pw_fuerte': 'fuerte'
} as const;

export const accountEn: Record<keyof typeof accountEs, string> = {
  'account.no_se_pudo_cambiar': 'Could not change the password. Try again.',
  'account.la_contrasena_actual_no': 'That is not the current password.',
  'account.las_dos_contrasenas_nuevas': 'The two new passwords do not match.',
  'account.la_nueva_contrasena_necesita':
    'The new password needs six characters, one uppercase letter and one number.',
  'account.password_max_72_bytes':
    'The password you entered is too long to save. Try a shorter one.',
  'account.password_max_72_bytes_hint': 'If you see a length warning, try a shorter password.',
  'account.falta_la_contrasena_actual': 'The current password is missing.',
  'account.no_se_pudo_guardar': 'Could not save the name. Try again.',
  'account.escribe_al_menos_dos': 'Write at least two characters.',
  'account.no_se_pudo_quitar': 'The photo could not be removed.',
  'account.no_se_pudo_subir': 'The photo could not be uploaded. Try again.',
  'account.la_imagen_ha_llegado':
    'The image reached the server, but the server could not write it to disk. Its logs show the path it tried to save to.',
  'account.el_navegador_no_pudo': 'The browser could not create the image.',
  'account.la_foto_no_se': 'The photo could not be read.',
  'account.la_proxima_vez_entra': 'Next time, sign in with the new one.',
  'account.contrasena_cambiada': 'Password changed',
  'account.nombre_guardado': 'Name saved',
  'account.imagen_quitada': 'Image removed',
  'account.imagen_cambiada': 'Image changed',
  'account.tu_foto': 'Your photo',
  'account.tu_cuenta': 'your account',
  'account.sustituir_la_foto': 'Replace the photo',
  'account.subir_una_foto_para': 'Upload a photo for {name}',
  'account.subir_una_foto': 'Upload a photo',
  'account.la_hora_se_muestra_en':
    'Times are shown in {tz}; it is the device’s, there is nothing to configure.',
  'account.encuadrar_la_foto': 'Frame the photo',
  'account.cambiar_la_foto_de': "Change {name}'s photo",
  'account.aparece_en_el_historial':
    "It shows in every list's history and in the calendar notes. Changing it does not touch what already happened: your old lines will appear with today's name.",
  'account.cambiar_la_contrasena': 'Change the password',
  'account.cerrar_sesion_en_este': 'Log out on this device',
  'account.como_te_llamas_en': 'What are you called at home',
  'account.con_el_que_entras':
    'The one you log in with. It cannot be changed here: if you lose it, create the account with the new email and invite the house again.',
  'account.contrasena_actual': 'Current password',
  'account.contrasena': 'Password',
  'account.correo': 'Email',
  'account.cuan_larga_o_cuan': 'How long or how blunt the AI writes.',
  'account.en_este_navegador': 'In this browser',
  'account.esta_sesion': 'This session',
  'account.guardar_el_nombre': 'Save the name',
  'account.identificador': 'Identifier',
  'account.la_contrasena_se_guarda':
    'The password is stored hashed: nobody can read it, not even this app. Access lives in this browser, and logging out here deletes nothing from the house.',
  'account.la_foto_guardada_ya':
    'The saved photo is no longer on the server, which is why your initial shows instead. Upload another one or remove it.',
  'account.las_listas_y_la': 'The shared lists and calendar live there.',
  'account.mi_cuenta': 'My account',
  'account.nueva_contrasena': 'New password',
  'account.para_nombrar_un_problema': "For naming a problem in the app's log.",
  'account.personas_de_la_casa': 'People in the house',
  'account.pulsa_tu_cara_para':
    'Tap your face to change the photo: you can frame and zoom before uploading. Without a photo you see your initial on a colour, with one a ring around it.',
  'account.quitar_la_foto': 'Remove the photo',
  'account.repite_la_nueva_contrasena': 'Repeat the new password',
  'account.seis_caracteres_como_minimo':
    'Six characters at least, with an uppercase letter and a number.',
  'account.sin_casa_solo_lo': 'No household, only yours',
  'account.subiendo_la_foto': 'Uploading the photo...',
  'account.todavia_no_tienes_foto':
    'No photo yet. Upload one and crop it where you like: a small square is stored, not the whole phone picture.',
  'account.tu_nombre_tu_foto':
    'Your name, your photo and your access. Eating — allergies, tastes and goal — is edited in',
  'account.version': 'Version',
  'account.y_lo_de_la': ', and the household (who is in it and what each person sees) in',
  'account.nada_pendiente_de': 'Nothing waiting to be sent',
  'account.una_escritura_esperando': '1 write waiting for the network',
  'account.n_escrituras_esperando': '{n} writes waiting for the network',
  'account.nada_guardado_en': 'Nothing saved in this browser',
  'account.bytes_en_entradas': '{bytes} en {n} entradas',
  'account.pestanja_cuenta': 'Account',
  'account.pestanja_seguridad': 'Security',
  'account.pestanja_informacion': 'About',
  'account.sin_nivel': 'Not set',
  'account.pw_muy_corta': 'very short',
  'account.pw_justa': 'barely enough',
  'account.pw_razonable': 'fair',
  'account.pw_buena': 'good',
  'account.pw_fuerte': 'strong'
};
