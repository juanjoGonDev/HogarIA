import { formatBytes, pendingLabelKey, shortId, storageUsage } from './account-info';

/**
 * El inventario de la cuenta es aritmética, y por eso se prueba aquí y no en una pantalla. Lo que
 * se comprueba es el criterio: que lo propio se cuente y lo ajeno no, y que un número grande se
 * diga en unidades que se entienden.
 */
describe('account-info', () => {
  const store: Record<string, string> = {
    'hogar:v1:auth_token': 'x'.repeat(120),
    'hogar:v1:theme': 'dark',
    'hogar:v1:logs': '[]',
    'otro:nada': 'no es nuestro'
  };
  const read = (key: string) => store[key] ?? '';

  it('cuenta solo lo que pertenece a la app', () => {
    const usage = storageUsage(Object.keys(store), read, 0);
    expect(usage.entries).toBe(3);
    // Dos bytes por caracter (UTF-16), y la clave pesa igual que el valor.
    const expected =
      ('hogar:v1:auth_token'.length + 120) * 2 + ('hogar:v1:theme'.length + 4) * 2 + ('hogar:v1:logs'.length + 2) * 2;
    expect(usage.bytes).toBe(expected);
    expect(usage.pending).toBe(0);
  });

  it('un almacenamiento vacio no es un error, es cero', () => {
    expect(storageUsage([], () => '', 0)).toEqual({ entries: 0, bytes: 0, pending: 0 });
    expect(formatBytes(0)).toBe('0 B');
  });

  it('los bytes se leen en unidades que se entienden', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(3400)).toBe('3,3 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatBytes(-9)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });

  it('la cola se dice en plural solo cuando toca', () => {
    // Se elige clave, no frase: el plural lo decide el diccionario, y aqui solo llega el numero.
    expect(pendingLabelKey(0)).toBe('account.nada_pendiente_de');
    expect(pendingLabelKey(1)).toBe('account.una_escritura_esperando');
    expect(pendingLabelKey(7)).toBe('account.n_escrituras_esperando');
  });

  it('el id se recorta por los dos lados, y un id vacio no se inventa', () => {
    expect(shortId('i1dQ8JFndXzWErgMOHskJ')).toBe('i1dQ8JFn…HskJ');
    expect(shortId('corto')).toBe('corto');
    expect(shortId('')).toBe('—');
    expect(shortId(null)).toBe('—');
  });
});
