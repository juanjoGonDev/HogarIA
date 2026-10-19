/**
 * Semilla de datos de un run de la suite e2e.
 *
 * Cada prueba registra su propio usuario; con la semilla esos usuarios son
 * rastreables: el correo es `e2e-<semilla>-<n>@example.com`, así que se puede
 * saber que filas dejo UN run concreto (y repetirlo con E2E_SEED=...).
 *
 * La pone `global-setup.ts` en el entorno comun: el reporter, los workers y el
 * backend arrancado por Playwright ven la misma semilla.
 */
export const E2E_SEED: string = process.env.E2E_SEED ??= `s${Date.now().toString(36)}`;

let counter = 0;

/**
 * Correo unico para cada registro, con la semilla a la vista.
 *
 * El identificador tiene que ser unico POR CONSTRUCCION, no por contador en
 * memoria. Cuando esto era solo `e2e-<semilla>-<contador>`, Playwright (que
 * relanza el worker despues de cada fallo para no contaminar el siguiente test)
 * volvía a empezar el contador en 1: cada reintento pedía el MISMO alta, el
 * backend contestaba 409, y la cascada se comio 2 minutos por test hasta dejar el
 * job de CI colgado durante horas. El sufijo lleva el reloj y un aleatorio, asi
 * que dos procesos, dos shards o dos reintentos nunca colisionan; el contador se
 * queda porque ordena los correos de un mismo worker y hace el log legible.
 */
export function seededEmail(): string {
  counter += 1;
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `e2e-${E2E_SEED}-${counter}-${unique}@example.com`;
}

/** Identificador de datos del test actual, para anotarlo y verlo en el log. */
export function dataSeed(key: string): string {
  return `${E2E_SEED}/${key}`;
}
