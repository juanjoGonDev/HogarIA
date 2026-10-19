/**
 * El extractor incremental de lineas del stream (HOGARIA-SPEC ## 12aj).
 *
 * El parte pide que lo analizado «se vaya viendo poco a poco», y eso solo es honesto si las
 * lineas se guardan cuando el modelo las va CERRANDO, no cuando termina y llegan todas de golpe.
 * Como el modelo escribe un unico JSON, aqui se lee el trozo que ya ha llegado y se extraen los
 * objetos de `lines` que ya estan completos —llave por llave, respetando las cadenas con
 * comillas y escapes dentro—, dejando el resto para el siguiente trozo.
 *
 * Es una funcion pura con su spec al lado: el sitio donde un parser puede romperse en silencio.
 */

export interface LineaExtraida {
  /** La cadena cruda del objeto, para `JSON.parse` fuera de aqui. */
  crudo: string;
  /** Desplazamiento del objeto dentro del buffer, para saber que ya esta consumido. */
  desde: number;
}

/**
 * Extrae del `buffer` los objetos de `lines` que ya estan completos, sin consumir mas alla del
 * ultimo objeto cerrado. Se le pasa el buffer ENTERO acumulado y el numero de objetos que ya se
 * entregaron, y devuelve los nuevos.
 *
 * El contracto fino:
 *  - busca `"lines"` y su `[`; si todavia no existen, no hay nada (el modelo esta escribiendo
 *    el `store` o pensando);
 *  - un objeto se considera completo cuando su llave de apertura tiene su cierre, contando las
 *    llaves DENTRO de cadenas (un `"note": "}" }` no engana al contador);
 *  - si el modelo abre `warnings` o `totalMinor` despues de cerrar el `]` de lines, no pasa
 *    nada: solo se leen objetos dentro del array.
 */
export function lineasNuevas(buffer: string, yaEntregados: number): LineaExtraida[] {
  const arranque = /"(?:lines)"\s*:\s*\[/.exec(buffer);
  if (!arranque) return [];
  let i = arranque.index + arranque[0].length;

  const salida: LineaExtraida[] = [];
  let vistos = 0;
  while (i < buffer.length) {
    // Salta lo que no sea el comienzo de un objeto: comas, espacios, saltos.
    const ch = buffer[i];
    if (ch === ']' || ch === '}') break;
    if (ch !== '{') {
      i += 1;
      continue;
    }

    // Lee el objeto contando llaves y respetando cadenas.
    let profundidad = 0;
    let enCadena = false;
    let escape = false;
    let fin = -1;
    for (let j = i; j < buffer.length; j += 1) {
      const c = buffer[j];
      if (enCadena) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') enCadena = false;
        continue;
      }
      if (c === '"') {
        enCadena = true;
        continue;
      }
      if (c === '{') profundidad += 1;
      else if (c === '}') {
        profundidad -= 1;
        if (profundidad === 0) {
          fin = j;
          break;
        }
      }
    }
    if (fin === -1) break; // el objeto aun no esta completo: esperar mas trozo

    if (vistos >= yaEntregados) salida.push({ crudo: buffer.slice(i, fin + 1), desde: i });
    vistos += 1;
    i = fin + 1;
  }
  return salida;
}
