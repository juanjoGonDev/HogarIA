import type { TranslationKey, TranslationParams } from './i18n';
import { CropRegion, cropRegion, ZERO_OFFSET } from './avatar-crop';

/**
 * La foto de la cuenta, antes de salir del dispositivo.
 *
 * Dos partes, y solo una es pura. `avatarFileError` decide si el fichero que se eligio merece la
 * pena: se prueba en node porque es donde estan los fallos (un SVG con script dentro, un HEIC que
 * el navegador no decodifica, una foto de 12 MB del movil). Lo demas —decodificar, recortar,
 * comprimir— es canvas, y eso solo existe en el navegador.
 *
 * Se recorta aqui, y no en el servidor, por dos razones: el ancho de subida en un movil es lo que
 * hace que la operacion falle o no, y un servidor que reescala necesita una libreria de imagenes
 * que este binario no trae (y no se le puede anadir un peso asi a una Raspberry).
 *
 * El recorte no lo hace este modulo a su manera: la region la calcula `avatar-crop.ts`, que es pura
 * y esta probada. Aqui se ejecuta; alla se decide. El editor de la pantalla de cuenta y esta
 * funcion comen LA MISMA region, y por eso lo que se encuadra es lo que se sube.
 */

/** Un cuadrado de 128 px: el avatar mas grande de la app mide 64, y el doble es para retina. */
export const AVATAR_EDGE = 128;

/** Calidad JPEG del recorte. Por debajo se nota el bloque; por encima no paga nada. */
export const AVATAR_QUALITY = 0.72;

/** Techo del fichero de partida: 4 MB es una foto de movil recortable sin drama. */
export const AVATAR_MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Lo que un `canvas.drawImage` sabe decodificar sin ayuda de un servidor. */
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;

/**
 * Un problema con la foto, dicho con clave de diccionario (HOGARIA-SPEC 12t-i18n).
 *
 * Es un `Error` para poder viajar por los `catch` de la carga y el recorte sin cambiar de contrato, pero
 * su `message` es un codigo: la prosa la escribe quien pinta el aviso, que es el unico que sabe en que
 * idioma se esta leyendo. Un modulo puro que escribe «Elige otra o recortala antes.» es un texto que
 * nunca se traduce.
 */
export class AvatarIssue extends Error {
  constructor(
    readonly clave: TranslationKey,
    readonly params?: TranslationParams
  ) {
    super(`AVATAR_${clave.replace(/\./g, '_').toUpperCase()}`);
  }
}

export function avatarFileError(file: { type: string; size: number; name?: string }): AvatarIssue | null {
  if (!file || typeof file.size !== 'number') return new AvatarIssue('avatar_editor.el_archivo_no_se');
  if (file.size === 0) return new AvatarIssue('avatar_editor.el_archivo_esta');
  if (file.size > AVATAR_MAX_FILE_BYTES) {
    return new AvatarIssue('avatar_editor.la_foto_pesa', { n: Math.round(file.size / 1024 / 1024) });
  }
  // El SVG es texto: admitirlo es admitir un `script` dentro de una imagen.
  if (!AVATAR_ALLOWED_TYPES.includes(file.type as (typeof AVATAR_ALLOWED_TYPES)[number])) {
    return new AvatarIssue('avatar_editor.puede_ser_jpeg');
  }
  return null;
}

/** El lado del cuadrado recortado, centrado: se recorta por el centro porque la cara sale en el centro. */
export function squareCrop(source: { width: number; height: number }, edge = AVATAR_EDGE): { sx: number; sy: number; size: number } {
  const size = Math.max(1, Math.min(source.width, source.height));
  return { sx: Math.round((source.width - size) / 2), sy: Math.round((source.height - size) / 2), size };
}

/** Una imagen ya decodificada y con fecha de caducidad: `release()` libera el bitmap al navegador. */
export interface DecodedAvatar {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  release(): void;
}

/**
 * El editor necesita la imagen DECODIFICADA Y VIVA (enseñarla mientras se arrastra), y la subida
 * necesita el mismo bitmap una sola vez. Por eso decodificar es una funcion aparte: si no, el
 * fichero se leeria dos veces al navegador y la segunda podria fallar donde la no.
 */
export async function decodeAvatarFile(file: File): Promise<DecodedAvatar> {
  const problema = avatarFileError(file);
  // Se lanza el problema tal cual: es un `Error` con su clave dentro, y traducirlo aqui seria decidir el
  // idioma desde un modulo que no lo conoce.
  if (problema) throw problema;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close()
      };
    } catch {
      /* se cae al <img>, que decodifica algo mas (p. ej. PNGs extra-normalizados) */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new AvatarIssue('avatar_editor.la_imagen_no_se'));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => undefined // un <img> suelto se recoge solo; la URL de objeto ya esta liberada abajo
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 128 px cuadrados a partir de una region de la imagen. Si el navegador no da canvas, se dice. */
export function renderAvatarDataUrl(decoded: DecodedAvatar, region: CropRegion, edge = AVATAR_EDGE): string {
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new AvatarIssue('avatar_editor.el_navegador_no');
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.source, region.sx, region.sy, region.size, region.size, 0, 0, edge, edge);
  return canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
}

/** Decodificar, encuadrar y comprimir en un solo paso (el del boton cuando NO hay editor abierto). */
export async function avatarDataUrlFromCrop(
  file: File,
  zoom = 1,
  offset = ZERO_OFFSET,
  edge = AVATAR_EDGE
): Promise<string> {
  const decoded = await decodeAvatarFile(file);
  try {
    return renderAvatarDataUrl(decoded, cropRegion({ width: decoded.width, height: decoded.height }, zoom, offset), edge);
  } finally {
    decoded.release();
  }
}

/**
 * Lee, recorta por el centro y comprime. Es el atajo de siempre: quien no quiera encuadrar sigue
 * teniendo una sola llamada. Si el navegador no puede decodificar el fichero, rechaza con un
 * mensaje para la persona —no con el error tecnico—, que es lo que se puede accionar desde la
 * pantalla.
 */
export async function avatarDataUrlFromFile(file: File, edge = AVATAR_EDGE): Promise<string> {
  return avatarDataUrlFromCrop(file, 1, ZERO_OFFSET, edge);
}
