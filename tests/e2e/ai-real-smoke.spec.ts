import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { registerAndGoto, registerWithHousehold } from './helpers/auth';
import {
  AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
  AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION,
  loadAiLiveReceiptPlan
} from '../../scripts/ai-live-receipt-inputs.mjs';

const TOKEN_KEY = 'hogar:v1:auth_token';
const PROVIDER_KEY_MARKER = '__HOGARIA_AI_REAL_SMOKE_PROVIDER_KEY__';
const STORE_CORRECTED = 'Supermercado QA corregido';
const DATE_CORRECTED = '2024-03-01';
const DATE_CORRECTED_HISTORY = '1/3/24';
const COMPLEX_RECIPE_INGREDIENTS = [
  { name: 'Garbanzos secos QA', quantity: 300, unit: 'g' },
  { name: 'Pollo QA', quantity: 500, unit: 'g' },
  { name: 'Morcillo de ternera QA', quantity: 350, unit: 'g' },
  { name: 'Chorizo QA', quantity: 120, unit: 'g' },
  { name: 'Patatas QA', quantity: 2, unit: 'unit' },
  { name: 'Zanahorias QA', quantity: 2, unit: 'unit' },
  { name: 'Puerro QA', quantity: 1, unit: 'unit' },
  { name: 'Repollo QA', quantity: 250, unit: 'g' },
  { name: 'Cebolla QA', quantity: 1, unit: 'unit' },
  { name: 'Ajo QA', quantity: 2, unit: 'unit' },
  { name: 'Aceite de oliva QA', quantity: 15, unit: 'ml' }
] as const;
const RECIPE_DETAIL_LEVELS = ['basic', 'intermediate', 'expert'] as const;
function smokeLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid isolated AI smoke setting: ${name}`);
  }
  return value;
}

const LIVE_RECIPE_MAX_TOKENS = smokeLimit('HOGARIA_AI_REAL_SMOKE_RECIPE_MAX_TOKENS', 4096);
const LIVE_CONFIG_TIMEOUT_MS = smokeLimit('HOGARIA_AI_REAL_SMOKE_CONFIG_TIMEOUT_MS', 240_000);
const LIVE_REQUEST_TIMEOUT_MS = smokeLimit('HOGARIA_AI_REAL_SMOKE_REQUEST_TIMEOUT_MS', 270_000);
const LIVE_TEST_TIMEOUT_MS = smokeLimit('HOGARIA_AI_REAL_SMOKE_TEST_TIMEOUT_MS', 20 * 60_000);
const LIVE_SMOKE_ENABLED =
  process.env.HOGARIA_AI_REAL_SMOKE === '1' && process.env.HOGARIA_AI_REAL_SMOKE_RUNNER === '1';
const LIVE_RECEIPTS_ONLY = process.env.HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY === '1';
const LIVE_RECIPE_ONLY = process.env.HOGARIA_AI_REAL_SMOKE_RECIPE_ONLY === '1';
const LIVE_ASSISTANT_ONLY = process.env.HOGARIA_AI_REAL_SMOKE_ASSISTANT_ONLY === '1';
const LIVE_RECEIPT_SELECTION = process.env.HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION;
const LIVE_SMOKE_PHASE_FILE = process.env.E2E_RUN_DIR
  ? join(process.env.E2E_RUN_DIR, 'ai-live-smoke-phase')
  : undefined;

function reportLiveSmokePhase(phase: string): void {
  if (!LIVE_SMOKE_ENABLED || !LIVE_SMOKE_PHASE_FILE) return;
  try {
    writeFileSync(LIVE_SMOKE_PHASE_FILE, phase, 'utf8');
  } catch {
    // Diagnostic breadcrumbs are optional and never change the test outcome.
  }
}

function liveAssistantDatabaseSnapshot(): Record<string, string[]> {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere SQLite temporal aislada');
  if (resolve(databasePath) !== resolve(runDirectory, 'hogaria.sqlite')) {
    throw new Error('DATABASE_PATH debe ser la SQLite temporal de este smoke');
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => {
        const quotedName = `"${name.replaceAll('"', '""')}"`;
        const rows = database.prepare(`SELECT * FROM ${quotedName}`).all() as Record<
          string,
          unknown
        >[];
        return [name, rows.map((row) => JSON.stringify(row)).sort()];
      })
    );
  } finally {
    database.close();
  }
}

type SmokeRecipe = {
  name: string;
  description: string;
  totalTime: number;
  prepTime: number;
  cookTime: number;
  baseServings: 1;
  calories: number | null;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    preparation: string | null;
    isOptional: boolean;
    substitutes: string[];
    notes: string | null;
  }>;
  utensils: string[];
  guidance: { appliances: string[]; parallelTasks: string[]; tipsAndVariations: string[] };
  instructionsByLevel: Record<
    (typeof RECIPE_DETAIL_LEVELS)[number],
    Array<{ stepNumber: number; instruction: string; duration: number | null }>
  >;
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  } | null;
  storage: { method: string; duration: string } | null;
};

type SyntheticProviderRequest = {
  model: string | null;
  stream: boolean;
  hasImage: boolean;
  hasResponseFormat: boolean;
  userPrompt: string;
};

function normalizeRecipeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasEquivalentReceiptLine(lines: ReceiptLineForDeduplication[]): boolean {
  const seen = new Map<string, ReceiptLineForDeduplication[]>();
  for (const line of lines) {
    const name = line.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    const quantity = Number(line.quantity ?? 1);
    const unit = normalizeReceiptUnit(line.unit ?? '');
    const identity = JSON.stringify([name, Number.isFinite(quantity) ? quantity : 1, unit]);
    const candidates = seen.get(identity) ?? [];
    if (candidates.some((candidate) => equivalentReceiptLines(candidate, line))) return true;
    candidates.push(line);
    seen.set(identity, candidates);
  }
  return false;
}

type ReceiptLineForDeduplication = {
  name: string;
  category?: string | null;
  quantity?: number | null;
  unit?: string | null;
  priceMinor?: number | null;
  offer?: { buy?: number | null; take?: number | null } | null;
};

function normalizeReceiptUnit(input: string): string {
  const value = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return value
    .replace(/\b(?:kilogramos?|kilos?|kgs?)\b/g, 'kg')
    .replace(/\b(?:gramos?|grs?)\b/g, 'g')
    .replace(/\b(?:litros?|lts?|ls)\b/g, 'l')
    .replace(/\b(?:mililitros?|mls?)\b/g, 'ml')
    .replace(/\b(?:unidades?|uds?|pzas?)\b/g, 'ud')
    .replace(/\s+/g, ' ');
}

function equivalentReceiptLines(
  left: ReceiptLineForDeduplication,
  right: ReceiptLineForDeduplication
): boolean {
  if (
    left.priceMinor != null &&
    right.priceMinor != null &&
    Number(left.priceMinor) !== Number(right.priceMinor)
  ) {
    return false;
  }
  const offerKey = (offer: ReceiptLineForDeduplication['offer']) =>
    offer?.buy != null && offer?.take != null ? JSON.stringify([offer.buy, offer.take]) : null;
  return offerKey(left.offer) === offerKey(right.offer);
}

function expectComplexRecipe(recipe: SmokeRecipe): void {
  expect(recipe.name.trim()).not.toBe('');
  expect(recipe.description.trim()).not.toBe('');
  expect(recipe.totalTime).toBeGreaterThan(0);
  expect(recipe.prepTime).toBeGreaterThan(0);
  expect(recipe.cookTime).toBeGreaterThan(0);
  expect(recipe.baseServings).toBe(1);
  expect(recipe.calories ?? 0).toBeGreaterThan(0);
  expect(recipe).not.toHaveProperty('steps');
  expect(recipe.ingredients.length).toBeGreaterThanOrEqual(8);
  const ingredientNames = recipe.ingredients.map(({ name }) => normalizeRecipeText(name));
  expect(new Set(ingredientNames).size).toBe(ingredientNames.length);
  expect(recipe.ingredients.every(({ quantity }) => quantity > 0)).toBe(true);
  const sourceIngredientMatches = COMPLEX_RECIPE_INGREDIENTS.filter(({ name }) => {
    const expected = normalizeRecipeText(name.replace(/\s+QA$/i, '')).split(' ')[0];
    return ingredientNames.some((actual) => actual.includes(expected));
  });
  expect(sourceIngredientMatches.length).toBeGreaterThanOrEqual(7);
  expect(recipe.utensils.length).toBeGreaterThan(0);
  expect(recipe.guidance.appliances.length).toBeGreaterThan(0);
  expect(recipe.guidance.parallelTasks.length).toBeGreaterThan(0);
  expect(recipe.guidance.tipsAndVariations.length).toBeGreaterThan(0);
  expect(recipe.nutrition).not.toBeNull();
  expect(recipe.storage?.duration.trim()).not.toBe('');

  const levelFingerprints: string[] = [];
  for (const level of RECIPE_DETAIL_LEVELS) {
    const steps = recipe.instructionsByLevel[level];
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.map(({ stepNumber }) => stepNumber)).toEqual(steps.map((_, index) => index + 1));
    const instructions = steps.map(({ instruction }) => normalizeRecipeText(instruction));
    expect(instructions[0]).toMatch(/lav|enjuag|limpia/);
    expect(instructions.every((instruction) => instruction.length >= 30)).toBe(true);
    expect(new Set(instructions).size).toBe(instructions.length);
    levelFingerprints.push(JSON.stringify(instructions));
  }
  expect(new Set(levelFingerprints).size).toBe(RECIPE_DETAIL_LEVELS.length);
}

function complexRecipeFixture() {
  const steps = (instructions: string[]) =>
    instructions.map((instruction, index) => ({
      stepNumber: index + 1,
      instruction,
      duration: [15, 10, 120, 20, 15, 20][index],
      temperature: null,
      timerRequired: true,
      timerDuration: [15, 10, 120, 20, 15, 20][index],
      tips: `Fase ${index + 1}: comprueba el cambio observable antes de seguir.`,
      warning: null,
      illustration: null
    }));

  return {
    name: 'Cocido QA de varias fases',
    description: 'Guiso de varias fases con cocción lenta y servicio por partes.',
    difficulty: 'hard',
    cuisine: 'Española',
    totalTime: 180,
    prepTime: 30,
    cookTime: 150,
    restTime: null,
    baseServings: 1,
    calories: 520,
    ingredients: COMPLEX_RECIPE_INGREDIENTS.map((ingredient) => ({
      ...ingredient,
      preparation: 'lavado, pelado o troceado según corresponda',
      isOptional: false,
      substitutes: [],
      notes: ''
    })),
    utensils: ['Olla grande', 'cazo', 'colador'],
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: ['Lava y corta el repollo mientras el caldo cuece a fuego suave.'],
      tipsAndVariations: ['Añade el chorizo al final para controlar la grasa del caldo.'],
      batchCookingWarning: null
    },
    instructionsByLevel: {
      basic: steps([
        'La víspera, enjuaga los garbanzos y déjalos cubiertos con agua fría durante toda la noche.',
        'Enjuaga las carnes y comienza una cocción suave en una olla grande; retira la espuma.',
        'Añade los garbanzos y cocina a fuego bajo hasta que estén tiernos; incorpora las verduras por tandas.',
        'Cuece aparte el repollo y sirve el caldo, los garbanzos y las carnes en fuentes separadas.'
      ]),
      intermediate: steps([
        'La víspera, enjuaga e hidrata los garbanzos en abundante agua fría y escúrrelos antes de cocinar.',
        'Cubre pollo y morcillo con agua fría, lleva lentamente a hervor y espuma la superficie durante los primeros minutos.',
        'Incorpora los garbanzos y mantén un hervor apenas perceptible; agrega zanahoria y puerro cuando la carne empiece a ablandarse.',
        'Añade patata y chorizo en la fase final, y cocina el repollo por separado para controlar su textura.',
        'Cuela una parte del caldo, ajusta sal y sirve primero la sopa; presenta después garbanzos, verduras y carnes.'
      ]),
      expert: steps([
        'Enjuaga los garbanzos y déjalos 10–12 horas en agua fría con espacio para que aumenten de volumen; escúrrelos.',
        'Parte de agua fría con el morcillo y el pollo; sube a hervor gradual y desespuma hasta que el caldo quede limpio.',
        'Mantén la olla entre hervor suave y burbujeo mínimo, añade los garbanzos y evita removerlos para conservarlos enteros.',
        'Incorpora puerro y zanahoria cuando la carne ceda ligeramente; añade patata y chorizo en los últimos 25–30 minutos.',
        'Cuece el repollo aparte con ajo y aceite hasta que esté tierno pero conserve estructura; separa y desengrasa el caldo.',
        'Comprueba que la carne se desprende con facilidad y que el garbanzo está cremoso; rectifica el caldo y sirve por fases.'
      ])
    },
    nutrition: { calories: 520, protein: 38, carbs: 48, fat: 18, fiber: 12 },
    storage: {
      method: 'Refrigerar por separado',
      duration: '3 días',
      reheatingInstructions: 'Calentar el caldo y las partes por separado.',
      container: 'Recipientes herméticos',
      freezingPossible: true,
      freezingDuration: '2 meses'
    },
    tags: ['synthetic', 'multi-stage']
  };
}

/** Proveedor loopback determinista para cubrir rutas backend sin llamadas externas. */
class SyntheticAiProvider {
  private server?: Server;
  private replies: unknown[] = [];
  baseUrl = '';
  readonly requests: SyntheticProviderRequest[] = [];

  get pendingReplyCount(): number {
    return this.replies.length;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          response.writeHead(404).end();
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        } catch {
          response.writeHead(400).end();
          return;
        }

        const messageList = Array.isArray(body.messages) ? body.messages : [];
        const messages = JSON.stringify(messageList);
        const userPrompt = messageList
          .filter(
            (message): message is { role: string; content: string } =>
              typeof message === 'object' &&
              message !== null &&
              (message as { role?: unknown }).role === 'user' &&
              typeof (message as { content?: unknown }).content === 'string'
          )
          .map(({ content }) => content)
          .join('\n');
        this.requests.push({
          model: typeof body.model === 'string' ? body.model : null,
          stream: body.stream === true,
          hasImage: messages.includes('image_url'),
          hasResponseFormat: Boolean(body.response_format),
          userPrompt
        });

        const fixture = this.replies.shift();
        if (fixture === undefined) {
          response
            .writeHead(503, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: 'No synthetic provider fixture queued.' }));
          return;
        }

        const content = typeof fixture === 'string' ? fixture : JSON.stringify(fixture);
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server!.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }

  enqueue(...replies: unknown[]): void {
    this.replies.push(...replies);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}

async function authToken(page: Parameters<typeof registerAndGoto>[0]): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'el E2E debe usar la sesión aislada').toBeTruthy();
  return token!;
}

async function saveLiveAiConfig(
  page: Parameters<typeof registerAndGoto>[0],
  token: string
): Promise<string> {
  const proxyUrl = process.env.HOGARIA_AI_REAL_SMOKE_PROXY_URL;
  const model = process.env.HOGARIA_AI_REAL_SMOKE_MODEL;
  expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  expect(model).toBeTruthy();

  const created = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Smoke real aislado',
      provider: 'custom',
      baseUrl: proxyUrl,
      apiKey: PROVIDER_KEY_MARKER,
      model,
      maxTokens: LIVE_RECIPE_MAX_TOKENS,
      timeout: LIVE_CONFIG_TIMEOUT_MS,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(created.status()).toBe(201);
  const config = (await created.json()) as {
    data?: {
      id?: string;
      isActive?: boolean;
      retryAttempts?: number;
      concurrency?: number;
    };
  };
  expect(config.data?.id).toBeTruthy();
  expect(config.data).toMatchObject({ retryAttempts: 0, concurrency: 1, isActive: true });

  // GPT-5 does not accept a custom temperature. The UI config schema permits null
  // as “leave this provider option out”, but create defaults it, so clear it here.
  const updated = await page.request.patch(`/api/ai/configs/${config.data!.id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      temperature: null,
      maxTokens: LIVE_RECIPE_MAX_TOKENS,
      retryAttempts: 0,
      timeout: LIVE_CONFIG_TIMEOUT_MS
    }
  });
  expect(updated.ok()).toBeTruthy();
  return config.data!.id!;
}

async function syntheticReceiptPng(page: Parameters<typeof registerAndGoto>[0]): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1100;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic receipt canvas is unavailable.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.textAlign = 'center';
    context.font = 'bold 54px Arial';
    context.fillText('SUPERMERCADO QA', 450, 130);
    context.font = '36px Arial';
    context.fillText('29/02/2024', 450, 225);
    context.textAlign = 'left';
    context.fillText('Naranjas  2 kg', 115, 390);
    context.textAlign = 'right';
    context.fillText('3,00 EUR', 785, 390);
    context.beginPath();
    context.moveTo(110, 445);
    context.lineTo(790, 445);
    context.strokeStyle = '#111';
    context.lineWidth = 4;
    context.stroke();
    context.font = 'bold 42px Arial';
    context.textAlign = 'left';
    context.fillText('TOTAL', 115, 535);
    context.textAlign = 'right';
    context.fillText('3,00 EUR', 785, 535);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function syntheticShoppingPhotoPng(
  page: Parameters<typeof registerAndGoto>[0]
): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 760;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic shopping shelf canvas is unavailable.');

    context.fillStyle = '#f4f0e7';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fffdf9';
    context.fillRect(35, 35, 930, 690);
    context.fillStyle = '#28231d';
    context.textAlign = 'center';
    context.font = 'bold 42px Arial';
    context.fillText('PRODUCTOS DE ESTANTERÍA', 500, 105);

    const packageItem = (
      x: number,
      y: number,
      width: number,
      height: number,
      color: string,
      label: string,
      detail: string,
      price: string
    ) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
      context.strokeStyle = '#534a3f';
      context.lineWidth = 4;
      context.strokeRect(x, y, width, height);
      context.fillStyle = '#24201b';
      context.textAlign = 'center';
      context.font = 'bold 42px Arial';
      context.fillText(label, x + width / 2, y + height / 2);
      context.font = '30px Arial';
      context.fillText(detail, x + width / 2, y + height / 2 + 45);
      context.fillStyle = '#fff4b8';
      context.fillRect(x - 12, y + height + 16, width + 24, 78);
      context.strokeRect(x - 12, y + height + 16, width + 24, 78);
      context.fillStyle = '#24201b';
      context.font = 'bold 30px Arial';
      context.fillText(price, x + width / 2, y + height + 66);
    };

    packageItem(95, 175, 235, 365, '#e6f1f7', 'LECHE', '1 L', '1,29 €/L');
    packageItem(382, 175, 235, 365, '#e8f1dc', 'TOMATES', 'frescos', '2,49 €/kg');
    packageItem(670, 175, 235, 365, '#f1dfc6', 'PAN', 'de pueblo', '0,95 €/ud');
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function selectShelfPhotoMode(page: Parameters<typeof registerAndGoto>[0]): Promise<void> {
  const picker = page.locator('[data-test="photo-mode"]');
  await picker.locator('.picker__trigger').click();
  await page.getByRole('option', { name: /Estanteria/i }).click();
  await expect(picker.locator('.picker__trigger')).toContainText('Estanteria');
}

test('procesa solo los tickets reales seleccionados y verifica la revisión sin confirmar', async ({
  page
}) => {
  test.skip(
    !LIVE_SMOKE_ENABLED || !LIVE_RECEIPTS_ONLY,
    'El lote real de tickets solo corre con opt-in específico.'
  );
  test.setTimeout(LIVE_TEST_TIMEOUT_MS);
  page.setDefaultTimeout(LIVE_REQUEST_TIMEOUT_MS);

  const directory = process.env.HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY ?? '';
  const preferredJpegOrdinal = Number(process.env.HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL);
  if (
    ![
      'unsubmitted-only',
      AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
      AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION
    ].includes(LIVE_RECEIPT_SELECTION ?? '')
  ) {
    throw new Error('The live receipt smoke requires a supported safe selection.');
  }
  const longTicketOnly = LIVE_RECEIPT_SELECTION === AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION;
  const preferredJpegOnly =
    LIVE_RECEIPT_SELECTION === AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION;
  const plan = longTicketOnly
    ? await loadAiLiveReceiptPlan({
        directory,
        preferredJpegOrdinal,
        selection: AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION
      })
    : preferredJpegOnly
      ? await loadAiLiveReceiptPlan({
          directory,
          preferredJpegOrdinal,
          selection: AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION
        })
      : await loadAiLiveReceiptPlan({
          directory,
          preferredJpegOrdinal,
          selection: 'unsubmitted-only'
        });
  expect(plan.sourceCount).toBe(6);
  const expectedTicketCount = LIVE_RECEIPT_SELECTION === 'unsubmitted-only' ? 2 : 1;
  expect(plan.ticketCount).toBe(expectedTicketCount);
  expect(plan.selection).toBe(LIVE_RECEIPT_SELECTION);
  expect(plan.tickets.map(({ sourceFileCount }) => sourceFileCount)).toEqual(
    LIVE_RECEIPT_SELECTION === 'unsubmitted-only' ? [1, 3] : [longTicketOnly ? 3 : 1]
  );
  reportLiveSmokePhase('real-receipts-inputs-validated');

  await registerWithHousehold(page, '/receipts', 'ai-live-receipts-only');
  const token = await authToken(page);
  await saveLiveAiConfig(page, token);
  reportLiveSmokePhase('real-receipts-started');

  for (const [index, ticket] of plan.tickets.entries()) {
    const extension = ticket.kind === 'pdf' ? 'pdf' : 'jpeg';
    const uploadResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/receipts' &&
        response.request().method() === 'POST'
    );
    await page.setInputFiles('input[name="ticketFile"]', {
      name: `hogaria-smoke-ticket-${index + 1}.${extension}`,
      mimeType: ticket.mimeType,
      buffer: ticket.buffer
    });
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(201);
    const uploadedBody = (await uploaded.json()) as { data?: { id?: string } };
    const receiptId = uploadedBody.data?.id;
    expect(typeof receiptId === 'string' && receiptId.length > 0).toBe(true);
    if (!receiptId) throw new Error('An isolated receipt upload returned no identifier.');

    const detailPath = `/api/receipts/${receiptId}`;
    const isReadyForReview = async () => {
      const response = await page.request.get(detailPath, {
        headers: { authorization: `Bearer ${token}` }
      });
      if (!response.ok()) return false;
      const receipt = (await response.json()).data as {
        status?: unknown;
        lines?: unknown;
      };
      return (
        receipt?.status === 'review' && Array.isArray(receipt.lines) && receipt.lines.length > 0
      );
    };
    await expect
      .poll(isReadyForReview, { timeout: LIVE_REQUEST_TIMEOUT_MS, intervals: [500, 1000, 2000] })
      .toBe(true);

    const detailResponse = await page.request.get(detailPath, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(detailResponse.ok()).toBe(true);
    const receipt = (await detailResponse.json()).data as {
      lines: ReceiptLineForDeduplication[];
    };
    const categoriesResponse = await page.request.get('/api/pantry/categories?limit=100', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(categoriesResponse.ok()).toBe(true);
    const categories = (await categoriesResponse.json()).data as { key: string }[];
    const categoryKeys = new Set(categories.map(({ key }) => key));
    expect(categoryKeys.size).toBeGreaterThan(0);
    for (const line of receipt.lines) {
      expect(typeof line.category).toBe('string');
      expect(categoryKeys.has(line.category!)).toBe(true);
    }
    if (ticket.sourceFileCount === 3) {
      expect(
        hasEquivalentReceiptLine(receipt.lines),
        'el ticket largo no debe persistir líneas equivalentes repetidas'
      ).toBe(false);
    }

    await page.goto(`/receipts/${receiptId}`);
    const storeField = page.locator('#ticket-tienda');
    const dateField = page.locator('#ticket-fecha-compra');
    await expect(storeField).toBeVisible();
    await expect(dateField).toBeVisible();
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);
    const lineNameFields = page.locator('.tabla__fila input[id$="-nombre"]');
    await expect(lineNameFields).toHaveCount(receipt.lines.length);
    for (let lineIndex = 0; lineIndex < receipt.lines.length; lineIndex += 1) {
      await expect(lineNameFields.nth(lineIndex)).toBeEditable();
    }
    const qaStore = `Hogar QA ticket ${index + 1}`;
    await storeField.fill(qaStore);
    await dateField.fill('2024-03-01');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === detailPath && response.request().method() === 'PATCH'
    );
    await page.locator('[data-test="save-receipt-metadata"]').click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');
    await page.reload();
    await expect(storeField).toHaveValue(qaStore);
    await expect(dateField).toHaveValue('2024-03-01');
    await page.getByRole('link', { name: 'Volver a tickets' }).click();
    const historyRow = page
      .locator('[data-test="receipt-history"] [data-test="ticket-history-item"]')
      .filter({ hasText: qaStore });
    await expect(historyRow).toHaveCount(1);
    await expect(historyRow.locator('.ticket__meta')).toContainText('1/3/24');
    reportLiveSmokePhase('real-receipt-ticket-verified');
  }

  reportLiveSmokePhase('real-receipts-all-verified');
});

test('recorre los ocho AiJobKind con WebAPI real y ticket sintético editable', async ({ page }) => {
  test.skip(
    !LIVE_SMOKE_ENABLED || LIVE_RECEIPTS_ONLY || LIVE_RECIPE_ONLY || LIVE_ASSISTANT_ONLY,
    'El flujo general no corre en smoke de tickets, receta o propuestas del asistente.'
  );
  test.setTimeout(LIVE_TEST_TIMEOUT_MS);
  page.setDefaultTimeout(LIVE_REQUEST_TIMEOUT_MS);
  reportLiveSmokePhase('register-start');
  await registerWithHousehold(page, '/recipes', 'ai-live-smoke');
  reportLiveSmokePhase('registered');
  const token = await authToken(page);
  reportLiveSmokePhase('config-start');
  const configId = await saveLiveAiConfig(page, token);
  reportLiveSmokePhase('configured');

  const pantryIngredients = new Map<string, { id: string }>();
  for (const ingredient of COMPLEX_RECIPE_INGREDIENTS) {
    const ingredientResponse = await page.request.post('/api/pantry/ingredients', {
      headers: { authorization: `Bearer ${token}` },
      data: { ...ingredient, category: 'other', location: 'pantry' }
    });
    expect(ingredientResponse.status()).toBe(201);
    const pantryIngredient = (await ingredientResponse.json()).data as { id: string };
    expect(pantryIngredient.id).toBeTruthy();
    pantryIngredients.set(ingredient.name, pantryIngredient);
  }
  reportLiveSmokePhase('ingredients-created');
  const pantryResponse = await page.request.get('/api/pantry/ingredients?page=1&pageSize=100', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(pantryResponse.status()).toBe(200);
  const pantryPayload = (await pantryResponse.json()).data as {
    ingredients: Array<{ name: string }>;
  };
  expect(pantryPayload.ingredients.map(({ name }) => name)).toEqual(
    expect.arrayContaining(COMPLEX_RECIPE_INGREDIENTS.map(({ name }) => name))
  );
  reportLiveSmokePhase('ingredients-api-verified');
  const liveRecipeIngredients = COMPLEX_RECIPE_INGREDIENTS.map((ingredient) => ({
    ...ingredient,
    id: pantryIngredients.get(ingredient.name)!.id
  }));
  await page.goto('/recipes');
  await expect(page.locator('h1.recipes__title')).toBeVisible();
  reportLiveSmokePhase('recipe-page-loaded');
  await page.getByRole('button', { name: /Generar IA/ }).click();
  reportLiveSmokePhase('generate-modal-open');
  for (const [index, ingredient] of COMPLEX_RECIPE_INGREDIENTS.entries()) {
    const ingredientId = pantryIngredients.get(ingredient.name)!.id;
    const pantryTag = page.locator(
      `[data-test="recipe-ai-pantry-options"] [data-ingredient-id="${ingredientId}"]`
    );
    const matches = await pantryTag.count();
    reportLiveSmokePhase(
      `ingredient-${index + 1}-matches-${matches === 0 ? 'none' : matches === 1 ? 'single' : 'multiple'}`
    );
    await expect(pantryTag).toBeVisible();
    reportLiveSmokePhase(`ingredient-${index + 1}-visible`);
    await pantryTag.click();
    reportLiveSmokePhase(`ingredient-${index + 1}-selected`);
  }
  await expect(page.locator('.ai-form__ingredients app-tag')).toHaveCount(
    COMPLEX_RECIPE_INGREDIENTS.length
  );
  reportLiveSmokePhase('ingredients-selected');
  await page.locator('[data-test="recipe-ai-next"]').click();
  await expect(page.locator('[data-test="recipe-ai-step-2"]')).toBeVisible();
  reportLiveSmokePhase('participants-step-loaded');
  await page.locator('[data-test="recipe-ai-next"]').click();
  await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
  const recipeOptions = page.locator('[data-test="recipe-ai-step-3"]');
  const difficultyPicker = recipeOptions.locator('#recipe-difficulty');
  await difficultyPicker.getByRole('button').click();
  await difficultyPicker.getByRole('option', { name: /Difícil/ }).click();
  await recipeOptions.locator('#recipe-serving-input').fill('6');
  const detailLevelPicker = recipeOptions.locator('#recipe-detail-level');
  await detailLevelPicker.getByRole('button').click();
  await detailLevelPicker.getByRole('option', { name: /Experto/ }).click();
  reportLiveSmokePhase('recipe-options-set');
  const recipeRequestPromise = page.waitForRequest(
    (request) => request.url().includes('/api/ai/generate-recipe') && request.method() === 'POST'
  );
  const recipeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/ai/generate-recipe') && response.request().method() === 'POST'
  );
  reportLiveSmokePhase('recipe-request-start');
  await page.getByRole('button', { name: 'Generar 1 receta' }).click();
  const recipeRequest = await recipeRequestPromise;
  const recipeRequestBody = recipeRequest.postDataJSON() as {
    ingredients: Array<{ id: string; name: string; quantity: number; unit: string }>;
    servings: number;
    difficulty: string;
    detailLevel: string;
  };
  expect(recipeRequestBody.ingredients).toHaveLength(COMPLEX_RECIPE_INGREDIENTS.length);
  expect(recipeRequestBody.ingredients.map(({ name }) => name)).toEqual(
    expect.arrayContaining(COMPLEX_RECIPE_INGREDIENTS.map(({ name }) => name))
  );
  expect(recipeRequestBody).toMatchObject({
    servings: 6,
    difficulty: 'hard',
    detailLevel: 'expert'
  });
  const recipeResponse = await recipeResponsePromise;
  const recipeResponseStatus = recipeResponse.status();
  reportLiveSmokePhase(
    recipeResponseStatus === 200
      ? 'recipe-response-ok'
      : recipeResponseStatus >= 500
        ? 'recipe-response-server-error'
        : 'recipe-response-other-error'
  );
  if (recipeResponseStatus !== 200) {
    const errorBody = await recipeResponse.json().catch(() => null);
    if (errorBody?.message === 'Invalid AI response format') {
      reportLiveSmokePhase('recipe-error-invalid-json');
    } else if (errorBody?.message === 'AI response does not contain a usable recipe draft') {
      reportLiveSmokePhase('recipe-error-unusable-draft');
    } else if (errorBody?.message === 'AI response does not contain a complete recipe draft') {
      reportLiveSmokePhase('recipe-error-incomplete-draft');
    } else {
      reportLiveSmokePhase('recipe-error-unclassified');
    }
  }
  expect(recipeResponseStatus).toBe(200);
  reportLiveSmokePhase('recipe-generated');
  const generatedRecipe = (await recipeResponse.json()).data as SmokeRecipe & {
    selectedDetailLevel: 'basic' | 'intermediate' | 'expert';
  };
  expectComplexRecipe(generatedRecipe);
  reportLiveSmokePhase('recipe-content-validated');
  expect(generatedRecipe.selectedDetailLevel).toBe('expert');
  await expect(page.locator('.generated-recipe__title')).toBeVisible({
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  await expect(page.locator('.generated-recipe__title')).not.toBeEmpty();
  const generatedLevel = page.locator('#generated-recipe-detail-level');
  const generatedLevelTrigger = generatedLevel.getByRole('button');
  await expect(generatedLevelTrigger).toHaveAccessibleName('Nivel de detalle: Experto');
  await expect(page.locator('.generated-recipe__steps')).toContainText(
    generatedRecipe.instructionsByLevel.expert[0].instruction
  );
  await generatedLevelTrigger.click();
  await generatedLevel.getByRole('option', { name: /Intermedio/ }).click();
  await expect(page.locator('.generated-recipe__steps')).toContainText(
    generatedRecipe.instructionsByLevel.intermediate[0].instruction
  );
  await generatedLevelTrigger.click();
  await generatedLevel.getByRole('option', { name: /Principiante/ }).click();
  await expect(page.locator('.generated-recipe__steps')).toContainText(
    generatedRecipe.instructionsByLevel.basic[0].instruction
  );

  const connectionResponse = await page.request.post('/api/ai/test-connection', {
    headers: { authorization: `Bearer ${token}` },
    data: { configId },
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  expect(connectionResponse.status()).toBe(200);
  const connection = (await connectionResponse.json()).data as {
    success: boolean;
    model: string;
    message: string;
  };
  expect(connection).toMatchObject({
    success: true,
    model: process.env.HOGARIA_AI_REAL_SMOKE_MODEL
  });
  expect(connection.message.trim()).not.toBe('');
  reportLiveSmokePhase('connection-tested');

  reportLiveSmokePhase('multiple-recipes-request-start');
  const multipleRecipesResponse = await page.request.post('/api/ai/generate-multiple-recipes', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      ingredients: liveRecipeIngredients,
      count: 2,
      servings: 6,
      difficulty: 'hard',
      detailLevel: 'expert'
    },
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  const multipleRecipesStatus = multipleRecipesResponse.status();
  reportLiveSmokePhase(
    multipleRecipesStatus === 200
      ? 'multiple-recipes-response-ok'
      : multipleRecipesStatus >= 500
        ? 'multiple-recipes-response-server-error'
        : 'multiple-recipes-response-other-error'
  );
  expect(multipleRecipesStatus).toBe(200);
  const multipleRecipes = (await multipleRecipesResponse.json()).data as Array<{
    name: string;
    ingredients: Array<{ name: string; quantity: number; unit: string }>;
    instructionsByLevel: Record<
      'basic' | 'intermediate' | 'expert',
      Array<{ stepNumber: number; instruction: string; duration: number | null }>
    >;
  }>;
  // La ruta aplica la validación de borrador y diversidad normalizada del flujo de recetas.
  expect(multipleRecipes).toHaveLength(2);
  expect(multipleRecipes.every((recipe) => recipe.name.trim().length > 0)).toBe(true);
  expect(
    new Set(multipleRecipes.map((recipe) => recipe.name.trim().toLocaleLowerCase('es'))).size
  ).toBe(2);
  reportLiveSmokePhase('multiple-recipes-count-validated');
  expect(multipleRecipes.every((recipe) => recipe.ingredients.length >= 2)).toBe(true);
  for (const recipe of multipleRecipes) {
    const ingredientNames = recipe.ingredients.map(({ name }) => normalizeRecipeText(name));
    expect(new Set(ingredientNames).size).toBe(ingredientNames.length);
    for (const level of RECIPE_DETAIL_LEVELS) {
      expect(recipe.instructionsByLevel[level].length).toBeGreaterThan(0);
    }
  }
  expect(
    multipleRecipes.every(({ instructionsByLevel }) =>
      ['basic', 'intermediate', 'expert'].every(
        (level) => instructionsByLevel[level as 'basic' | 'intermediate' | 'expert'].length > 0
      )
    )
  ).toBe(true);
  reportLiveSmokePhase('multiple-recipes-content-validated');
  const recipeFingerprints = multipleRecipes.map((recipe) => {
    const ingredients = recipe.ingredients
      .map((ingredient) => [
        normalizeRecipeText(ingredient.name),
        String(ingredient.quantity),
        normalizeRecipeText(ingredient.unit)
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify({
      name: normalizeRecipeText(recipe.name),
      ingredients,
      instructionsByLevel: Object.fromEntries(
        (['basic', 'intermediate', 'expert'] as const).map((level) => [
          level,
          recipe.instructionsByLevel[level].map((step) => normalizeRecipeText(step.instruction))
        ])
      )
    });
  });
  expect(new Set(recipeFingerprints).size).toBe(2);
  reportLiveSmokePhase('multiple-recipes-validated');

  reportLiveSmokePhase('recommendations-request-start');
  const recommendationsResponse = await page.request.post('/api/ai/recommendations', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      availableIngredients: liveRecipeIngredients.map(({ name }) => name),
      recentMeals: [],
      count: 1
    },
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  expect(recommendationsResponse.status()).toBe(200);
  const recommendations = (await recommendationsResponse.json()).data as Array<{
    name: string;
    reason: string;
    ingredients: string[];
    estimatedTime: number;
  }>;
  expect(recommendations.length).toBeGreaterThan(0);
  expect(recommendations[0].name.trim()).not.toBe('');
  expect(recommendations[0].reason.trim()).not.toBe('');
  expect(recommendations[0].ingredients.length).toBeGreaterThan(0);
  expect(recommendations[0].estimatedTime).toBeGreaterThan(0);
  reportLiveSmokePhase('recommendations-validated');

  const planDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  reportLiveSmokePhase('weekly-plan-request-start');
  const weeklyPlanResponse = await page.request.post('/api/ai/plan-week', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      startDate: planDate,
      endDate: planDate,
      goals: {
        types: ['balanced', 'muscle-gain', 'custom'],
        customInstructions: 'Prioriza platos caseros de varias fases y aprovecha la despensa.'
      },
      availableIngredients: liveRecipeIngredients.map(({ name }) => name),
      mealTypes: ['dinner']
    },
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  expect(weeklyPlanResponse.status()).toBe(200);
  const weeklyPlan = (await weeklyPlanResponse.json()).data as {
    days: Array<{ date: string; meals: { dinner?: { name?: string } } }>;
    saved: { created: number };
  };
  expect(weeklyPlan.days).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        date: planDate,
        meals: expect.objectContaining({
          dinner: expect.objectContaining({ name: expect.any(String) })
        })
      })
    ])
  );
  expect(weeklyPlan.saved.created).toBe(1);
  const calendarResponse = await page.request.get(
    `/api/calendar/range?startDate=${planDate}&endDate=${planDate}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(calendarResponse.status()).toBe(200);
  const calendar = (await calendarResponse.json()).data as {
    meals: Array<{ date: string; meal_type: string; custom_meal: string | null }>;
  };
  expect(calendar.meals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        date: planDate,
        meal_type: 'dinner',
        custom_meal: expect.any(String)
      })
    ])
  );
  reportLiveSmokePhase('weekly-plan-persisted');

  const existingIngredientsExpiration = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  for (const ingredient of liveRecipeIngredients) {
    const expirationResponse = await page.request.patch(
      `/api/pantry/ingredients/${encodeURIComponent(ingredient.id)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { expirationDate: existingIngredientsExpiration }
      }
    );
    expect(expirationResponse.status()).toBe(200);
    const expirationPayload = (await expirationResponse.json()).data as {
      expiration_date: string | null;
    };
    expect(expirationPayload.expiration_date).toBe(existingIngredientsExpiration);
  }
  reportLiveSmokePhase('expiry-existing-ingredients-isolated');

  const unknownIngredientName = 'ai-live-expiry-synthetic-needle-183746';
  const unknownIngredientResponse = await page.request.post('/api/pantry/ingredients', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: unknownIngredientName,
      category: 'other',
      quantity: 1,
      unit: 'unit',
      location: 'pantry'
    }
  });
  expect(unknownIngredientResponse.status()).toBe(201);
  const unknownIngredient = (await unknownIngredientResponse.json()).data as {
    id: string;
    estimated_shelf_days: number | null;
  };
  expect(unknownIngredient.estimated_shelf_days).toBeNull();
  reportLiveSmokePhase('expiry-ingredient-created');
  reportLiveSmokePhase('expiry-estimate-request-start');
  const expiryResponse = await page.request.post('/api/pantry/expiry/estimate', {
    headers: { authorization: `Bearer ${token}` },
    data: {},
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  const expiryStatus = expiryResponse.status();
  reportLiveSmokePhase(
    expiryStatus === 200
      ? 'expiry-estimate-response-200'
      : expiryStatus >= 500
        ? 'expiry-estimate-response-server-error'
        : 'expiry-estimate-response-other-error'
  );
  expect(expiryStatus).toBe(200);
  const expiryPayload = await expiryResponse.json();
  reportLiveSmokePhase('expiry-estimate-json-parsed');
  expect(expiryPayload.data).toMatchObject({ ia: 1, sinEstimar: 0 });
  reportLiveSmokePhase('expiry-estimate-summary-validated');
  reportLiveSmokePhase('expiry-estimate-response-valid');
  const estimatedIngredientResponse = await page.request.get(
    `/api/pantry/ingredients/${encodeURIComponent(unknownIngredient.id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(estimatedIngredientResponse.status()).toBe(200);
  const estimatedIngredient = (await estimatedIngredientResponse.json()).data as {
    estimated_shelf_days: number | null;
  };
  expect(estimatedIngredient.estimated_shelf_days).not.toBeNull();
  expect(estimatedIngredient.estimated_shelf_days ?? 0).toBeGreaterThan(0);
  reportLiveSmokePhase('expiry-estimate-persisted');

  const shoppingListResponse = await page.request.post('/api/shopping/lists', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'Lista foto IA sintética' }
  });
  expect(shoppingListResponse.status()).toBe(201);
  const shoppingList = (await shoppingListResponse.json()).data as { id: string };
  await page.goto(`/shopping/${encodeURIComponent(shoppingList.id)}`);
  await expect(page.locator('[data-test="photo-open"]')).toBeVisible();
  await page.locator('[data-test="photo-open"]').click();
  await selectShelfPhotoMode(page);
  const liveShoppingShelfPhoto = await syntheticShoppingPhotoPng(page);
  const liveTicketPhoto = await syntheticReceiptPng(page);
  expect(liveShoppingShelfPhoto.equals(liveTicketPhoto)).toBe(false);
  await page.locator('input[name="photoFile"]').setInputFiles({
    name: 'foto-cesta-sintetica.png',
    mimeType: 'image/png',
    buffer: liveShoppingShelfPhoto
  });
  const photoAnalyzeRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes(`/api/shopping/lists/${shoppingList.id}/photo/analyze`) &&
      request.method() === 'POST'
  );
  const photoAnalyzeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/shopping/lists/${shoppingList.id}/photo/analyze`) &&
      response.request().method() === 'POST'
  );
  reportLiveSmokePhase('shopping-photo-request-start');
  await page.locator('[data-test="photo-analyze"]').click();
  const photoAnalyzeRequest = await photoAnalyzeRequestPromise;
  const photoPayload = photoAnalyzeRequest.postDataJSON();
  expect(photoPayload).toMatchObject({ mode: 'shelf' });
  expect(photoPayload.image).toMatch(/^data:image\/png;base64,/);
  const photoAnalyzeResponse = await photoAnalyzeResponsePromise;
  expect(photoAnalyzeResponse.status()).toBe(200);
  const photoAnalysis = (await photoAnalyzeResponse.json()).data as {
    lines: Array<{ name: string; quantity: number }>;
  };
  expect(photoAnalysis.lines.length).toBeGreaterThan(0);
  expect(photoAnalysis.lines.some((line) => /tomate|leche|pan/i.test(line.name))).toBe(true);
  reportLiveSmokePhase('shopping-photo-analyzed');
  const editablePhotoLine = page.locator('.detail__photo-name').first();
  await expect(editablePhotoLine).toBeVisible();
  await expect(editablePhotoLine).toHaveValue(photoAnalysis.lines[0].name);
  const correctedPhotoName = 'Producto foto QA corregido';
  await editablePhotoLine.fill(correctedPhotoName);
  await expect(editablePhotoLine).toHaveValue(correctedPhotoName);
  const beforePhotoConfirmation = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(shoppingList.id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(beforePhotoConfirmation.status()).toBe(200);
  expect((await beforePhotoConfirmation.json()).data.items).toEqual([]);

  const photoApplyResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/shopping/lists/${shoppingList.id}/items/apply`) &&
      response.request().method() === 'POST'
  );
  await page.locator('[data-test="photo-apply"]').click();
  const photoApplyResponse = await photoApplyResponsePromise;
  expect(photoApplyResponse.status()).toBe(200);
  const photoApply = (await photoApplyResponse.json()).data as {
    added: Array<{ name: string }>;
    merged: Array<{ name: string }>;
  };
  expect([...photoApply.added, ...photoApply.merged]).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: correctedPhotoName })])
  );
  const afterPhotoConfirmation = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(shoppingList.id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(afterPhotoConfirmation.status()).toBe(200);
  expect((await afterPhotoConfirmation.json()).data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: correctedPhotoName })])
  );
  reportLiveSmokePhase('shopping-photo-confirmed');

  await page.goto('/receipts');
  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  const uploadResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/receipts' && response.request().method() === 'POST'
  );
  await page.setInputFiles('input[name="ticketFile"]', {
    name: 'ticket-sintetico-smoke.png',
    mimeType: 'image/png',
    buffer: await syntheticReceiptPng(page)
  });
  const upload = await uploadResponse;
  expect(upload.status()).toBe(201);
  const uploadBody = (await upload.json()) as { data?: { id?: string } };
  const receiptId = uploadBody.data?.id;
  expect(receiptId).toBeTruthy();
  reportLiveSmokePhase('synthetic-receipt-uploaded');

  const detailPath = `/api/receipts/${receiptId}`;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(detailPath, {
          headers: { authorization: `Bearer ${token}` }
        });
        if (!response.ok()) return null;
        const receipt = (await response.json()).data as {
          status: string;
          store: string | null;
          purchaseDate: string | null;
        };
        if (
          receipt.status === 'queued' ||
          receipt.status === 'analyzing' ||
          receipt.status === 'review' ||
          receipt.status === 'failed' ||
          receipt.status === 'stopped'
        ) {
          reportLiveSmokePhase(`synthetic-receipt-status-${receipt.status}`);
        }
        if (receipt.status === 'review') {
          const storeMatches =
            receipt.store?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es') ===
            'supermercado qa';
          const dateMatches = receipt.purchaseDate === '2024-02-29';
          const extractionPhase = storeMatches
            ? dateMatches
              ? 'synthetic-receipt-review-store-and-date-match'
              : 'synthetic-receipt-review-store-match-date-mismatch'
            : dateMatches
              ? 'synthetic-receipt-review-store-mismatch-date-match'
              : 'synthetic-receipt-review-store-and-date-mismatch';
          reportLiveSmokePhase(extractionPhase);
        }
        return receipt;
      },
      { timeout: 200_000, intervals: [500, 1000, 2000] }
    )
    .toMatchObject({ status: 'review', purchaseDate: '2024-02-29' });
  const extractedReceiptResponse = await page.request.get(detailPath, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(extractedReceiptResponse.ok()).toBeTruthy();
  const extractedReceipt = (await extractedReceiptResponse.json()).data as {
    store: string | null;
  };
  expect(extractedReceipt.store?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')).toBe(
    'supermercado qa'
  );
  reportLiveSmokePhase('synthetic-receipt-extracted');

  const historyRow = page
    .locator('[data-test="receipt-history"] [data-test="ticket-history-item"]')
    .filter({ hasText: /supermercado\s+qa/i });
  await expect(historyRow).toHaveCount(1, { timeout: 15_000 });
  await historyRow.locator('a').click();
  const storeField = page.locator('#ticket-tienda');
  const dateField = page.locator('#ticket-fecha-compra');
  await expect(storeField).toHaveValue(/^\s*supermercado\s+qa\s*$/i);
  await expect(dateField).toHaveValue('2024-02-29');
  await storeField.fill(STORE_CORRECTED);
  await dateField.fill(DATE_CORRECTED);

  const saveResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === detailPath && response.request().method() === 'PATCH'
  );
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');
  await page.reload();
  await expect(storeField).toHaveValue(STORE_CORRECTED);
  await expect(dateField).toHaveValue(DATE_CORRECTED);

  const persisted = await page.request.get(detailPath, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(persisted.ok()).toBeTruthy();
  expect((await persisted.json()).data).toMatchObject({
    status: 'review',
    store: STORE_CORRECTED,
    purchaseDate: DATE_CORRECTED
  });
  reportLiveSmokePhase('synthetic-receipt-edited');

  await page.getByRole('link', { name: 'Volver a tickets' }).click();
  const correctedRow = page
    .locator('[data-test="receipt-history"] [data-test="ticket-history-item"]')
    .filter({ hasText: STORE_CORRECTED });
  await expect(correctedRow).toHaveCount(1);
  await expect(correctedRow.locator('.ticket__meta')).toContainText(DATE_CORRECTED_HISTORY);
  reportLiveSmokePhase('synthetic-receipt-history-verified');

  const realTicketPath = process.env.HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH;
  if (realTicketPath) {
    const realTicketBytes = await readFile(realTicketPath);
    expect(realTicketBytes.length).toBeGreaterThan(3);
    expect(realTicketBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(realTicketBytes.length).toBeLessThan(10 * 1024 * 1024);

    const realUploadResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/receipts' &&
        response.request().method() === 'POST'
    );
    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'ticket-real-smoke.jpeg',
      mimeType: 'image/jpeg',
      buffer: realTicketBytes
    });
    const realUpload = await realUploadResponse;
    expect(realUpload.status()).toBe(201);
    const realUploadBody = (await realUpload.json()) as { data?: { id?: string } };
    const realReceiptId = realUploadBody.data?.id;
    expect(realReceiptId).toBeTruthy();
    const realDetailPath = `/api/receipts/${realReceiptId}`;
    let parsedRealTicket = { status: 'queued', itemCount: 0 };

    await expect
      .poll(
        async () => {
          const response = await page.request.get(realDetailPath, {
            headers: { authorization: `Bearer ${token}` }
          });
          if (!response.ok()) return 'unavailable:0';
          const data = (await response.json()).data as {
            status?: unknown;
            lines?: unknown;
          };
          parsedRealTicket = {
            status: typeof data?.status === 'string' ? data.status : 'unknown',
            itemCount: Array.isArray(data?.lines) ? data.lines.length : 0
          };
          return `${parsedRealTicket.status}:${parsedRealTicket.itemCount}`;
        },
        { timeout: 200_000, intervals: [500, 1000, 2000] }
      )
      .toMatch(/^review:[1-9]\d*$/);
    reportLiveSmokePhase('real-receipt-extracted');
  }
});

test('valida una receta sintética con texto sin topes mediante una única petición real', async ({
  page
}) => {
  test.skip(
    !LIVE_SMOKE_ENABLED || !LIVE_RECIPE_ONLY,
    'La validación real de receta requiere su opt-in aislado.'
  );
  test.setTimeout(LIVE_TEST_TIMEOUT_MS);
  page.setDefaultTimeout(LIVE_REQUEST_TIMEOUT_MS);
  reportLiveSmokePhase('recipe-only-register-start');
  await registerWithHousehold(page, '/recipes', 'ai-live-recipe-only');
  reportLiveSmokePhase('recipe-only-registered');
  const token = await authToken(page);
  await saveLiveAiConfig(page, token);

  reportLiveSmokePhase('recipe-only-request-start');
  const response = await page.request.post('/api/ai/generate-recipe', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      ingredients: [
        {
          id: 'qa-unbounded-recipe-20261014',
          name: 'Mijo perlado de prueba QA 2026-10-14',
          quantity: 160,
          unit: 'g'
        }
      ],
      utensils: [],
      servings: 2,
      difficulty: 'easy',
      detailLevel: 'basic',
      preferences: ['Petición sintética aislada de validación del contrato de receta.']
    },
    timeout: LIVE_REQUEST_TIMEOUT_MS
  });
  reportLiveSmokePhase(
    response.status() === 200
      ? 'recipe-only-response-ok'
      : response.status() >= 500
        ? 'recipe-only-response-server-error'
        : 'recipe-only-response-other-error'
  );
  expect(response.status()).toBe(200);
  const envelope = (await response.json()) as {
    success: boolean;
    data: SmokeRecipe & { selectedDetailLevel: string };
  };
  expect(envelope.success).toBe(true);
  const recipe = envelope.data;
  expect(recipe.name.trim()).not.toBe('');
  expect(recipe.description.trim()).not.toBe('');
  expect(recipe.baseServings).toBe(1);
  expect(recipe.selectedDetailLevel).toBe('basic');
  expect(recipe.ingredients.length).toBeGreaterThan(0);
  expect(recipe.instructionsByLevel.basic.length).toBeGreaterThan(0);
  expect(recipe.instructionsByLevel.intermediate.length).toBeGreaterThan(0);
  expect(recipe.instructionsByLevel.expert.length).toBeGreaterThan(0);
  for (const level of RECIPE_DETAIL_LEVELS) {
    for (const step of recipe.instructionsByLevel[level]) {
      expect(step.instruction.trim()).not.toBe('');
    }
  }
  reportLiveSmokePhase('recipe-only-response-validated');
});

test('valida diez propuestas transitorias del asistente con WebAPI real', async ({ page }) => {
  test.skip(
    !LIVE_SMOKE_ENABLED || !LIVE_ASSISTANT_ONLY,
    'Smoke opt-in: requiere la modalidad exclusiva de propuestas del asistente.'
  );
  test.setTimeout(LIVE_TEST_TIMEOUT_MS);
  page.setDefaultTimeout(LIVE_REQUEST_TIMEOUT_MS);

  reportLiveSmokePhase('assistant-only-register-start');
  await registerWithHousehold(page, '/dashboard', 'ai-live-assistant-only');
  const token = await authToken(page);
  await saveLiveAiConfig(page, token);
  reportLiveSmokePhase('assistant-only-configured');

  const before = liveAssistantDatabaseSnapshot();
  expect(before.ai_jobs ?? []).toHaveLength(0);
  const headers = { authorization: `Bearer ${token}` };

  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    reportLiveSmokePhase('assistant-proposal-request-start');
    const prompt = `Añade exactamente un ingrediente a la despensa: 250 g de arroz integral QA WebAPI ${String(ordinal).padStart(2, '0')}, categoría cereales, ubicación despensa, sin caducidad ni notas.`;
    const response = await page.request.post('/api/ai/assistant/proposals', {
      headers,
      data: { prompt, route: 'pantry', referenceDate: '2026-10-17' },
      timeout: LIVE_REQUEST_TIMEOUT_MS
    });
    const responseStatus = response.status();
    reportLiveSmokePhase(
      responseStatus === 200
        ? 'assistant-proposal-response-ok'
        : responseStatus >= 500
          ? 'assistant-proposal-response-server-error'
          : 'assistant-proposal-response-other-error'
    );
    const responseBody = await response.json().catch(() => null);
    const safeErrorCodes = new Set([
      'AI_CANCELLED',
      'AI_NOT_CONFIGURED',
      'AI_PROVIDER_ERROR',
      'AI_TIMEOUT',
      'ASSISTANT_BUSY',
      'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED',
      'INVALID_AI_RESULT',
      'INVALID_ASSISTANT_REQUEST'
    ]);
    const responseErrorCode =
      responseBody &&
      typeof responseBody === 'object' &&
      'code' in responseBody &&
      typeof responseBody.code === 'string' &&
      safeErrorCodes.has(responseBody.code)
        ? responseBody.code
        : 'unavailable';
    if (responseStatus !== 200) {
      reportLiveSmokePhase(`assistant-proposal-error-${responseErrorCode}`);
      const diagnostics: string[] =
        responseBody &&
        typeof responseBody === 'object' &&
        'diagnostics' in responseBody &&
        typeof responseBody.diagnostics === 'object' &&
        responseBody.diagnostics !== null &&
        'invalidPaths' in responseBody.diagnostics &&
        Array.isArray(responseBody.diagnostics.invalidPaths)
          ? responseBody.diagnostics.invalidPaths.filter(
              (path: unknown): path is string => typeof path === 'string'
            )
          : [];
      const safePayloadFields = new Set([
        'name',
        'quantity',
        'unit',
        'category',
        'expirationDate',
        'location',
        'notes'
      ]);
      const invalidPayloadField = diagnostics
        .map((path) =>
          path.match(
            /^actions\.\d+\.payload\.([A-Za-z][A-Za-z0-9]*):(invalid_type|too_small|too_big|invalid_value|invalid_format|unrecognized_keys|custom)$/
          )
        )
        .find((match) => match && safePayloadFields.has(match[1]));
      if (invalidPayloadField) {
        reportLiveSmokePhase(
          `assistant-proposal-invalid-${invalidPayloadField[1]}-${invalidPayloadField[2]}`
        );
      }
    }
    expect(responseStatus, `Respuesta de propuesta rechazada: ${responseErrorCode}`).toBe(200);

    const body = responseBody as {
      success?: unknown;
      data?: {
        summary?: unknown;
        actions?: Array<{
          kind?: unknown;
          domain?: unknown;
          selected?: unknown;
          status?: unknown;
          payload?: { name?: unknown; quantity?: unknown; unit?: unknown };
        }>;
        questions?: unknown;
      };
    } | null;
    const action = body?.data?.actions?.[0];
    const quantity = action?.payload?.quantity;
    const proposalChecks = [
      ['success', body?.success === true],
      ['summary', typeof body?.data?.summary === 'string' && body.data.summary.trim().length > 0],
      ['action-count', body?.data?.actions?.length === 1],
      ['action-kind', action?.kind === 'pantry.add_ingredient'],
      ['domain', action?.domain === 'pantry'],
      ['selection', action?.selected === false],
      ['status', action?.status === 'pending'],
      [
        'payload-name',
        typeof action?.payload?.name === 'string' && action.payload.name.trim().length > 0
      ],
      [
        'payload-quantity',
        typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
      ],
      ['payload-unit', typeof action?.payload?.unit === 'string' && action.payload.unit.length > 0],
      ['questions', Array.isArray(body?.data?.questions)]
    ] as const;
    const failedCheck = proposalChecks.find(([, passed]) => !passed)?.[0];
    if (failedCheck) reportLiveSmokePhase(`assistant-proposal-invalid-${failedCheck}`);
    expect(
      failedCheck,
      `Propuesta inválida: comprobación ${failedCheck ?? 'desconocida'}`
    ).toBeUndefined();
    const afterProposal = liveAssistantDatabaseSnapshot();
    expect(afterProposal).toEqual(before);
    expect(afterProposal.ai_jobs ?? []).toHaveLength(0);
    reportLiveSmokePhase('assistant-proposal-response-validated');
  }

  const after = liveAssistantDatabaseSnapshot();
  expect(after).toEqual(before);
  expect(after.ai_jobs ?? []).toHaveLength(0);
  reportLiveSmokePhase('assistant-proposals-read-only-validated');
});

test('cubre los ocho AiJobKind con fixtures de proveedor loopback', async ({ page }) => {
  test.skip(LIVE_SMOKE_ENABLED, 'Las fixtures loopback se ejecutan fuera del smoke real.');
  test.setTimeout(120_000);

  const provider = new SyntheticAiProvider();
  await provider.start();
  try {
    await registerWithHousehold(page, '/dashboard', 'ai-synthetic-job-kinds');
    const token = await authToken(page);
    const headers = { authorization: `Bearer ${token}` };

    const configResponse = await page.request.post('/api/ai/configs', {
      headers,
      data: {
        name: 'Proveedor loopback sintético',
        provider: 'custom',
        baseUrl: provider.baseUrl,
        apiKey: 'synthetic-only-not-a-secret',
        model: 'synthetic-ai-model',
        maxTokens: 512,
        timeout: 15_000,
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status()).toBe(201);
    const config = (await configResponse.json()) as { data?: { id?: string } };
    expect(config.data?.id).toBeTruthy();
    const configId = config.data!.id!;

    // connection_test: respuesta JSON estricta mediante la misma frontera de despacho.
    provider.enqueue({ status: 'ok', message: 'synthetic connection ok' });
    const connectionResponse = await page.request.post('/api/ai/test-connection', {
      headers,
      data: { configId }
    });
    expect(connectionResponse.status()).toBe(200);
    expect((await connectionResponse.json()).data).toMatchObject({
      success: true,
      model: 'synthetic-ai-model',
      message: 'synthetic connection ok'
    });
    expect(provider.requests[0].hasResponseFormat).toBe(true);

    const syntheticIngredients = COMPLEX_RECIPE_INGREDIENTS.map((ingredient, index) => ({
      ...ingredient,
      id: `ingredient-qa-${index + 1}`
    }));

    // recipe: varios ingredientes, varias fases y las instrucciones completas por nivel.
    provider.enqueue(complexRecipeFixture());
    const singleRecipeResponse = await page.request.post('/api/ai/generate-recipe', {
      headers,
      data: {
        ingredients: syntheticIngredients,
        servings: 6,
        difficulty: 'hard',
        detailLevel: 'expert',
        preferences: ['Preparación compleja de varias fases, con tiempos y señales observables.']
      }
    });
    expect(singleRecipeResponse.status()).toBe(200);
    const singleRecipe = (await singleRecipeResponse.json()).data as SmokeRecipe & {
      selectedDetailLevel: 'basic' | 'intermediate' | 'expert';
    };
    expectComplexRecipe(singleRecipe);
    expect(singleRecipe.ingredients).toHaveLength(COMPLEX_RECIPE_INGREDIENTS.length);
    expect(singleRecipe.selectedDetailLevel).toBe('expert');
    const singleRecipePrompt = provider.requests[1].userPrompt;
    for (const ingredient of COMPLEX_RECIPE_INGREDIENTS) {
      expect(singleRecipePrompt).toContain(
        `${ingredient.quantity} ${ingredient.unit} de ${ingredient.name}`
      );
    }
    expect(singleRecipePrompt).toContain('Preparación compleja de varias fases');

    // multiple_recipes: count=2 con despensa variada y candidatas diferentes.
    const receta = (name: string, ingredientNames: string[], instruction: string) => ({
      name,
      description: 'Borrador de fixture sintética.',
      difficulty: 'easy',
      cuisine: 'Casera',
      totalTime: 20,
      prepTime: 5,
      cookTime: 15,
      restTime: null,
      baseServings: 1,
      calories: 180,
      ingredients: ingredientNames.map((ingredientName) => ({
        name: ingredientName,
        quantity: 1,
        unit: 'unit',
        preparation: 'lavado',
        isOptional: false,
        substitutes: [],
        notes: ''
      })),
      utensils: ['cuchillo'],
      guidance: {
        appliances: ['Cocina de gas'],
        parallelTasks: ['Lava y prepara las verduras mientras se calienta la olla.'],
        tipsAndVariations: ['Ajusta el fuego para mantener una cocción suave.'],
        batchCookingWarning: null
      },
      instructionsByLevel: {
        basic: [
          {
            stepNumber: 1,
            instruction: `Lava los ingredientes que lo necesiten. ${instruction}`,
            duration: 5,
            temperature: null,
            timerRequired: true,
            timerDuration: 5,
            tips: 'Fixture breve',
            warning: null,
            illustration: null
          }
        ],
        intermediate: [
          {
            stepNumber: 1,
            instruction: `${instruction} Comprueba la textura antes de continuar.`,
            duration: 5,
            temperature: null,
            timerRequired: true,
            timerDuration: 5,
            tips: 'Ajusta el fuego si hace falta.',
            warning: null,
            illustration: null
          }
        ],
        expert: [
          {
            stepNumber: 1,
            instruction: `${instruction} Mantén temperatura estable y evalúa el punto final.`,
            duration: 5,
            temperature: null,
            timerRequired: true,
            timerDuration: 5,
            tips: 'Busca señales observables de cocción.',
            warning: null,
            illustration: null
          }
        ]
      },
      nutrition: { calories: 180, protein: 2, carbs: 20, fat: 5, fiber: 4 },
      storage: {
        method: 'Refrigerar',
        duration: '2 días',
        reheatingInstructions: 'No aplica',
        container: 'Recipiente hermético',
        freezingPossible: false,
        freezingDuration: ''
      },
      tags: ['synthetic']
    });
    provider.enqueue(
      receta(
        'Receta QA uno',
        ['Garbanzos secos QA', 'Morcillo de ternera QA'],
        'Preparar los garbanzos y cocerlos lentamente con el morcillo.'
      ),
      receta(
        'Receta QA dos',
        ['Pollo QA', 'Patatas QA'],
        'Dorar el pollo y terminar la cocción con patatas.'
      )
    );
    const multipleResponse = await page.request.post('/api/ai/generate-multiple-recipes', {
      headers,
      data: {
        ingredients: syntheticIngredients,
        count: 2,
        servings: 6,
        difficulty: 'hard',
        detailLevel: 'expert'
      }
    });
    const multiplePayload = (await multipleResponse.json()) as { message?: unknown };
    expect(
      multipleResponse.status(),
      String(multiplePayload.message ?? 'No response message')
    ).toBe(200);
    const multiple = multiplePayload as {
      data: Array<{
        name: string;
        ingredients: Array<{ name: string; quantity: number; unit: string }>;
        instructionsByLevel: Record<
          'basic' | 'intermediate' | 'expert',
          Array<{ instruction: string }>
        >;
      }>;
    };
    expect(multiple.data).toHaveLength(2);
    expect(multiple.data.map(({ name }) => name)).toEqual(['Receta QA uno', 'Receta QA dos']);
    expect(multiple.data.every(({ ingredients }) => ingredients.length >= 2)).toBe(true);
    for (const recipe of multiple.data) {
      const ingredientNames = recipe.ingredients.map(({ name }) => normalizeRecipeText(name));
      expect(new Set(ingredientNames).size).toBe(ingredientNames.length);
    }
    expect(
      multiple.data.every(({ instructionsByLevel }) =>
        ['basic', 'intermediate', 'expert'].every(
          (level) => instructionsByLevel[level as 'basic' | 'intermediate' | 'expert'].length > 0
        )
      )
    ).toBe(true);
    expect(multiple.data[0].ingredients).not.toEqual(multiple.data[1].ingredients);
    expect(multiple.data[0].instructionsByLevel).not.toEqual(multiple.data[1].instructionsByLevel);
    expect(provider.requests.slice(2, 4).every(({ stream }) => !stream)).toBe(true);
    for (const request of provider.requests.slice(2, 4)) {
      for (const ingredient of COMPLEX_RECIPE_INGREDIENTS) {
        expect(request.userPrompt).toContain(
          `${ingredient.quantity} ${ingredient.unit} de ${ingredient.name}`
        );
      }
    }

    // recommendations: output is an ephemeral suggestion, not a persisted recipe.
    provider.enqueue({
      recommendations: [
        {
          name: 'Recomendación QA',
          reason: 'Aprovecha ingredientes disponibles.',
          ingredients: ['Garbanzos secos QA', 'Pollo QA', 'Patatas QA'],
          estimatedTime: 15
        }
      ]
    });
    const recommendationsResponse = await page.request.post('/api/ai/recommendations', {
      headers,
      data: {
        availableIngredients: COMPLEX_RECIPE_INGREDIENTS.map(({ name }) => name),
        recentMeals: [],
        count: 1
      }
    });
    expect(recommendationsResponse.status()).toBe(200);
    expect((await recommendationsResponse.json()).data).toMatchObject([
      { name: 'Recomendación QA', estimatedTime: 15 }
    ]);

    // weekly_plan: confirma persistencia en calendario, no solo el JSON del modelo.
    const weekStart = '2026-10-05';
    provider.enqueue({
      days: [
        {
          date: weekStart,
          meals: {
            dinner: {
              name: 'Cena QA persistida',
              ingredients: ['Garbanzos secos QA', 'Pollo QA', 'Patatas QA'],
              time: 0
            }
          },
          totalCalories: 180
        }
      ],
      shoppingList: []
    });
    const planResponse = await page.request.post('/api/ai/plan-week', {
      headers,
      data: {
        startDate: weekStart,
        endDate: weekStart,
        goals: {
          types: ['balanced', 'muscle-gain', 'custom'],
          customInstructions: 'Prioriza platos caseros y aprovecha la despensa.'
        },
        availableIngredients: COMPLEX_RECIPE_INGREDIENTS.map(({ name }) => name),
        mealTypes: ['dinner']
      }
    });
    expect(planResponse.status()).toBe(200);
    const weeklyPlanPrompt = provider.requests.at(-1)!.userPrompt;
    expect(weeklyPlanPrompt).toContain('Objetivos: Equilibrada, Ganar músculo');
    expect(weeklyPlanPrompt).toContain('Prioriza platos caseros y aprovecha la despensa.');
    for (const ingredient of COMPLEX_RECIPE_INGREDIENTS) {
      expect(weeklyPlanPrompt).toContain(ingredient.name);
    }
    const plan = (await planResponse.json()).data;
    expect(plan.saved.created).toBe(1);
    const calendarResponse = await page.request.get(
      `/api/calendar/range?startDate=${weekStart}&endDate=${weekStart}`,
      { headers }
    );
    expect(calendarResponse.status()).toBe(200);
    const calendar = (await calendarResponse.json()).data;
    expect(calendar.meals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: weekStart,
          meal_type: 'dinner',
          custom_meal: 'Cena QA persistida'
        })
      ])
    );

    // expiry_estimate: nombre deliberadamente fuera del catálogo; lee después de escribir.
    const ingredientName = 'ai-live-expiry-synthetic-needle-183746';
    const ingredientResponse = await page.request.post('/api/pantry/ingredients', {
      headers,
      data: {
        name: ingredientName,
        category: 'other',
        quantity: 1,
        unit: 'unit',
        location: 'pantry'
      }
    });
    expect(ingredientResponse.status()).toBe(201);
    const ingredient = (await ingredientResponse.json()).data as {
      id: string;
      estimated_shelf_days: number | null;
    };
    expect(ingredient.estimated_shelf_days).toBeNull();
    provider.enqueue({ products: [{ name: ingredientName, days: 14 }] });
    const expiryResponse = await page.request.post('/api/pantry/expiry/estimate', {
      headers,
      data: {}
    });
    expect(expiryResponse.status()).toBe(200);
    expect((await expiryResponse.json()).data).toMatchObject({ ia: 1, sinEstimar: 0 });
    const ingredientRead = await page.request.get(
      `/api/pantry/ingredients/${encodeURIComponent(ingredient.id)}`,
      { headers }
    );
    expect(ingredientRead.status()).toBe(200);
    expect((await ingredientRead.json()).data.estimated_shelf_days).toBe(14);

    // shopping_photo: PNG sintético, línea editable en UI y la lista aún sin escrituras.
    const listResponse = await page.request.post('/api/shopping/lists', {
      headers,
      data: { name: 'Lista foto IA sintética' }
    });
    expect(listResponse.status()).toBe(201);
    const list = (await listResponse.json()).data as { id: string };
    await page.goto(`/shopping/${encodeURIComponent(list.id)}`);
    await expect(page.locator('[data-test="photo-open"]')).toBeVisible();
    await page.locator('[data-test="photo-open"]').click();
    await selectShelfPhotoMode(page);
    const syntheticShelfPhoto = await syntheticShoppingPhotoPng(page);
    const syntheticTicketPhoto = await syntheticReceiptPng(page);
    expect(syntheticShelfPhoto.equals(syntheticTicketPhoto)).toBe(false);
    await page.locator('input[name="photoFile"]').setInputFiles({
      name: 'foto-cesta-sintetica.png',
      mimeType: 'image/png',
      buffer: syntheticShelfPhoto
    });
    provider.enqueue({
      lines: [
        {
          name: 'Tomates QA foto',
          quantity: 2,
          unit: 'unit',
          category: 'other',
          priceMinor: 250,
          confidence: 0.98
        }
      ],
      currency: 'EUR',
      warnings: []
    });
    const photoRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/shopping/lists/${list.id}/photo/analyze`) &&
        request.method() === 'POST'
    );
    const photoResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shopping/lists/${list.id}/photo/analyze`) &&
        response.request().method() === 'POST'
    );
    await page.locator('[data-test="photo-analyze"]').click();
    const photoRequest = await photoRequestPromise;
    expect(photoRequest.postDataJSON()).toMatchObject({ mode: 'shelf' });
    expect(photoRequest.postDataJSON().image).toMatch(/^data:image\/png;base64,/);
    const photoResponse = await photoResponsePromise;
    expect(photoResponse.status()).toBe(200);
    expect((await photoResponse.json()).data.lines).toMatchObject([
      { name: 'Tomates QA foto', quantity: 2 }
    ]);
    const editableLine = page.locator('.detail__photo-name').first();
    await expect(editableLine).toHaveValue('Tomates QA foto');
    await editableLine.fill('Tomates QA editados');
    await expect(editableLine).toHaveValue('Tomates QA editados');
    const unchangedList = await page.request.get(
      `/api/shopping/lists/${encodeURIComponent(list.id)}`,
      { headers }
    );
    expect((await unchangedList.json()).data.items).toEqual([]);

    expect(provider.requests).toHaveLength(8);
    expect(provider.requests.every(({ model }) => model === 'synthetic-ai-model')).toBe(true);
    expect(provider.requests.some(({ hasImage }) => hasImage)).toBe(true);
    expect(provider.requests.every(({ hasResponseFormat }) => hasResponseFormat)).toBe(true);
    expect(provider.requests.every(({ stream }) => !stream)).toBe(true);
    expect(provider.pendingReplyCount).toBe(0);
  } finally {
    await provider.close();
  }
});
