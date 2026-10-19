import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from './fixtures';
import { seededEmail } from './helpers/seed';

test.skip(process.env.E2E_NGINX_INGRESS !== '1', 'requiere el runner aislado con Nginx real');

const TICKET_BYTES = 513 * 1024;
const MAX_TICKET_BYTES = 10 * 1024 * 1024;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function pngSynthetic(targetBytes = TICKET_BYTES): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const beforeText = [
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0])))
  ];
  const afterText = [pngChunk('IEND', Buffer.alloc(0))];
  const keyword = Buffer.from('Comment\0', 'latin1');
  const textPaddingBytes =
    targetBytes -
    signature.byteLength -
    [...beforeText, ...afterText].reduce((total, chunk) => total + chunk.byteLength, 0) -
    12 -
    keyword.byteLength;
  if (textPaddingBytes < 0) throw new Error('PNG fixture no cabe en el límite solicitado.');
  const text = pngChunk('tEXt', Buffer.concat([keyword, Buffer.alloc(textPaddingBytes, 0x20)]));
  const png = Buffer.concat([signature, ...beforeText, text, ...afterText]);
  if (png.byteLength !== targetBytes) throw new Error('La PNG fixture no tiene el tamaño exacto.');
  return png;
}

async function uploadSignedTicket(
  page: Page,
  token: string,
  bytes: Buffer,
  fileName: string,
  mimeType: string
) {
  return page.evaluate(
    async ({ token, encodedBytes, fileName, mimeType }) => {
      const rawBytes = atob(encodedBytes);
      const fileBytes = Uint8Array.from(rawBytes, (character) => character.charCodeAt(0));
      const file = new File([fileBytes], fileName, { type: mimeType });
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/receipts', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          data?: { id?: string; fileKind?: string; fileName?: string };
        } | null
      };
    },
    { token, encodedBytes: bytes.toString('base64'), fileName, mimeType }
  );
}

async function uploadPng(page: Page, token: string, bytes: Buffer, fileName: string) {
  return uploadSignedTicket(page, token, bytes, fileName, 'image/png');
}

function ticketState(receiptId: string): {
  bytes: number;
  status: string;
  errorCode: string | null;
} {
  const runDir = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDir || !databasePath) throw new Error('Ingress E2E requiere SQLite temporal aislado.');
  if (resolve(databasePath) !== join(resolve(runDir), 'hogaria.sqlite')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio temporal del run.');
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const receipt = db
      .prepare('SELECT file_bytes AS bytes, status FROM receipts WHERE id = ?')
      .get(receiptId) as { bytes: number; status: string } | undefined;
    const job = db
      .prepare(
        `SELECT status, error_code AS errorCode FROM ai_jobs
         WHERE receipt_id = ? AND kind = 'receipt' ORDER BY created_at DESC LIMIT 1`
      )
      .get(receiptId) as { status: string; errorCode: string | null } | undefined;
    if (!receipt || !job) throw new Error('La subida aún no creó el ticket y su trabajo de IA.');
    return { bytes: receipt.bytes, status: job.status, errorCode: job.errorCode };
  } finally {
    db.close();
  }
}

function receiptCount(userId: string): number {
  const runDir = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDir || !databasePath) throw new Error('Ingress E2E requiere SQLite temporal aislado.');
  if (resolve(databasePath) !== join(resolve(runDir), 'hogaria.sqlite')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio temporal del run.');
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return (
      db.prepare('SELECT COUNT(*) AS count FROM receipts WHERE user_id = ?').get(userId) as {
        count: number;
      }
    ).count;
  } finally {
    db.close();
  }
}

test('el ingress acepta 513 KiB y entrega el ticket al backend sin proveedor IA', async ({
  page
}) => {
  const registration = await page.request.post('/api/auth/register', {
    data: { name: 'Ingress E2E', email: seededEmail(), password: 'Test1234' }
  });
  expect(registration.status()).toBe(201);
  const registrationBody = (await registration.json()) as { data: { token: string } };
  const healthResponse = await page.goto('/api/health');
  expect(healthResponse?.status()).toBe(200);

  const upload = await page.evaluate(
    async ({ token, encodedPng }) => {
      const rawBytes = atob(encodedPng);
      const bytes = Uint8Array.from(rawBytes, (character) => character.charCodeAt(0));
      const file = new File([bytes], 'ticket-513-kib.png', { type: 'image/png' });
      const decoded = await createImageBitmap(file);
      const dimensions = { width: decoded.width, height: decoded.height };
      decoded.close();
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/receipts', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form
      });
      return {
        status: response.status,
        dimensions,
        body: (await response.json().catch(() => null)) as { data?: { id?: string } } | null
      };
    },
    { token: registrationBody.data.token, encodedPng: pngSynthetic().toString('base64') }
  );
  expect(upload.status).toBe(201);
  expect(upload.dimensions).toEqual({ width: 1, height: 1 });
  const receiptId = upload.body?.data?.id;
  expect(receiptId).toBeTruthy();
  if (!receiptId) throw new Error('El backend no devolvió id para el ticket subido.');

  await expect
    .poll(() => ticketState(receiptId), { timeout: 20000 })
    .toEqual({ bytes: TICKET_BYTES, status: 'failed', errorCode: 'NO_CONFIG' });

  const unrelatedOversize = await page.evaluate(async (size) => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'x'.repeat(size) })
    });
    return response.status;
  }, TICKET_BYTES);
  expect(unrelatedOversize).toBe(413);
});

test('el ingress acepta JPEG, WebP y PDF según la firma y conserva el formato', async ({
  page
}) => {
  const registration = await page.request.post('/api/auth/register', {
    data: { name: 'Ingress formats E2E', email: seededEmail(), password: 'Test1234' }
  });
  expect(registration.status()).toBe(201);
  const registrationBody = (await registration.json()) as { data: { token: string } };
  const healthResponse = await page.goto('/api/health');
  expect(healthResponse?.status()).toBe(200);

  const fixtures = [
    {
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      fileName: 'ticket-synthetic.jpg',
      mimeType: 'image/jpeg',
      fileKind: 'jpeg'
    },
    {
      bytes: Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      fileName: 'ticket-synthetic.webp',
      mimeType: 'image/webp',
      fileKind: 'webp'
    },
    {
      bytes: Buffer.from('%PDF-1.7 synthetic ticket'),
      fileName: 'ticket-synthetic.pdf',
      mimeType: 'application/pdf',
      fileKind: 'pdf'
    }
  ];

  for (const fixture of fixtures) {
    const upload = await uploadSignedTicket(
      page,
      registrationBody.data.token,
      fixture.bytes,
      fixture.fileName,
      fixture.mimeType
    );
    expect(upload.status).toBe(201);
    expect(upload.body?.data).toMatchObject({
      fileKind: fixture.fileKind,
      fileName: fixture.fileName
    });
    const receiptId = upload.body?.data?.id;
    expect(receiptId).toBeTruthy();
    if (!receiptId) throw new Error(`El backend no devolvió id para ${fixture.fileKind}.`);
    await expect
      .poll(() => ticketState(receiptId), { timeout: 20000 })
      .toEqual({ bytes: fixture.bytes.byteLength, status: 'failed', errorCode: 'NO_CONFIG' });
  }
});

test('el ingress conserva el límite de 10 MiB en el fichero y no persiste 1 byte extra', async ({
  page
}) => {
  const registration = await page.request.post('/api/auth/register', {
    data: { name: 'Ingress boundary E2E', email: seededEmail(), password: 'Test1234' }
  });
  expect(registration.status()).toBe(201);
  const registrationBody = (await registration.json()) as { data: { token: string } };
  const token = registrationBody.data.token;
  const healthResponse = await page.goto('/api/health');
  expect(healthResponse?.status()).toBe(200);
  const profileResponse = await page.request.get('/api/auth/profile', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(profileResponse.status()).toBe(200);
  const profile = (await profileResponse.json()) as { data: { id: string } };

  const accepted = await uploadPng(
    page,
    token,
    pngSynthetic(MAX_TICKET_BYTES),
    'ticket-exactly-10-mib.png'
  );
  expect(accepted.status).toBe(201);
  const receiptId = accepted.body?.data?.id;
  expect(receiptId).toBeTruthy();
  if (!receiptId) throw new Error('El backend no devolvió id para el ticket en el límite.');
  await expect
    .poll(() => ticketState(receiptId), { timeout: 20000 })
    .toEqual({ bytes: MAX_TICKET_BYTES, status: 'failed', errorCode: 'NO_CONFIG' });

  const persistedBeforeOversize = receiptCount(profile.data.id);
  const rejected = await uploadPng(
    page,
    token,
    pngSynthetic(MAX_TICKET_BYTES + 1),
    'ticket-over-10-mib.png'
  );
  expect(rejected.status).toBe(413);
  expect(rejected.body).toMatchObject({ success: false, error: 'FILE_TOO_LARGE' });
  expect(receiptCount(profile.data.id)).toBe(persistedBeforeOversize);
});
