import {
  AVATAR_EDGE,
  AVATAR_MAX_FILE_BYTES,
  AVATAR_QUALITY,
  AvatarIssue,
  avatarDataUrlFromCrop,
  avatarDataUrlFromFile,
  avatarFileError,
  decodeAvatarFile,
  renderAvatarDataUrl,
  squareCrop
} from './avatar-image';

/**
 * Lo que se puede decidir sin navegador. El recorte con canvas se prueba a mano en el movil; aqui
 * lo que importa es que un archivo raro no llegue nunca al servidor, y que el recorte sea cuadrado
 * y por el centro (un avatar recortado arriba corta la cabeza).
 */
describe('avatar-image — el archivo antes de salir del dispositivo', () => {
  const ok = { type: 'image/jpeg', size: 900_000 };

  it('acepta lo que un canvas sabe decodificar', () => {
    expect(avatarFileError(ok)).toBeNull();
    expect(avatarFileError({ type: 'image/png', size: 10 })).toBeNull();
    expect(avatarFileError({ type: 'image/webp', size: 10 })).toBeNull();
  });

  it('rechaza el SVG, el HEIC y lo que no es una imagen', () => {
    // SVG es texto con script dentro, y admitirlo aqui es meterlo en un `img`.
    // Lo que se compara es la CLAVE: la frase la decide el diccionario, y un modulo puro no tiene idioma.
    expect(avatarFileError({ type: 'image/svg+xml', size: 10 })?.clave).toBe(
      'avatar_editor.puede_ser_jpeg'
    );
    expect(avatarFileError({ type: 'image/heic', size: 10 })?.clave).toBe(
      'avatar_editor.puede_ser_jpeg'
    );
    expect(avatarFileError({ type: 'application/pdf', size: 10 })?.clave).toBe(
      'avatar_editor.puede_ser_jpeg'
    );
    expect(avatarFileError({ type: '', size: 10 })).not.toBeNull();
  });

  it('el vacio y el demasiado grande se dicen con un aviso accionable', () => {
    expect(avatarFileError({ type: 'image/jpeg', size: 0 })?.clave).toBe(
      'avatar_editor.el_archivo_esta'
    );
    const huge = avatarFileError({ type: 'image/jpeg', size: AVATAR_MAX_FILE_BYTES + 1 });
    expect(huge?.clave).toBe('avatar_editor.la_foto_pesa');
    // El tamano viaja como parametro: lo que se pinta es un numero, no «413».
    expect(typeof huge?.params?.['n']).toBe('number'); // un numero, no «413»
    // Y sigue siendo un `Error`, que es como entra por los `catch` de la carga y el recorte.
    expect(huge).toBeInstanceOf(Error);
  });

  it('rechaza entradas sin tamano y acepta los MIME/borde maximo admitidos', () => {
    expect(avatarFileError(undefined as never)?.clave).toBe('avatar_editor.el_archivo_no_se');
    expect(avatarFileError({ type: 'image/jpeg', size: '1' as never })?.clave).toBe(
      'avatar_editor.el_archivo_no_se'
    );
    expect(avatarFileError({ type: 'image/jpg', size: AVATAR_MAX_FILE_BYTES })).toBeNull();
  });

  it('el recorte es un cuadrado por el centro, y nunca de tamano 0', () => {
    expect(squareCrop({ width: 4000, height: 3000 }, 128)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(squareCrop({ width: 100, height: 4000 }, 128)).toEqual({ sx: 0, sy: 1950, size: 100 });
    expect(squareCrop({ width: 0, height: 0 }, 128).size).toBe(1);
    expect(squareCrop({ width: 90, height: 90 }, AVATAR_EDGE)).toEqual({ sx: 0, sy: 0, size: 90 });
    expect(squareCrop({ width: 90, height: 90 })).toEqual({ sx: 0, sy: 0, size: 90 });
  });
});

describe('avatar-image — decodificacion, render y liberacion en navegador', () => {
  it('prefiere ImageBitmap y lo libera cuando termina el editor', async () => {
    const file = new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' });
    const bitmap = fakeBitmap(320, 240);
    const createBitmap = spyOn(window, 'createImageBitmap').and.returnValue(
      Promise.resolve(bitmap)
    );

    const decoded = await decodeAvatarFile(file);

    expect(createBitmap.calls.first().args[0]).toBe(file);
    expect(decoded.source).toBe(bitmap);
    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(240);
    decoded.release();
    expect(bitmap.close).toHaveBeenCalledOnceWith();
  });

  it('rechaza un archivo invalido antes de intentar decodificarlo', async () => {
    const file = new File([new Uint8Array([1])], 'avatar.svg', { type: 'image/svg+xml' });
    const createBitmap = spyOn(window, 'createImageBitmap');

    await expectAsync(decodeAvatarFile(file)).toBeRejectedWith(jasmine.any(AvatarIssue));

    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('usa Image sin ImageBitmap y recurre a dimensiones renderizadas si naturalWidth es cero', async () => {
    const file = new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' });
    const createBitmapDescriptor = Object.getOwnPropertyDescriptor(window, 'createImageBitmap');
    const imageDescriptor = Object.getOwnPropertyDescriptor(window, 'Image');
    const image = {
      naturalWidth: 0,
      naturalHeight: 0,
      width: 23,
      height: 17,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    };
    const ImageStub = function () {
      return image as unknown as HTMLImageElement;
    } as unknown as typeof Image;
    Object.defineProperty(window, 'createImageBitmap', { configurable: true, value: undefined });
    Object.defineProperty(window, 'Image', { configurable: true, value: ImageStub });
    const createUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:avatar-test');
    const revokeUrl = spyOn(URL, 'revokeObjectURL').and.stub();

    try {
      const decoded = await decodeAvatarFile(file);

      expect(createUrl).toHaveBeenCalledWith(file);
      expect(decoded.source).toBe(image as unknown as CanvasImageSource);
      expect(decoded.width).toBe(23);
      expect(decoded.height).toBe(17);
      expect(revokeUrl).toHaveBeenCalledWith('blob:avatar-test');
      decoded.release();
    } finally {
      if (createBitmapDescriptor) {
        Object.defineProperty(window, 'createImageBitmap', createBitmapDescriptor);
      } else {
        Reflect.deleteProperty(window, 'createImageBitmap');
      }
      if (imageDescriptor) Object.defineProperty(window, 'Image', imageDescriptor);
      else Reflect.deleteProperty(window, 'Image');
    }
  });

  it('usa <img> si falla ImageBitmap y revoca la URL al cargar', async () => {
    const file = validPngFile();
    spyOn(window, 'createImageBitmap').and.returnValue(
      Promise.reject(new Error('decode fallback'))
    );
    const createUrl = spyOn(URL, 'createObjectURL').and.callThrough();
    const revokeUrl = spyOn(URL, 'revokeObjectURL').and.callThrough();

    const decoded = await decodeAvatarFile(file);

    expect(createUrl).toHaveBeenCalledWith(file);
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(revokeUrl).toHaveBeenCalledWith(createUrl.calls.mostRecent().returnValue);
    decoded.release();
  });

  it('devuelve un error localizado si falla tambien <img> y aun revoca la URL', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'invalid.png', { type: 'image/png' });
    spyOn(window, 'createImageBitmap').and.returnValue(Promise.reject(new Error('bad image')));
    const createUrl = spyOn(URL, 'createObjectURL').and.callThrough();
    const revokeUrl = spyOn(URL, 'revokeObjectURL').and.callThrough();

    await expectAsync(decodeAvatarFile(file)).toBeRejectedWith(jasmine.any(AvatarIssue));

    expect(revokeUrl).toHaveBeenCalledWith(createUrl.calls.mostRecent().returnValue);
  });

  it('configura el canvas y dibuja exactamente la region recibida a JPEG', () => {
    const source = {} as CanvasImageSource;
    const contextSpy = jasmine.createSpy('drawImage');
    const context = {
      imageSmoothingQuality: 'low',
      drawImage: contextSpy
    } as unknown as CanvasRenderingContext2D;
    const getContext = spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue(context);
    const toDataURL = spyOn(HTMLCanvasElement.prototype, 'toDataURL').and.returnValue(
      'data:image/jpeg;base64,synthetic'
    );

    const result = renderAvatarDataUrl(
      { source, width: 320, height: 240, release: () => undefined },
      { sx: 40, sy: 20, size: 200 },
      64
    );

    const canvas = getContext.calls.first().object as HTMLCanvasElement;
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
    expect(context.imageSmoothingQuality).toBe('high');
    expect(contextSpy).toHaveBeenCalledWith(source, 40, 20, 200, 200, 0, 0, 64, 64);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', AVATAR_QUALITY);
    expect(result).toBe('data:image/jpeg;base64,synthetic');
  });

  it('informa si falta canvas y el pipeline libera el bitmap incluso con ese error', async () => {
    const file = new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' });
    const bitmap = fakeBitmap(320, 240);
    spyOn(window, 'createImageBitmap').and.returnValue(Promise.resolve(bitmap));
    spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue(null);

    await expectAsync(avatarDataUrlFromCrop(file, 2, { x: 20, y: -10 }, 64)).toBeRejectedWith(
      jasmine.any(AvatarIssue)
    );

    expect(bitmap.close).toHaveBeenCalledOnceWith();
  });

  it('el atajo sin editor reutiliza el pipeline y respeta el lado JPEG por defecto', async () => {
    const file = new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' });
    const bitmap = fakeBitmap(320, 240);
    spyOn(window, 'createImageBitmap').and.returnValue(Promise.resolve(bitmap));
    const drawImage = jasmine.createSpy('drawImage');
    spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue({
      imageSmoothingQuality: 'low',
      drawImage
    } as unknown as CanvasRenderingContext2D);
    spyOn(HTMLCanvasElement.prototype, 'toDataURL').and.returnValue(
      'data:image/jpeg;base64,synthetic'
    );

    await avatarDataUrlFromCrop(file);
    await avatarDataUrlFromFile(file);

    expect(drawImage).toHaveBeenCalledWith(bitmap, 40, 0, 240, 240, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
    expect(bitmap.close).toHaveBeenCalledTimes(2);
  });
});

function fakeBitmap(width: number, height: number): ImageBitmap & { close: jasmine.Spy } {
  return { width, height, close: jasmine.createSpy('close') } as unknown as ImageBitmap & {
    close: jasmine.Spy;
  };
}

function validPngFile(): File {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], 'pixel.png', { type: 'image/png' });
}
