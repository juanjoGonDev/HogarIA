import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El almacen de logs y su salida en vivo.
 *
 * El visor de la aplicacion tiene dos patas: el anillo de memoria (de donde salen los
 * `GET /api/logs`) y el stream SSE (por donde llega lo nuevo sin recargar). Durante
 * rondas enteras solo la primera estaba conectada a `console`: el servidor escribia, el
 * anillo se llenaba, y la pantalla de logs seguia enseñando lo de siempre hasta un F5.
 * Ese es el «no veo logs desde la UI» con el que alguien acabo abriendo `docker logs`.
 *
 * Lo que se prueba aqui es que ENTRA y que SE AVISA, desde un unico punto: cualquier cosa
 * que acabe en el anillo tiene que llegar tambien a los suscriptores.
 */

type Entry = { timestamp: string; level: string; source: string; message: string };

let addLog: (entry: Entry) => void;
let getLogs: (options?: { limit?: number }) => Entry[];
let clearLogs: () => void;
let totalLogs: () => number;
let onLogEntry: (listener: (entry: Entry) => void) => () => void;

beforeEach(async () => {
  vi.resetModules();
  const store = await import('./log-store.js');
  addLog = store.addLog as typeof addLog;
  getLogs = store.getLogs as typeof getLogs;
  clearLogs = store.clearLogs;
  totalLogs = store.totalLogs;
  onLogEntry = store.onLogEntry;
  clearLogs();
});

const entry = (message: string): Entry => ({ timestamp: new Date().toISOString(), level: 'log', source: 'server', message });

describe('el anillo', () => {
  it('guarda y corta por el maximo, conservando lo ultimo', () => {
    for (let i = 0; i < 1600; i += 1) addLog(entry(`linea-${i}`));
    // 1500 es el techo historico del visor; lo que se cae son las mas viejas, nunca las
    // que se esta mirando.
    expect(totalLogs()).toBe(1500);
    const recent = getLogs({ limit: 3 });
    expect(recent.map((l) => l.message)).toEqual(['linea-1599', 'linea-1598', 'linea-1597']);
  });

  it('un suscriptor que lanza no se lleva al resto por delante', () => {
    const seen: string[] = [];
    const offBad = onLogEntry(() => {
      throw new Error('el listener del stream se cayo con una escritura a media conexion');
    });
    const offGood = onLogEntry((received) => seen.push(received.message));

    addLog(entry('hola'));
    expect(seen).toEqual(['hola']);

    offBad();
    offGood();
    addLog(entry('adios'));
    expect(seen).toEqual(['hola']);
  });
});

describe('la salida en vivo', () => {
  it('toda entrada nueva se notifica, y lo leido no se reenvia', () => {
    const seen: string[] = [];
    const off = onLogEntry((received) => seen.push(received.message));

    addLog(entry('primera'));
    addLog(entry('segunda'));
    expect(seen).toEqual(['primera', 'segunda']);

    // Suscribirse despues no dispara un vaciado del historico: el `GET /api/logs` ya se
    // encarga de eso, y duplicarlo aqui mandaria 500 lineas por el stream a cada visita.
    const late: string[] = [];
    const offLate = onLogEntry((received) => late.push(received.message));
    expect(late).toEqual([]);

    off();
    addLog(entry('tercera'));
    expect(seen).toEqual(['primera', 'segunda']);
    expect(late).toEqual(['tercera']);
    offLate();
  });
});
