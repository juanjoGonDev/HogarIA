import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Lo que la persona sube (la foto de su cuenta), en disco y no en la base de datos.
 *
 * El avatar se lee en las subconsultas que decoran cada fila de la compra, cada suceso de la
 * auditoria y cada chip de la agenda. Guardar ahi un base64 de 40 KB es pagar 40 KB por fila en
 * la pantalla mas caliente de la app; guardar una ruta cuesta 30 bytes y el navegador cachea la
 * imagen. De ahi tambien que el nombre lleve un sufijo aleatorio: la URL del fichero ES el
 * permiso —se sirve sin autenticacion porque un `img` no puede mandar la cabecera `Authorization`—,
 * asi que nadie tiene que poder adivinarla.
 */

/**
 * El disco dijo si, y luego no estaba ahi. Sucede (y es lo peor que le puede pasar a esta
 * pantalla) cuando la carpeta de `uploads` se va debajo del proceso: un volumen remontado, un
 * snapshot del workspace, un deploy que no monta `data/`. El fichero se escribe, la base de datos
 * guarda la URL, la API contesta 200 —y el navegador, 404. Sin esta comprobacion el usuario se
 * queda con un toast verde y una inicial que no cambia, y nadie sabe donde mirar.
 */
export class UploadWriteError extends Error {
  constructor(readonly file: string, reason: string) {
    super(`El servidor no pudo guardar la imagen en ${file} (${reason})`);
    this.name = 'UploadWriteError';
  }
}

/** Tras escribir: que el fichero este, y con los bytes que tocaba. */
export function assertWritten(file: string, bytes: number): void {
  let size = -1;
  try {
    size = statSync(file).size;
  } catch {
    throw new UploadWriteError(file, 'no se ha creado');
  }
  if (size !== bytes) throw new UploadWriteError(file, `ha quedado a ${size} de ${bytes} bytes`);
}

/** Un avatar es un recorte pequeno: 128 px de lado, JPEG. Media megabierto es el techo. */
export const MAX_AVATAR_BYTES = 512 * 1024;
export const AVATAR_URL_PREFIX = '/api/uploads/avatars/';

const KINDS = ['avatars', 'receipts', 'product-images'] as const;
export type UploadKind = (typeof KINDS)[number];

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

/** Donde se escribe: junto a la base de datos, para que un volumen monte las dos cosas. */
export function uploadsRoot(path = process.env.DATABASE_PATH || './data/hogaria.sqlite'): string {
  // Con `:memory:` (los tests) no hay carpeta de la BD: se cae a un temporal del proceso, y asi
  // ninguna prueba escribe dentro del arbol del repo.
  if (path === ':memory:') return join(tmpdir(), `hogaria-uploads-${process.pid}`);
  return join(dirname(resolve(path)), 'uploads');
}

export type ParsedImage = { mime: string; buffer: Buffer };

/**
 * Acepta SOLO un data URL de imagen de siempre, y nada mas: ni `http:` (seria un redirect a
 * otro servidor con nuestra ruta), ni SVG (que es texto con script dentro).
 */
export function parseImageDataUrl(value: string): ParsedImage | null {
  const match = /^data:([a-z/+.-]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.byteLength) return null;
  return { mime: ext === '.jpg' ? 'image/jpeg' : mime, buffer };
}

const safe = (value: string): string =>
  // Los puntos se collapsan: sin esto, `../..` acababa en un nombre con `..` dentro, y un nombre
  // asi es un pie de pagina para cualquier consumidor que reconstruya la ruta a mano.
  value
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48) || 'anon';

/** Escribe la imagen y devuelve su URL publica. El nombre no lo decide quien sube. */
export function storeImage(kind: UploadKind, ownerId: string, image: ParsedImage, root = uploadsRoot()): string {
  const dir = join(root, kind);
  mkdirSync(dir, { recursive: true });
  const ext = EXT_BY_MIME[image.mime] ?? '.jpg';
  const file = `${safe(ownerId)}-${randomBytes(5).toString('hex')}${ext}`;
  const full = join(dir, file);
  writeFileSync(full, image.buffer, { mode: 0o644 });
  // Comprobar despues de escribir es gratis, y es lo unico que convierte un 404 misterioso en un
  // 500 con una ruta dentro. El `mkdirSync` de arriba tambien cuenta: si la raiz es de solo
  // lectura, aqui se sabe —no cuando el navegador ya lleva tres intentos.
  assertWritten(full, image.buffer.byteLength);
  return `/api/uploads/${kind}/${file}`;
}

/**
 * Un ticket subido (## 12aj): imagen o PDF, en disco igual que el avatar pero con su propia
 * carpeta y sin pasar por el parseo de data URL —llega como multipart, con los bytes ya leidos
 * y el tipo decidido por la FIRMA del fichero (magic bytes), no por lo que diga el formulario.
 */
export function storeTicket(ownerId: string, buffer: Buffer, kind: 'png' | 'jpeg' | 'webp' | 'pdf', root = uploadsRoot()): string {
  const ext = kind === 'jpeg' ? '.jpg' : `.${kind}`;
  return storeRawFile('receipts', ownerId, buffer, ext, root);
}

/** Lo de abajo de `storeImage` sin el diccionario de mimes: quien llama ya sabe la extension. */
function storeRawFile(kind: UploadKind, ownerId: string, buffer: Buffer, ext: string, root: string): string {
  const dir = join(root, kind);
  mkdirSync(dir, { recursive: true });
  const file = `${safe(ownerId)}-${randomBytes(5).toString('hex')}${ext}`;
  const full = join(dir, file);
  writeFileSync(full, buffer, { mode: 0o644 });
  assertWritten(full, buffer.byteLength);
  return `/api/uploads/${kind}/${file}`;
}

/**
 * La firma de un ticket: lo que DICE ser tiene que empezar por sus bytes de siempre. Un
 * `Content-Type` se falsifica con la misma facilidad con la que se manda, y guardar un .exe
 * con nombre de foto en la carpeta publica de uploads es un regalo que nadie pidio.
 */
export function detectarKindTicket(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'pdf' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  return null;
}

/**
 * Si `candidate` es un fichero DENTRO de `dir`. El detalle que no es detalle: la primera version
 * comparaba con `dir + '/'`, y en Windows `resolve` devuelve barras invertidas —el `startsWith` no
 * se cumplia jamais, la foto se escribia, la URL se guardaba y cada lectura era un 404. Un bug que
 * solo existe en el otro sistema de ficheros es exactamente lo que una comprobacion de rutas no se
 * puede permitir, asi que el separador es un parametro: se puede probar en los dos sentidos.
 */
export function isInside(dir: string, candidate: string, separator = sep): boolean {
  if (!candidate || !dir) return false;
  const base = dir.endsWith(separator) ? dir : dir + separator;
  return candidate.startsWith(base) && candidate.length > base.length;
}

/** URL publica -> ruta en disco, con el recorrido validado (nunca un `..` hacia fuera). */
export function resolveUploadUrl(url: string | null | undefined, root = uploadsRoot()): string | null {
  if (!url) return null;
  const parts = url.replace(/^\/api\/uploads\//, '').split('/');
  if (parts.length !== 2) return null;
  const [kind, file] = parts;
  if (!(KINDS as readonly string[]).includes(kind)) return null;
  if (!/^[a-zA-Z0-9._-]{4,80}$/.test(file) || file.includes('..')) return null;
  const dir = resolve(root, kind);
  const full = resolve(dir, file);
  return isInside(dir, full) ? full : null;
}

export function readUpload(url: string, root = uploadsRoot()): { body: Buffer; type: string } | null {
  const file = resolveUploadUrl(url, root);
  if (!file) return null;
  try {
    return { body: readFileSync(file), type: MIME_BY_EXT[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    missWarning(file);
    return null;
  }
}

/**
 * Un 404 de una foto es silente para siempre si no se dice: el `img` se cae a la inicial, el
 * `catch` del `app-avatar` no pinta nada en consola, y la unica prueba de que la ruta existe y de
 * donde estaba mirando el servidor queda en el log. Un aviso por minuto —esta ruta es publica, y
 * alguien probando nombres no tiene que poder llenarle a la casa el visor de logs.
 */
let lastMissWarning = 0;
export function missWarning(file: string, now = Date.now()): void {
  if (now - lastMissWarning < 60_000) return;
  lastMissWarning = now;
  console.warn(`[uploads] imagen no encontrada en disco: ${file} (raiz: ${uploadsRoot()})`);
}

/**
 * Cambiar de foto borra la anterior: si no, cada persona acumula archivos para siempre.
 * Devuelve si HABIA algo que borrar — `rmSync(force)` no falla contra la nada, y contestar
 * `true` cuando ya no existia es mentirle a quien llama.
 */
export function deleteUpload(url: string | null | undefined, root = uploadsRoot()): boolean {
  const file = resolveUploadUrl(url, root);
  if (!file || !existsSync(file)) return false;
  try {
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}
