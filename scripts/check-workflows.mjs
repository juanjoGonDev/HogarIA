#!/usr/bin/env node
// =============================================================================
// Guarda de los YAML de Actions, sin dependencias.
//
// Por que existe: un `- name: Texto (con: dos puntos)` sin comillas NO es un
// string, es YAML intentando abrir un mapa, y el error no tumba ese step: tumba
// el workflow ENTERO. Lo peor no es el fallo, es el silencio: GitHub no crea
// ningun check en el PR, asi que cinco pushes pasaron por "verdes" sin que
// corriera nada (solo habia un run de 0s llamado ".github/workflows/ci.yml" con
// cero jobs). El regex es intencionadamente estrecho: solo caza el patron que
// hizo dano de verdad, no re-implementa un parser YAML.
//
// Uso: node scripts/check-workflows.mjs   (o  make ci:yaml)
// =============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = '.github/workflows';
// Valor plano (sin comillas, sin |, >, &, *) que lleva `: ` dentro: eso es un
// mapa anidado para YAML, no un escalar.
const UNQUOTED_MAP_VALUE = /^(\s*)([A-Za-z0-9_-]+):\s+(?![|>&*'"@`])([^#]*?:\s)/;

const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const problems = [];

for (const file of files) {
  const path = join(dir, file);
  const text = readFileSync(path, 'utf8');

  text.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('#')) return;

    if (line.includes('\t')) {
      problems.push(`${path}:${index + 1}: tabuladores (YAML solo admite espacios)`);
    }

    const match = UNQUOTED_MAP_VALUE.exec(line);
    if (match) {
      problems.push(
        `${path}:${index + 1}: valor sin comillas con ": " dentro -> ${line.trim()}\n` +
          `            escribelo entre comillas simples: ${match[2]}: '${match[3].trim()}'`
      );
    }
  });

  const lines = text.split('\n');

  // Contextos que GitHub NO tiene en el `env` de nivel workflow. Es el error que
  // nadie ve: el fichero se valida, no se ejecuta, y el resultado es un run de 0s
  // sin jobs y SIN NINGUN check en el PR. `runner.*` y `hashFiles()` solo existen
  // dentro de un job (en los `with:` de los pasos, entre otros).
  const envStart = lines.findIndex((line) => /^env:/.test(line));
  if (envStart !== -1) {
    for (let index = envStart + 1; index < lines.length; index++) {
      const line = lines[index];
      if (/^[A-Za-z_-]+:/.test(line)) break; // siguiente clave de nivel raiz
      if (/\$\{\{[^}]*(runner\.|hashFiles\()/.test(line)) {
        problems.push(
          `${path}:${index + 1}: expresion con runner./hashFiles() en el env del workflow -> ${line.trim()}\n` +
          `            mueve la expresion al paso que la usa (jobs.<id>.steps[*].with), que es donde existe`
        );
      }
    }
  }

  // `strategy.*` tampoco esta disponible en el nombre de un job; y un nombre roto
  // tumba el fichero entero, igual que un dos puntos sin comillas.
  lines.forEach((line, index) => {
    if (/^\s+name:.*\$\{\{[^}]*strategy\./.test(line)) {
      problems.push(
        `${path}:${index + 1}: strategy.* en el name de un job -> ${line.trim()}\n` +
        `            usa matrix.<clave> (o hardcodea el total: el numero de shards se decide aqui)`
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`✖ ${problems.length} problema(s) en los YAML de Actions:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nSi esto llega a CI, el workflow no parsea y no hay checks en el PR.');
  process.exit(1);
}

console.log(`✔ ${files.length} workflows revisados, nada que rompa el parseo.`);
