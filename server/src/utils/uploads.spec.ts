import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_AVATAR_BYTES,
  assertWritten,
  deleteUpload,
  isInside,
  parseImageDataUrl,
  readUpload,
  resolveUploadUrl,
  storeImage,
  uploadsRoot
} from './uploads';

/**
 * La foto de la cuenta, en disco. Lo que se prueba aqui es lo que no se ve: que el nombre del
 * fichero no lo manda el cliente, que una URL ajena o un `..` no leen nada fuera del carpetillo,
 * y que cambiar de foto deja una imagen y no dos.
 */

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hogaria-uploads-'));
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('uploads — la foto de la cuenta', () => {
  it('un data URL de imagen se entiende, y lo demas no entra', () => {
    expect(parseImageDataUrl(PNG_1PX)?.mime).toBe('image/png');
    // SVG es texto con script dentro, y una URL remota es un redirect con nuestra ruta.
    expect(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull();
    expect(parseImageDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseImageDataUrl('no soy una imagen')).toBeNull();
    expect(MAX_AVATAR_BYTES).toBeLessThan(1024 * 1024);
  });

  it('el nombre del fichero lo pone el servidor, no quien sube', () => {
    const image = parseImageDataUrl(PNG_1PX)!;
    const url = storeImage('avatars', '../../etc/passwd', image, root);
    expect(url).toMatch(/^\/api\/uploads\/avatars\/[a-z0-9._-]+\.png$/i);
    expect(url).not.toContain('..');
    // Lo que se exige es que el nombre sea un componente suelto y neutro, no que pierda las
    // letras del id (un `etc-passwd` como nombre es inofensivo: sigue dentro de `avatars/`).
    const file = url.split('/').pop()!;
    expect(file).toMatch(/^[a-z0-9._-]+\.png$/i);
    expect(file).not.toContain('/');
    expect(readdirSync(join(root, 'avatars'))).toEqual([file]);
    expect(resolveUploadUrl(url, root)?.endsWith(join('avatars', file))).toBe(true);
  });

  it('la contencion no depende del separador: en Windows tambien', () => {
    // El fallo real que esto cubre: en Windows resolve devuelve barras invertidas, y la
    // comprobacion antigua comparaba contra dir + barra, que alli no se cumple nunca. La foto se
    // escribia, la URL se guardaba y cada lectura era un 404 —en el unico sitio donde no se veia.
    const winDir = 'D:\\projects\\hogaria\\server\\data\\uploads\\avatars';
    expect(isInside(winDir, winDir + '\\u-ana-1a2b.png', '\\')).toBe(true);
    expect(isInside(winDir, 'D:\\windows\\system32\\drivers\\etc\\hosts', '\\')).toBe(false);
    expect(isInside(winDir, winDir, '\\')).toBe(false); // el propio directorio no es un fichero dentro

    // Las rutas POSIX se prueban con su separador explícito, incluso al ejecutar en Windows.
    expect(isInside('/srv/uploads/avatars', '/srv/uploads/avatars/a.png', '/')).toBe(true);
    // Un prefijo comun no es un hijo: sin la barra final, esto se colaria.
    expect(isInside('/srv/uploads/avatars', '/srv/uploads/avatars-x/a.png', '/')).toBe(false);
  });

  it('la foto se lee por su URL, y una URL que no es nuestra no lee nada', () => {
    const url = storeImage('avatars', 'u-ana', parseImageDataUrl(PNG_1PX)!, root);
    const found = readUpload(url, root)!;
    expect(found.type).toBe('image/png');
    expect(found.body.byteLength).toBeGreaterThan(0);

    expect(readUpload('/api/uploads/avatars/../../../../etc/passwd', root)).toBeNull();
    expect(readUpload('/api/uploads/secrets/x.png', root)).toBeNull();
    expect(readUpload(url.replace('.png', '.jpg'), root)).toBeNull();
    expect(resolveUploadUrl(null, root)).toBeNull();
  });

  it('cambiar de foto borra la anterior', () => {
    const first = storeImage('avatars', 'u-ana', parseImageDataUrl(PNG_1PX)!, root);
    const second = storeImage('avatars', 'u-ana', parseImageDataUrl(PNG_1PX)!, root);
    expect(second).not.toBe(first);
    expect(readdirSync(join(root, 'avatars'))).toHaveLength(2);
    expect(deleteUpload(first, root)).toBe(true);
    expect(readdirSync(join(root, 'avatars'))).toHaveLength(1);
    // Borrar dos veces, o borrar algo que no es nuestro, no es un error: no hay nada que hacer.
    expect(deleteUpload(first, root)).toBe(false);
    expect(deleteUpload(null, root)).toBe(false);
    expect(deleteUpload('/etc/passwd', root)).toBe(false);
  });

  it('con la base de datos en memoria se escribe fuera del repo', () => {
    const dir = uploadsRoot(':memory:');
    expect(dir).toContain('hogaria-uploads-');
    expect(dir).not.toContain('data');
    // La ruta resultante usa la semántica nativa del host (POSIX o Windows).
    const databasePath = '/srv/hogaria/data/hogar.sqlite';
    expect(uploadsRoot(databasePath)).toBe(join(dirname(resolve(databasePath)), 'uploads'));
  });

  it('assertWritten: ni un fichero que no esta, ni uno a medias', () => {
    const file = join(root, 'px.png');
    writeFileSync(file, Buffer.from([1, 2, 3]));
    expect(() => assertWritten(file, 3)).not.toThrow();
    // Un disco leno o un corte a media escritura deja un fichero truncado: la URL quedaria
    // guardada y el navegador, con media foto (o con nada). Eso tambien es un fallo.
    expect(() => assertWritten(file, 4)).toThrow(/ha quedado/);
    expect(() => assertWritten(join(root, 'no-esta.png'), 1)).toThrow(/no se ha creado/);
  });

  it('si no se puede crear el directorio de destino, no devuelve una URL', () => {
    const blocker = join(root, 'avatars');
    writeFileSync(blocker, 'no es un directorio');

    expect(() => storeImage('avatars', 'u-ana', parseImageDataUrl(PNG_1PX)!, root)).toThrow();
    expect(readFileSync(blocker, 'utf8')).toBe('no es un directorio');
    expect(readdirSync(root)).toEqual(['avatars']);
  });

  it('una escritura repetida no pisa la foto de nadie', () => {
    const image = parseImageDataUrl(PNG_1PX)!;
    const names = new Set<string>();
    for (let i = 0; i < 12; i++) names.add(storeImage('avatars', 'u-ana', image, root).split('/').pop()!);
    expect(names.size).toBe(12);
  });
});
