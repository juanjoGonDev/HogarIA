#!/usr/bin/env node
// =============================================================================
// Publica los fallos de Playwright como anotaciones del job (::error::…).
// Util cuando los logs/artefactos de Actions no son accesibles: las
// anotaciones se consultan con la API de check-runs.
// =============================================================================
import { existsSync, readFileSync } from 'node:fs';

const file = process.env.E2E_RESULTS_FILE || 'test-results/results.json';

const annotate = (message) => {
  // Los workflow commands no permiten saltos de linea ni '%' sin escapar.
  const safe = String(message)
    .replace(/\r?\n/g, ' ')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/::/g, '∶')
    .slice(0, 900);
  console.log(`::error::${safe}`);
};

if (!existsSync(file)) {
  annotate(
    `E2E: no se encontro ${file}. Playwright no llego a escribir resultados ` +
      '(posible fallo al arrancar el webServer de frontend/backend).'
  );
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const failures = [];

const walk = (suites, trail = []) => {
  for (const suite of suites ?? []) {
    const path = [...trail, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const bad = (test.results ?? []).filter((r) => r.status === 'failed' || r.status === 'timedOut');
        if (bad.length === 0) continue;
        const err = bad
          .map((r) =>
            (r.error?.message || r.status)
              .replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
              .split('\n')
              .slice(0, 6)
              .join(' ')
              .slice(0, 600)
          )
          .join(' || ');
        failures.push({ title: [...path, spec.title].join(' > '), err });
      }
    }
    walk(suite.suites, path);
  }
};

walk(report.suites);

const total = report.stats?.total ?? '?';
const failed = report.stats?.failed ?? failures.length;
annotate(`E2E resumen: ${failed} fallidos / ${total} tests`);

for (const f of failures.slice(0, 60)) {
  annotate(`${f.title} :: ${f.err}`);
}
