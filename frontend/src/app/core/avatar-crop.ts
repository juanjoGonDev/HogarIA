/**
 * La geometria del recuadro con el que se encuadra la foto de perfil.
 *
 * Es un modulo aparte y puro por un motivo: lo que se ve en pantalla y lo que acaba subido tienen
 * que ser LA MISMA region de la imagen original, y esa igualdad se puede escribir mal de muchas
 * formas (un redondeo de mas, un offset en px de pantalla en vez de px de imagen, un zoom que se
 * aplica al centro en lugar de al punto que se arrastra). Aqui no hay DOM, asi que se puede probar
 * en node —y de hecho se prueba— en lugar de confiar en el ojo.
 *
 * Convencion de unidades: `offset` esta en PIXELES DE LA IMAGEN y se mide desde el centro del
 * cuadro. La pantalla entra solo en `panFromDrag` (que traduce el arrastre) y en `previewLayout`
 * (que traduce la region a estilo del `img`). El `canvas` del recorte final come exclusivamente
 * `Region`, que ya esta en las unidades de la imagen.
 */

/** El cuadrado maximo que cabe dentro de la foto (lo que un `object-fit: cover` enseña). */
export const MIN_ZOOM = 1;

/** Cuatro veces: con mas, un avatar de 128 px sale borrroso y no sirve para nada. */
export const MAX_ZOOM = 4;

export const DEFAULT_ZOOM = MIN_ZOOM;

export interface SourceSize {
  width: number;
  height: number;
}

/** Desplazamiento del cuadro sobre la imagen, en px de la imagen, desde el centro. */
export interface CropOffset {
  x: number;
  y: number;
}

/** Lo que se le pasa al `canvas.drawImage`: un cuadrado de la imagen original. */
export interface CropRegion {
  sx: number;
  sy: number;
  size: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Un `NaN` en el slider (o en la rueda del raton) no puede deixar el recuadro fuera de la foto. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Lado del cuadrado que se ve: la base `cover` dividida por el zoom. */
export function cropSize(source: SourceSize, zoom: number): number {
  const base = Math.max(1, Math.min(source.width, source.height));
  return base / clampZoom(zoom);
}

/**
 * La region recortada, SIEMPRE dentro de la imagen: el offset se recorta al hueco que deja el
 * cuadro, y por eso la foto no se sale nunca a un hueco blanco —se queda pegada al borde, como en
 * cualquier recortador que se respete.
 */
export function cropRegion(source: SourceSize, zoom: number, offset: CropOffset): CropRegion {
  const size = Math.round(cropSize(source, zoom));
  const roomX = (source.width - size) / 2;
  const roomY = (source.height - size) / 2;
  const x = Number.isFinite(offset.x) ? clamp(offset.x, -roomX, roomX) : 0;
  const y = Number.isFinite(offset.y) ? clamp(offset.y, -roomY, roomY) : 0;
  return {
    sx: Math.round(source.width / 2 - size / 2 + x),
    sy: Math.round(source.height / 2 - size / 2 + y),
    size
  };
}

/**
 * Traduce un arrastre de pantalla a desplazamiento de imagen. Sentido contrario: se agarra LA
 * FOTO y se la mueve, no el visor —que es como un dedo espera que se comporte.
 */
export function panFromDrag(drag: CropOffset, displayedPx: number, region: CropRegion): CropOffset {
  if (!(displayedPx > 0)) return { x: 0, y: 0 };
  const k = region.size / displayedPx;
  // El `-0 || 0` no es cosmético: el signo del cero se cuela en el `style` del `img` y en un
  // `toEqual`, y en los dos sitios es ruido que no significa nada.
  const x = -(drag.x || 0) * k;
  const y = -(drag.y || 0) * k;
  return { x: x || 0, y: y || 0 };
}

/**
 * Como se pinta la vista previa para que coincida con `region`: el `img` se agranda al factor que
 * hace falta y se desplaza lo que la region deja fuera por la izquierda y por arriba. Con esto la
 * vista previa no necesita `transform` ni `object-fit`, y no hay dos matematicas distintas.
 */
export function previewLayout(
  source: SourceSize,
  region: CropRegion,
  boxPx: number
): { widthPx: number; leftPx: number; topPx: number } {
  const k = boxPx / Math.max(1, region.size);
  const zero = (value: number) => value || 0; // el `-0` va a parar a un `style`, y no aporta nada
  return { widthPx: source.width * k, leftPx: zero(-region.sx * k), topPx: zero(-region.sy * k) };
}

/** Zoom anclado a un punto (la rueda sobre donde mira el dedo, no sobre el centro del cuadro). */
export function zoomAround(
  source: SourceSize,
  from: { zoom: number; offset: CropOffset },
  nextZoom: number,
  at: CropOffset
): { zoom: number; offset: CropOffset } {
  const zoom = clampZoom(nextZoom);
  const before = cropSize(source, from.zoom);
  const after = cropSize(source, zoom);
  const ratio = after / before;
  // `at` es el punto de la imagen bajo el puntero, en px desde el centro de la foto. Tiene que
  // quedar en el mismo sitio de la pantalla antes y despues, o sea: (at - offset) / lado tiene que
  // conservarse. De ahi el `at - (at - offset) * ratio`. Si solo se escalase el offset (el error
  // facil), el zoom se iria al centro de la foto y el encuadre se escaparia del dedo.
  return {
    zoom,
    offset: {
      x: at.x - (at.x - from.offset.x) * ratio,
      y: at.y - (at.y - from.offset.y) * ratio
    }
  };
}

export const ZERO_OFFSET: CropOffset = { x: 0, y: 0 };
