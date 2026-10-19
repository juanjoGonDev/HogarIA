import { nextDelay, openResilientStream, type EventSourceLike, type StreamStatus } from './sse';

/**
 * El cliente SSE es la unica pieza de la app que puede hacer peticiones SIN que nadie la
 * maneje: el navegador reconecta solo. Este spec no prueba que se vea bonito, prueba que
 * el numero de conexiones por minuto es acotado —que es exactamente lo que dejo a toda la
 * casa sin poder navegar ni ver logs mientras el visor seguia vacio.
 */

class FakeSource implements EventSourceLike {
  onopen: ((this: unknown, ev: unknown) => void) | null = null;
  onerror: ((this: unknown, ev: unknown) => void) | null = null;
  onmessage: ((this: unknown, ev: { data: string }) => void) | null = null;
  closed = false;
  static opened: FakeSource[] = [];

  constructor(public url: string) {
    FakeSource.opened.push(this);
  }

  addEventListener(_type: string, _listener: (ev: { data: string }) => void): void {
    /* no se usa en estos casos */
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.(null);
  }

  emitError(): void {
    this.onerror?.(null);
  }
}

describe('backoff del stream', () => {
  it('crece y se queda en el maximo', () => {
    expect(nextDelay(0)).toBe(0);
    expect(nextDelay(1)).toBe(1000);
    expect(nextDelay(2)).toBe(2000);
    expect(nextDelay(3)).toBe(5000);
    expect(nextDelay(4)).toBe(10_000);
    // Y a partir de aqui no sigue creciendo: un reintento cada media hora no sirve.
    expect(nextDelay(5)).toBe(30_000);
    expect(nextDelay(400)).toBe(30_000);
  });
});

describe('openResilientStream', () => {
  let statuses: StreamStatus[] = [];

  const open = (options: { maxRetries?: number } = {}) =>
    openResilientStream('/api/logs/stream', {
      onMessage: () => undefined,
      maxRetries: options.maxRetries,
      sourceFactory: (url) => new FakeSource(url),
      onStatus: (status) => statuses.push(status)
    });

  beforeEach(() => {
    FakeSource.opened = [];
    statuses = [];
    // Reloj simulado, porque lo que se comprueba aqui es el TIEMPO entre reintentos.
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('abre una vez y se declara en vivo', () => {
    open();
    expect(FakeSource.opened).toHaveSize(1);
    FakeSource.opened[0].emitOpen();
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('reconecta con espera creciente y corta la conexion vieja', () => {
    const handle = open({ maxRetries: 3 });

    FakeSource.opened[0].emitError();
    expect(FakeSource.opened[0].closed).toBeTrue();
    // El navegador habria reintentado YA, otra vez, y otra. Aqui hay una espera.
    expect(FakeSource.opened).toHaveSize(1);
    expect(handle.status()).toBe('retrying');

    jasmine.clock().tick(1000);
    expect(FakeSource.opened).toHaveSize(2);

    FakeSource.opened[1].emitError();
    jasmine.clock().tick(1999);
    expect(FakeSource.opened).toHaveSize(2);
    jasmine.clock().tick(1);
    expect(FakeSource.opened).toHaveSize(3);
    handle.close();
  });

  it('se rinde en vez de martillar para siempre', () => {
    const handle = open({ maxRetries: 2 });
    for (let i = 0; i < 6; i += 1) {
      FakeSource.opened[FakeSource.opened.length - 1].emitError();
      jasmine.clock().tick(60_000);
    }
    // Una conexion inicial + dos reintentos. Las cuatro restantes del bucle no existen.
    expect(FakeSource.opened).toHaveSize(3);
    expect(handle.status()).toBe('closed');
  });

  it('un fallo despues de estar en vivo vuelve a empezar la cuenta', () => {
    const handle = open({ maxRetries: 2 });
    FakeSource.opened[0].emitOpen();
    FakeSource.opened[0].emitError();
    jasmine.clock().tick(1000);
    FakeSource.opened[1].emitOpen();
    FakeSource.opened[1].emitError();
    jasmine.clock().tick(1000);
    // Sin el reset, el segundo ciclo ya estaria en el segundo escalon y tardaria el doble.
    expect(FakeSource.opened).toHaveSize(3);
    expect(handle.status()).toBe('connecting');
    handle.close();
  });

  it('close() no deja timers pendientes', () => {
    const handle = open();
    FakeSource.opened[0].emitError();
    handle.close();
    jasmine.clock().tick(120_000);
    expect(FakeSource.opened).toHaveSize(1);
  });

  it('ignora errores tardíos del EventSource después del cierre explícito', () => {
    const handle = open({ maxRetries: 2 });
    const source = FakeSource.opened[0];

    handle.close();
    source.emitError();
    jasmine.clock().tick(120_000);

    expect(handle.status()).toBe('closed');
    expect(FakeSource.opened).toHaveSize(1);
    expect(statuses).toEqual(['connecting', 'closed']);
  });
});
