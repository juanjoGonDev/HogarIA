import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * El espejo de las comidas entre el server y la app, vigilado.
 *
 * `MEAL_TYPE_KEYS`, `MEAL_TIME_DEFAULTS` y `MEAL_TYPE_LABELS` de `taste-profile.ts` son el contrato: lo
 * que se guarda, lo que se le envia a la IA y el orden del dia. La app tiene sus propias copias
 * (`frontend/src/app/core/meal-times.ts` y `shared/models/calendar.model.ts`) porque son dos
 * compilaciones distintas y el frontend no puede importar un fichero del server que arrastra
 * better-sqlite3.
 *
 * Dos copias de unos numeros sin un test que las compare es la receta de «la app dice 20:30 y la IA
 * planifica la cena a las 21:00», que se cuela en un code review porque cada lado, solo, parece correcto.
 * Por eso esto compara los literales del fuente: si alguien mueve la constante de sitio, el regex falla y
 * el test avisa, en vez de pasar en verde sin comparar nada.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function read(relative: string): string {
  return readFileSync(resolve(repoRoot, relative), 'utf8');
}

/** `export const NAME ... = { clave: 'valor', ... }` ignorando los comentarios. */
function objectEntries(source: string, name: string): Record<string, string> {
  // `\n}` con `;` o con ` as const;`: el diccionario del frontend cierra asi, y exigir la forma corta
  // hacia que el regex no encontrara el bloque y el test «pasara» sin comparar nada.
  const body = new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}(?: as const)?;`).exec(source)?.[1];
  if (!body) throw new Error(`${name} ya no esta como estaba: actualiza este test`);

  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('*') || clean.startsWith('/') || clean.startsWith('//')) continue;
    // El valor puede venir entrecomillado (las horas, las etiquetas) o pelado (los booleanos del plan):
    // sin la segunda forma, `MEAL_PLAN_DEFAULTS` se leeria vacio en los dos lados y el `toEqual` daria
    // verde sin comparar nada, que es peor que no tener test.
    // La clave admite puntos: en el diccionario del frontend (`uiEs`) son `meal.breakfast`, y sin el punto
    // el parser no veia ninguna pareja y el `toEqual` se ponia verde comparando dos objetos vacios.
    const pair =
      /^'?(?<key>[\w.-]+)'?:\s*(?:'(?<value>[^']*)'|(?<bare>true|false|null|-?\d+(?:\.\d+)?)),?$/.exec(clean);
    if (pair?.groups) out[pair.groups.key] = pair.groups.value ?? pair.groups.bare ?? '';
  }
  return out;
}

/** `export const NAME = ['a', 'b'] as const` -> la lista, en orden. */
function arrayConst(source: string, name: string): string[] {
  const body = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source)?.[1];
  if (!body) throw new Error(`${name} ya no esta como estaba: actualiza este test`);
  return body
    .split(',')
    .map((entry) => entry.trim().replace(/'/g, ''))
    .filter(Boolean);
}

const server = read('server/src/utils/taste-profile.ts');
const frontendTimes = read('frontend/src/app/core/meal-times.ts');
const frontendModel = read('frontend/src/app/shared/models/calendar.model.ts');

describe('las comidas son las mismas en los dos lados', () => {
  it('los cuatro horarios por defecto coinciden', () => {
    // En el modelo compartido, no en `meal-times.ts`: `app-meal-hours` (design system) y la app tienen
    // que leer el mismo literal, y un `export {...} from` no es un segundo sitio donde cambiar horas.
    expect(objectEntries(frontendModel, 'MEAL_TIME_DEFAULTS')).toEqual(
      objectEntries(server, 'MEAL_TIME_DEFAULTS')
    );
  });

  it('los cuatro permisos de planificacion por defecto coinciden (12t-T)', () => {
    // «Que la IA te planifique la cena» vale solo si los dos lados entienden lo mismo por «no he tocado
    // el interruptor nunca»: si la app creyera que por defecto NO se planifica la merienda, el usuario
    // veria como un fallo de la IA lo que es un desajuste de dos literales.
    expect(objectEntries(frontendModel, 'MEAL_PLAN_DEFAULTS')).toEqual(
      objectEntries(server, 'MEAL_PLAN_DEFAULTS')
    );
    // Y el defecto es «si» en las cuatro: se escribe aqui, y no por omision, para que el assert anterior
    // no pueda ponerse verde cambiando los dos lados a la vez.
    expect(objectEntries(server, 'MEAL_PLAN_DEFAULTS')).toEqual({
      breakfast: 'true',
      lunch: 'true',
      snack: 'true',
      dinner: 'true'
    });
  });

  it('el orden del dia es el mismo: la merienda antes que la cena', () => {    const order = arrayConst(server, 'MEAL_TYPE_KEYS');

    expect(order).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(arrayConst(frontendModel, 'MEAL_ORDER')).toEqual(order);
  });

  it('los nombres en español coinciden, comida por comida', () => {
    // Desde ## 12u la app ya no tiene su propio `MEAL_TYPE_LABELS`: ese catalogo estaba en el modelo, en
    // espanol, y lo pintaban cuatro pantallas como si fuera un dato. Lo que se ensena sale ahora del
    // diccionario (`meal.breakfast`...), que es lo que compara este test —y compara lo correcto: si la
    // etiqueta en castellano se separa de la cadena del prompt, la pantalla dice una cosa y la IA otra.
    const serverLabels = objectEntries(server, 'MEAL_TYPE_LABELS');
    const dict = objectEntries(read('frontend/src/app/core/i18n/dict/ui.ts'), 'uiEs');

    for (const type of arrayConst(server, 'MEAL_TYPE_KEYS')) {
      expect(dict[`meal.${type}`]).toBe(serverLabels[type]);
    }
  });

  it('el frontend no se ha hecho una lista de tipos propia', () => {
    // Las horas por defecto si se repiten, a proposito: son el espejo del server. La LISTA de comidas
    // no: si alguien vuelve a escribir los cuatro literales en `meal-times.ts`, manana hay dos ordenes
    // del dia y solo uno de ellos se acuerda de la merienda.
    // El fondo, no la forma: si el import ocupa cuatro lineas porque si (prettier, o anadir
    // MEAL_TIME_DEFAULTS) no por eso hay dos listas de comidas. Lo que no puede pasar es que
    // `meal-times.ts` vuelva a escribir los literales.
    expect(frontendTimes).toMatch(
      /import\s*\{[\s\S]*?\bMEAL_ORDER\b[\s\S]*?\}\s*from\s*'\.\.\/shared\/models\/calendar\.model'/
    );
    expect(frontendTimes).not.toMatch(/\[\s*'breakfast'/);
    expect(frontendTimes).not.toMatch(/export const MEAL_(ORDER|TYPE_LABELS|TIME_DEFAULTS)/);
    // El reexport de 12t-T anadio `MEAL_PLAN_DEFAULTS`/`MealPlan` a la misma linea: se sigue exigiendo
    // en su forma completa, porque una linea de reexport es exactamente lo que no puede volverse a
    // escribir a mano el dia de manana.
    expect(frontendTimes).toMatch(
      /export \{ MEAL_PLAN_DEFAULTS, MEAL_TIME_DEFAULTS, MealPlan, MealTimes \};/
    );
  });
});
