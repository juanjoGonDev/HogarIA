import {
  HOUR_HEIGHT_PX,
  MEAL_ANCHOR_MINUTES,
  MIN_BLOCK_HEIGHT_PX,
  allDayOf,
  clampMinutes,
  hoursOf,
  mealTypeForMinutes,
  minutesAtOffset,
  minutesFromTime,
  placeDay,
  scrollTopFor,
  timeFromMinutes,
  windowFor,
  type GridItem
} from './calendar-grid';

/** `10, 30` -> minutos de las 10:30. Sin esto el spec se llena de `10 * 30` que no es las 10:30. */
function at(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

/** Un item con hora, en el día que sea (la geometria no mira la fecha). */
function timed(start: number, end: number, overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: `${start}-${end}-${Object.keys(overrides).join('')}`,
    date: '2026-03-11',
    startMinutes: start,
    endMinutes: end,
    timed: true,
    allDay: false,
    ...overrides
  };
}

describe('calendar-grid: horas y minutos', () => {
  it('una hora se lee en minutos y se vuelve a escribir igual', () => {
    expect(minutesFromTime('00:00')).toBe(0);
    expect(minutesFromTime('07:05')).toBe(425);
    expect(minutesFromTime('23:59')).toBe(1439);
    expect(timeFromMinutes(0)).toBe('00:00');
    expect(timeFromMinutes(425)).toBe('07:05');
    expect(timeFromMinutes(1439)).toBe('23:59');
    for (const time of ['08:30', '14:00', '17:30', '21:00', '00:05', '23:55']) {
      expect(timeFromMinutes(minutesFromTime(time)!)).toBe(time);
    }
  });

  it('un input vacio no es una hora, y una hora mal dicha tampoco', () => {
    // `''` es el estado de un `<input type="time">` sin tocar: si esto devolviera 0, la comida sin
    // hora se pintaria a medianoche y el usuario veria una hora que no ha escrito.
    expect(minutesFromTime('')).toBeNull();
    expect(minutesFromTime(null)).toBeNull();
    expect(minutesFromTime(undefined)).toBeNull();
    expect(minutesFromTime('7:00')).toBeNull();
    expect(minutesFromTime('24:00')).toBeNull();
    expect(minutesFromTime('12:60')).toBeNull();
  });

  it('los minutos fuera del dia se quedan dentro, sin NaN por el camino', () => {
    expect(clampMinutes(-30)).toBe(0);
    expect(clampMinutes(2000)).toBe(1440);
    expect(clampMinutes(Number.NaN)).toBe(0);
  });
});

describe('calendar-grid: la ventana que se ensena', () => {
  it('siempre cubre 00:00–24:00, sin depender de eventos ni de la hora actual', () => {
    const window = windowFor();
    expect(window).toEqual({ startMinutes: 0, endMinutes: 1440 });
    expect(hoursOf(window)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
  });

  it('mantiene eventos de madrugada y del final del día dentro de la escala', () => {
    const window = windowFor();
    const blocks = placeDay([timed(0, 30), timed(at(23, 30), 1440)], window);

    expect(blocks.map((block) => block.topPx)).toEqual([0, 23.5 * HOUR_HEIGHT_PX]);
    expect(blocks[1].topPx + blocks[1].heightPx).toBe(24 * HOUR_HEIGHT_PX);
  });
});

describe('calendar-grid: donde se pinta cada bloque', () => {
  const window = { startMinutes: 8 * 60, endMinutes: 22 * 60 };

  it('la altura es el tiempo, y el alto minimo existe para que se pueda tocar', () => {
    const [one] = placeDay([timed(at(10), at(12))], window);
    expect(one.topPx).toBe((2 * 60 * HOUR_HEIGHT_PX) / 60);
    expect(one.heightPx).toBe((2 * 60 * HOUR_HEIGHT_PX) / 60);

    const [tiny] = placeDay([timed(at(10), at(10, 5))], window);
    expect(tiny.heightPx).toBe(MIN_BLOCK_HEIGHT_PX);
  });

  it('un evento sin hora de fin no ocupa el dia entero', () => {
    const [block] = placeDay([timed(at(18), at(18))], window);
    expect(block.heightPx).toBe((30 * HOUR_HEIGHT_PX) / 60);
  });

  it('lo que se sale de la ventana se corta, no se pinta fuera', () => {
    const [block] = placeDay([timed(at(6), at(9))], window);
    expect(block.topPx).toBe(0);
    expect(block.heightPx).toBe(1 * 60 * (HOUR_HEIGHT_PX / 60));
  });

  it('dos cosas que se solapan se reparten la anchura, y todas las del grupo igual', () => {
    const items = [timed(at(10), at(11), { id: 'a' }), timed(at(10, 30), at(11, 30), { id: 'b' })];
    const blocks = placeDay(items, window);
    expect(blocks.map((block) => block.columns)).toEqual([2, 2]);
    expect(blocks.map((block) => block.column).sort()).toEqual([0, 1]);
  });

  it('una fila de tres no se reparte entre tres: se reparte entre dos, que es lo que hace falta', () => {
    // a toca a b, b toca a c, a no toca a c. Dos columnas bastan, y el algoritmo tiene que verlas:
    // repartir el ancho por «cuantos items hay en el grupo» deja los bloques de una fila de cuatro a
    // un cuarto de pantalla, ilegibles. Lo que SI tiene que valer es el divisor del grupo (no «las
    // columnas usadas hasta ahora»), porque con eso la última de la fila no pisa a la primera.
    const items = [
      timed(at(10), at(10, 50), { id: 'a' }),
      timed(at(10, 45), at(11, 30), { id: 'b' }),
      timed(at(11, 15), at(12), { id: 'c' })
    ];
    const blocks = placeDay(items, window);
    const byId = new Map(blocks.map((block) => [block.item.id, block]));
    expect(byId.get('a')!.column).toBe(0);
    expect(byId.get('b')!.column).toBe(1);
    // c vuelve a la columna 0: no solapa a a. Y todas comparten el mismo divisor, para que el ancho
    // no dependa del orden en que se procesaron.
    expect(byId.get('c')!.column).toBe(0);
    expect(new Set(blocks.map((block) => block.columns))).toEqual(new Set([2]));
  });

  it('lo que no se toca, se apila sin columnas', () => {
    const items = [timed(at(9), at(10), { id: 'a' }), timed(at(14), at(15), { id: 'b' })];
    const blocks = placeDay(items, window);
    expect(blocks.map((block) => block.columns)).toEqual([1, 1]);
    expect(blocks[1].topPx).toBeGreaterThan(blocks[0].topPx + blocks[0].heightPx);
  });

  it('todo el dia vive en la banda, no en la rejilla', () => {
    const items = [timed(at(9), at(10)), timed(0, 1440, { allDay: true, timed: false, id: 'banda' })];
    expect(placeDay(items, window).map((block) => block.item.id)).toEqual([items[0].id]);
    expect(allDayOf(items).map((item) => item.id)).toEqual(['banda']);
  });
});

describe('calendar-grid: la comida sin hora y el gesto del usuario', () => {
  it('las anclas siguen el orden del dia espanol', () => {
    const anchors = MEAL_ANCHOR_MINUTES;
    expect(anchors.breakfast).toBeLessThan(anchors.lunch);
    // El fallo que traj0 esta ronda: la cena estaba antes que la merienda.
    expect(anchors.lunch).toBeLessThan(anchors.snack);
    expect(anchors.snack).toBeLessThan(anchors.dinner);
  });

  it('un clic en la rejilla cae en media hora, dentro de la ventana', () => {
    const window = { startMinutes: 8 * 60, endMinutes: 22 * 60 };
    expect(minutesAtOffset(0, window)).toBe(8 * 60);
    expect(minutesAtOffset(HOUR_HEIGHT_PX, window)).toBe(9 * 60);
    expect(minutesAtOffset(HOUR_HEIGHT_PX / 2, window)).toBe(8 * 60 + 30);
    // Abajo del todo no se puede crear a las 22:00 en punto (fuera de ventana) ni antes de las 8.
    expect(minutesAtOffset(100_000, window)).toBeLessThan(22 * 60);
    expect(minutesAtOffset(-400, window)).toBe(8 * 60);
  });

  it('la hora pulsada elige la comida mas proxima, no la ultima empezada', () => {
    expect(mealTypeForMinutes(9 * 60)).toBe('breakfast');
    expect(mealTypeForMinutes(13 * 60 + 30)).toBe('lunch');
    expect(mealTypeForMinutes(18 * 60)).toBe('snack');
    expect(mealTypeForMinutes(23 * 60 + 50)).toBe('dinner');
  });

  it('abre a medianoche fuera del periodo actual aunque haya eventos y enfoca ahora cuando hoy aparece', () => {
    const window = { startMinutes: 0, endMinutes: 24 * 60 };
    expect(scrollTopFor(window, false, at(9))).toBe(0);
    expect(scrollTopFor(window, true, at(9))).toBe(((at(9) - 30) / 60) * HOUR_HEIGHT_PX);
  });

  it('una madrugada con evento futuro conserva el foco de ahora dentro del día completo', () => {
    const now = at(2, 8);
    const window = windowFor();
    expect(scrollTopFor(window, true, now)).toBe(
      ((now - 30 - window.startMinutes) / 60) * HOUR_HEIGHT_PX
    );
    expect(scrollTopFor(window, false, now)).toBe(0);
  });
});
