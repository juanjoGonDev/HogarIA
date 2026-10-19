'use strict';

/**
 * Reporter de la suite e2e de HogarIA, con la forma de salida de vitest/jest:
 *
 *   1. cabecera con la SEMILLA del run (los usuarios de prueba se generan a
 *      partir de ella: `e2e-<seed>-<n>@example.com`), workers, proyectos y total
 *   2. una linea por `it`, con el arbol de `describe`s, la duracion y la semilla
 *      de datos de ese test, para poder rastrear las filas que dejo en la BD
 *   3. los FALLOS CONCENTRADOS antes del summary: que se esperaba, que se
 *      obtuvo, donde, con la URL de la pagina y las rutas del video/captura,
 *      para no tener que subir y bajar por el log buscandolos
 *   4. summary: contadores por estado, tiempo total y los cinco test mas lentos
 *
 * Ademas vuelca `test-results/hogaria-run.json` (semilla, contadores, duracion,
 * test mas lentos) para que el resumen sea consultable a maquina despues del run.
 *
 * Sin dependencias: Playwright carga el modulo y llama a los `onX`.
 */

const fs = require('node:fs');
const path = require('node:path');

const GLYPH = {
  passed: '✓',
  failed: '✗',
  timedOut: '⏱',
  flaky: '⚠',
  skipped: '○',
  interrupted: '⌁'
};

function formatMs(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** Relativo al repo cuando tiene sentido; absoluto si vive fuera (adjuntos temporales). */
function relative(file) {
  if (!file) return '';
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel;
}

/** Primeras lineas utiles de un error, sin stack completo (eso va despues). */
function errorHead(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';
  const [first, ...rest] = text.split('\n');
  const detail = rest
    .map((line) => line.trim())
    .filter((line) => /expected|received|Timeout|waiting for|Error|locator|strict mode/i.test(line))
    .slice(0, 4);
  return [first.trim(), ...detail].join('\n            ');
}

/** Playwright entrega buffers o objetos con `buffer`: los dos caben aqui. */
function textOf(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (Buffer.isBuffer(entry)) return entry.toString('utf8');
  if (entry.buffer) return textOf(entry.buffer);
  return '';
}

function tailStdio(entries, limit) {
  const text = (entries ?? []).map(textOf).join('').trim();
  if (!text) return [];
  return text.split('\n').slice(-limit);
}

class HogarE2EReporter {
  constructor() {
    this.startedAt = Date.now();
    this.failures = [];
    this.durations = [];
    this.counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, interrupted: 0 };
  }

  onBegin(config, suite) {
    this.config = config;
    this.suite = suite;
    const seed = process.env.E2E_SEED || '(sin semilla)';
    const projects = (config.projects ?? []).map((project) => project.name).join(', ');
    const retries = config.config?.retries ?? 0;
    const filter = process.env.E2E_GREP ? `  · grep ${process.env.E2E_GREP}` : '';

    console.log('');
    console.log('  HogarIA · suite e2e');
    console.log(`  semilla ${seed} · workers ${config.workers ?? 'auto'} · proyectos ${projects}`);
    console.log(`  ${suite.allTests().length} test · retries ${retries}${filter}`);
    console.log('');
  }

  onTestEnd(test, result) {
    const status = result.status;
    if (status in this.counts) this.counts[status] += 1;
    else this.counts.failed += 1;

    const title = test.titlePath().slice(1).join(' › ');
    const project = test.project?.()?.name ?? '';
    const seed = (result.annotations ?? []).find((a) => a.type === 'seed')?.description;
    const retry = result.retry > 0 ? `  (reintento ${result.retry + 1}/${test.retries ?? 0})` : '';

    this.durations.push({
      title,
      project,
      duration: result.duration,
      status,
      seed
    });

    console.log(
      `  ${GLYPH[status] ?? '?'} ${project ? `[${project}] ` : ''}${title}` +
        `  ${formatMs(result.duration)}` +
        (seed ? `  · datos ${seed}` : '') +
        retry
    );

    if (status === 'failed') this.failures.push({ test, result });
  }

  onEnd(result) {
    if (this.failures.length > 0) {
      console.log('');
      console.log(`  ── FALLOS (${this.failures.length}) ──────────────────────────────`);
      this.failures.forEach(({ test, result }, index) => {
        const location = result.error?.location ?? test.location;
        console.log('');
        console.log(
          `  ${index + 1}) ${test.titlePath().slice(1).join(' › ')}` +
            `  [${test.project?.()?.name ?? ''}]`
        );
        console.log(`     ${relative(location?.file)}:${location?.line ?? '?'}`);
        for (const error of result.errors.length ? result.errors : [result.error]) {
          if (!error) continue;
          console.log(`     ${errorHead(error.message || error.value)}`);
          if (error.snippet) {
            for (const line of error.snippet.split('\n').slice(0, 6)) {
              console.log(`       ${line}`);
            }
          }
        }

        const pageUrl = (result.annotations ?? []).find((a) => a.type === 'page')?.description;
        if (pageUrl) console.log(`     pagina: ${pageUrl}`);

        for (const attachment of result.attachments ?? []) {
          if (!attachment.path || !/(video|screenshot|trace|error-context)/.test(attachment.name)) continue;
          console.log(`     ${attachment.name}: ${relative(attachment.path)}`);
        }

        for (const line of tailStdio(result.stdout, 3)) {
          console.log(`     stdout: ${line}`);
        }
      });
    }

    const slowest = [...this.durations]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
    const total = Date.now() - this.startedAt;
    const statusLine = Object.entries(this.counts)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${value} ${key}`)
      .join(' · ');

    console.log('');
    console.log(`  ── SUMMARY ────────────────────────────────────────────`);
    console.log(`  ${statusLine || '0 test'}  ·  ${formatMs(total)}  ·  estado ${result.status}`);
    if (slowest.length > 0) {
      console.log(`  mas lentos:`);
      for (const item of slowest) {
        console.log(`    ${formatMs(item.duration).padStart(8)}  ${item.title}`);
      }
    }
    if (this.failures.length > 0) {
      console.log(`  reintentar solo lo que fallo:  npx playwright test --last-failed`);
    }
    console.log('');

    this.#writeRunFile(result.status);
  }

  #writeRunFile(status) {
    try {
      const dir = path.join(process.cwd(), 'test-results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'hogaria-run.json'),
        JSON.stringify(
          {
            seed: process.env.E2E_SEED ?? null,
            status,
            counts: this.counts,
            durationMs: Date.now() - this.startedAt,
            failures: this.failures.map(({ test, result }) => ({
              title: test.titlePath().slice(1).join(' › '),
              project: test.project?.()?.name ?? '',
              file: relative(test.location.file),
              line: test.location.line,
              error: String(result.error?.message ?? result.errors?.[0]?.message ?? '').split(
                '\n'
              )[0]
            })),
            slowest: [...this.durations]
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 10)
              .map(({ title, project, duration, status: testStatus }) => ({
                title,
                project,
                duration,
                status: testStatus
              })),
            durations: this.durations
          },
          null,
          2
        )
      );
    } catch {
      // El reporter nunca rompe un run: si no puede escribir, se queda en el log.
    }
  }

  printsToStdio() {
    return true;
  }
}

module.exports = HogarE2EReporter;
