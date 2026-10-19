// Diccionario del dominio `avatar_editor`: texto de la interfaz, lo que la app dice. No va aqui lo que se
// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El `en` lo escribe una persona.
export const avatarEditorEs = {
  'avatar_editor.acercar': 'Acercar',
  'avatar_editor.leyendo_la_foto': 'Leyendo la foto...',
  'avatar_editor.alejar': 'Alejar',
  'avatar_editor.arrastra_para_encuadrar_el': 'Arrastra para encuadrar. El circulo es lo que se ver; fuera de el, se recorta.',
  'avatar_editor.mueve_la_foto_con': 'Mueve la foto con el dedo o con las flechas para encuadrar; la rueda o el slider la acercan',
  'avatar_editor.usar_imagen': 'Usar imagen',
  'avatar_editor.volver_al_centro': 'Volver al centro',
  'avatar_editor.zoom': 'Zoom',
  'avatar_editor.el_archivo_no_se': 'Ese archivo no se puede leer.',
  'avatar_editor.el_archivo_esta': 'El archivo está vacío.',
  'avatar_editor.la_foto_pesa': 'La foto pesa demasiado ({n} MB). Elige otra o recórtala antes.',
  'avatar_editor.puede_ser_jpeg': 'Puede ser JPEG, PNG o WebP.',
  'avatar_editor.la_imagen_no_se': 'La imagen no se pudo leer.',
  'avatar_editor.el_navegador_no': 'El navegador no puede procesar la imagen.',
  'avatar_editor.la_foto_no_tiene': 'La foto no tiene tamaño legible.',
} as const;

export const avatarEditorEn: Record<keyof typeof avatarEditorEs, string> = {
  'avatar_editor.acercar': 'Zoom in',
  'avatar_editor.alejar': 'Zoom out',
  'avatar_editor.arrastra_para_encuadrar_el': 'Drag to frame it. The circle is what you will see; outside it, it gets cropped.',
  'avatar_editor.mueve_la_foto_con': 'Move the photo with your finger or the arrows to frame it; the wheel or the slider zooms',
  'avatar_editor.usar_imagen': 'Use image',
  'avatar_editor.volver_al_centro': 'Back to centre',
  'avatar_editor.zoom': 'Zoom',
  'avatar_editor.leyendo_la_foto': 'Reading the photo…',
  'avatar_editor.el_archivo_no_se': 'That file can’t be read.',
  'avatar_editor.el_archivo_esta': 'The file is empty.',
  'avatar_editor.la_foto_pesa': 'The photo is too heavy ({n} MB). Pick another one or crop it first.',
  'avatar_editor.puede_ser_jpeg': 'It can be JPEG, PNG or WebP.',
  'avatar_editor.la_imagen_no_se': 'The image couldn’t be read.',
  'avatar_editor.el_navegador_no': 'This browser can’t process the image.',
  'avatar_editor.la_foto_no_tiene': 'The photo has no readable size.',
};
