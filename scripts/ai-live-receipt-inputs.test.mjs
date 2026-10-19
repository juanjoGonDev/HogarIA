import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { loadAiLiveReceiptPlan } from './ai-live-receipt-inputs.mjs';

const PDF = Buffer.from('%PDF-1.7\nsynthetic fixture\n');
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9
]);

async function fixtureDirectory(t, entries) {
  const directory = await mkdtemp(join(tmpdir(), 'hogaria-ai-receipt-inputs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(
    Object.entries(entries).map(([name, bytes]) => writeFile(join(directory, name), bytes))
  );
  return directory;
}

const SIX_SOURCES = {
  '01.pdf': PDF,
  '02.pdf': PDF,
  '03.jpg': JPEG,
  '04.jpeg': JPEG,
  '05.jpg': JPEG,
  '06.jpeg': JPEG
};

test('agrupa dos PDF, una JPEG elegida y tres tramos como un PDF multipágina en memoria', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);

  const plan = await loadAiLiveReceiptPlan({ directory, preferredJpegOrdinal: 2 });

  assert.equal(plan.sourceCount, 6);
  assert.equal(plan.ticketCount, 4);
  assert.deepEqual(
    plan.tickets.map(({ kind, sourceFileCount, pageCount }) => ({
      kind,
      sourceFileCount,
      pageCount
    })),
    [
      { kind: 'pdf', sourceFileCount: 1, pageCount: null },
      { kind: 'pdf', sourceFileCount: 1, pageCount: null },
      { kind: 'jpeg', sourceFileCount: 1, pageCount: 1 },
      { kind: 'pdf', sourceFileCount: 3, pageCount: 3 }
    ]
  );
  assert.deepEqual(Object.keys(plan.tickets[0]).sort(), [
    'buffer',
    'kind',
    'mimeType',
    'pageCount',
    'sourceFileCount'
  ]);
  assert.equal(plan.tickets[2].buffer.equals(JPEG), true);
  const composite = plan.tickets[3].buffer.toString('latin1');
  assert.match(composite, /^%PDF-1\.4/);
  assert.match(composite, /\/Count 3/);
  assert.equal((composite.match(/\/Subtype \/Image/g) ?? []).length, 3);
  assert.equal((composite.match(/\/BitsPerComponent 8/g) ?? []).length, 3);
  assert.equal(JSON.stringify(plan).includes('04.jpeg'), false);
});

test('unsubmitted-only devuelve JPEG + PDF largo y nunca lee los PDF ya enviados', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);
  const reads = [];

  const plan = await loadAiLiveReceiptPlan({
    directory,
    preferredJpegOrdinal: 2,
    selection: 'unsubmitted-only',
    readFileImpl: async (path) => {
      reads.push(basename(path));
      return readFile(path);
    }
  });

  assert.equal(plan.sourceCount, 6);
  assert.equal(plan.ticketCount, 2);
  assert.equal(plan.selection, 'unsubmitted-only');
  assert.deepEqual(
    plan.tickets.map(({ kind, sourceFileCount, pageCount }) => ({
      kind,
      sourceFileCount,
      pageCount
    })),
    [
      { kind: 'jpeg', sourceFileCount: 1, pageCount: 1 },
      { kind: 'pdf', sourceFileCount: 3, pageCount: 3 }
    ]
  );
  assert.equal(plan.tickets[0].buffer.equals(JPEG), true);
  assert.deepEqual(reads.sort(), ['03.jpg', '04.jpeg', '05.jpg', '06.jpeg']);
  assert.equal(
    reads.some((name) => name.endsWith('.pdf')),
    false
  );
});

test('long-ticket-only empaqueta solo las tres fotos no enviadas y no lee la JPEG ambigua ni PDFs', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);
  const reads = [];

  const plan = await loadAiLiveReceiptPlan({
    directory,
    preferredJpegOrdinal: 2,
    selection: 'long-ticket-only',
    readFileImpl: async (path) => {
      reads.push(basename(path));
      return readFile(path);
    }
  });

  assert.equal(plan.sourceCount, 6);
  assert.equal(plan.ticketCount, 1);
  assert.equal(plan.selection, 'long-ticket-only');
  assert.deepEqual(
    plan.tickets.map(({ kind, sourceFileCount, pageCount }) => ({
      kind,
      sourceFileCount,
      pageCount
    })),
    [{ kind: 'pdf', sourceFileCount: 3, pageCount: 3 }]
  );
  const composite = plan.tickets[0].buffer.toString('latin1');
  assert.match(composite, /^%PDF-1\.4/);
  assert.match(composite, /\/Count 3/);
  assert.equal((composite.match(/\/Subtype \/Image/g) ?? []).length, 3);
  assert.deepEqual(reads.sort(), ['03.jpg', '05.jpg', '06.jpeg']);
});

test('preferred-jpeg-only lee solo la JPEG elegida, sin abrir los otros cinco archivos', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);
  const reads = [];

  const plan = await loadAiLiveReceiptPlan({
    directory,
    preferredJpegOrdinal: 2,
    selection: 'preferred-jpeg-only',
    readFileImpl: async (path) => {
      reads.push(basename(path));
      return readFile(path);
    }
  });

  assert.equal(plan.sourceCount, 6);
  assert.equal(plan.ticketCount, 1);
  assert.equal(plan.selection, 'preferred-jpeg-only');
  assert.deepEqual(
    plan.tickets.map(({ kind, sourceFileCount, pageCount }) => ({
      kind,
      sourceFileCount,
      pageCount
    })),
    [{ kind: 'jpeg', sourceFileCount: 1, pageCount: 1 }]
  );
  assert.equal(plan.tickets[0].buffer.equals(JPEG), true);
  assert.deepEqual(reads, ['04.jpeg']);
});

test('rechaza toda selección de tickets no reconocida', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);

  await assert.rejects(
    loadAiLiveReceiptPlan({
      directory,
      preferredJpegOrdinal: 2,
      selection: 'everything-again'
    }),
    /selection/i
  );
});

test('no adivina qué JPEG priorizar si el usuario no indica su índice', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);

  await assert.rejects(loadAiLiveReceiptPlan({ directory }), /preferred.*JPEG/i);
});

test('rechaza carpetas hijas sin leerlas', async (t) => {
  const directory = await fixtureDirectory(t, SIX_SOURCES);
  await mkdir(join(directory, 'nested'));

  await assert.rejects(
    loadAiLiveReceiptPlan({ directory, preferredJpegOrdinal: 2 }),
    /exactly six regular/i
  );
});

test('rechaza cantidad, formato e índices inválidos antes de crear el PDF multipágina', async (t) => {
  const fiveFiles = await fixtureDirectory(t, {
    '01.pdf': PDF,
    '02.pdf': PDF,
    '03.jpg': JPEG,
    '04.jpeg': JPEG,
    '05.jpg': JPEG
  });

  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: fiveFiles, preferredJpegOrdinal: 1 }),
    /exactly six/i
  );

  const wrongExtension = await fixtureDirectory(t, {
    '01.pdf': PDF,
    '02.pdf': PDF,
    '03.jpg': JPEG,
    '04.jpeg': JPEG,
    '05.jpg': JPEG,
    '06.png': JPEG
  });
  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: wrongExtension, preferredJpegOrdinal: 1 }),
    /exactly six/i
  );

  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: fiveFiles, preferredJpegOrdinal: 5 }),
    /exactly six/i
  );
  const goodDirectory = await fixtureDirectory(t, SIX_SOURCES);
  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: goodDirectory, preferredJpegOrdinal: 5 }),
    /preferred.*JPEG/i
  );
});

test('valida firmas JPEG/PDF y el límite de 10 MiB antes de aceptar archivos', async (t) => {
  const badPdf = await fixtureDirectory(t, { ...SIX_SOURCES, '02.pdf': JPEG });
  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: badPdf, preferredJpegOrdinal: 1 }),
    /signature/i
  );

  const badJpeg = await fixtureDirectory(t, { ...SIX_SOURCES, '04.jpeg': PDF });
  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: badJpeg, preferredJpegOrdinal: 1 }),
    /signature/i
  );

  const tooLarge = await fixtureDirectory(t, {
    ...SIX_SOURCES,
    '01.pdf': Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])
  });
  await assert.rejects(
    loadAiLiveReceiptPlan({ directory: tooLarge, preferredJpegOrdinal: 1 }),
    /10 MiB/i
  );
});
