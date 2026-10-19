import {
  clampZoom,
  cropRegion,
  cropSize,
  MAX_ZOOM,
  panFromDrag,
  previewLayout,
  zoomAround,
  ZERO_OFFSET
} from './avatar-crop';

/**
 * La matematica del encuadre. Se prueba aqui porque es lo unico que puede salir mal sin que nadie
 * lo vea: si la vista previa y el recorte subido no son la misma region, el usuario ajusta una cosa
 * y guarda otra, y eso no se pinta en el log ni en el build.
 */

describe('avatar-crop — el encuadre', () => {
  it('a zoom 1 el cuadro es el cuadrado maximo que cabe, centrado', () => {
    const vertical = cropRegion({ width: 400, height: 1000 }, 1, ZERO_OFFSET);
    expect(vertical).toEqual({ sx: 0, sy: 300, size: 400 });

    const horizontal = cropRegion({ width: 1600, height: 900 }, 1, ZERO_OFFSET);
    expect(horizontal).toEqual({ sx: 350, sy: 0, size: 900 });
  });

  it('el zoom reduce el lado, y no se puede salir del rango', () => {
    const source = { width: 800, height: 800 };
    expect(cropSize(source, 2)).toBe(400);
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    // Un slider vacio o una rueda rara dan NaN: el cuadro se queda en el sitio, no se va a la nada.
    expect(clampZoom(NaN)).toBe(1);
    expect(cropSize(source, NaN)).toBe(800);
  });

  it('el desplazamiento se recorta al hueco que deja el cuadro', () => {
    const source = { width: 1000, height: 1000 };
    // A zoom 2 caben 250 px de holgura por lado: pedir 10000 es pedir 250.
    const pushed = cropRegion(source, 2, { x: 10_000, y: -10_000 });
    expect(pushed).toEqual({ sx: 500, sy: 0, size: 500 });
    // Y con un cuadrado que ya llena la foto no hay hueco: el offset no mueve nada.
    expect(cropRegion(source, 1, { x: 500, y: 500 })).toEqual({ sx: 0, sy: 0, size: 1000 });
  });

  it('un offset que no es un numero se ignora en lugar de corromper la region', () => {
    const region = cropRegion({ width: 600, height: 600 }, 2, { x: NaN, y: Infinity });
    expect(region).toEqual({ sx: 150, sy: 150, size: 300 });
  });

  it('arrastrar la foto mueve el cuadro en el sentido contrario, en px de imagen', () => {
    const source = { width: 2000, height: 2000 };
    const region = cropRegion(source, 2, ZERO_OFFSET); // 1000 px de cuadro
    // 50 px de arrastre en una caja de 250 son 200 px de imagen: la mitad del cuadro por pantalla
    // es el doble de imagen. Y con signo cambiado, porque se agarra la foto.
    expect(panFromDrag({ x: 50, y: 0 }, 250, region)).toEqual({ x: -200, y: 0 });
    expect(panFromDrag({ x: 0, y: 0 }, 0, region)).toEqual({ x: 0, y: 0 });
  });

  it('la vista previa pinta exactamente la region que se va a recortar', () => {
    const source = { width: 1200, height: 800 };
    const region = cropRegion(source, 1, { x: 0, y: 0 }); // side 800, sx 200, sy 0
    const layout = previewLayout(source, region, 240); // caja de 240 px
    // El factor es 240/800 = 0,3: la foto entera mide 360 y lo que sobra por la izquierda son 60.
    // Se compara con tolerancia porque el factor no es exacto en binario: exigir 360 pelado es
    // tener un test rojo por un redondeo de la coma flotante, no por un fallo de encuadre.
    expect(layout.widthPx).toBeCloseTo(360, 6);
    expect(layout.leftPx).toBeCloseTo(-60, 6);
    expect(layout.topPx).toBe(0);

    // Y lo que se ve dentro de la caja es EXACTAMENTE el recorte: 200 px de foto al ancho de 240.
    expect(region.size * (layout.widthPx / source.width)).toBeCloseTo(240, 6);
  });

  it('el zoom conserva el punto bajo el puntero', () => {
    const source = { width: 1000, height: 1000 };
    // Del centro no se puede salir a zoom 1 (un cuadrado llena el cuadro), asi que el punto 100
    // esta a 100 px del centro y el recuadro aun en 0: al acercar al doble, el punto tiene que
    // seguir en la misma franja de pantalla, y eso es offset 50 —no 200, que es lo que sale por
    // escalar el offset en lugar del hueco que queda entre los dos.
    const next = zoomAround(source, { zoom: 1, offset: ZERO_OFFSET }, 2, { x: 100, y: 0 });
    expect(next.zoom).toBe(2);
    expect(next.offset.x).toBe(50);
    expect(cropRegion(source, next.zoom, next.offset).sx).toBe(300);

    // Con una foto panoramica si que habia desplazamiento previo: la invariante es que la
    // proporcion del punto dentro del cuadro no cambia.
    const wide = { width: 2000, height: 1000 };
    const moved = zoomAround(wide, { zoom: 1, offset: { x: 100, y: 0 } }, 2, { x: 300, y: 0 });
    expect(moved.offset.x).toBe(200);
    expect((300 - 100) / cropSize(wide, 1)).toBeCloseTo((300 - moved.offset.x) / cropSize(wide, 2), 6);
  });
});
