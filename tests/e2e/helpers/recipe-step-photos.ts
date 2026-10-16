import type { Page } from '@playwright/test';

const PHOTO_IDS: Record<string, string> = {
  wash: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  cut: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  mix: 'cccccccccccccccccccccccc',
  cook: 'dddddddddddddddddddddddd',
  bake: 'eeeeeeeeeeeeeeeeeeeeeeee',
  rest: 'ffffffffffffffffffffffff',
  serve: '111111111111111111111111',
  prepare: '222222222222222222222222'
};

async function createSyntheticPng(page: Page): Promise<Buffer> {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for the synthetic recipe photo.');

    const background = context.createLinearGradient(0, 0, 800, 450);
    background.addColorStop(0, '#f3c47d');
    background.addColorStop(1, '#c36b39');
    context.fillStyle = background;
    context.fillRect(0, 0, 800, 450);

    // Draw a clear, colourful test illustration so screenshots never suggest
    // that the recipe step contains an empty or failed photo.
    context.strokeStyle = 'rgba(116, 61, 34, 0.17)';
    context.lineWidth = 3;
    for (let y = 42; y < 450; y += 58) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(800, y - 8);
      context.stroke();
    }

    context.fillStyle = '#3a3935';
    context.beginPath();
    context.ellipse(400, 238, 292, 172, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#c8c5bc';
    context.beginPath();
    context.ellipse(400, 224, 244, 142, 0, 0, Math.PI * 2);
    context.fill();
    const soup = context.createRadialGradient(350, 180, 24, 400, 224, 235);
    soup.addColorStop(0, '#f4a541');
    soup.addColorStop(1, '#c84321');
    context.fillStyle = soup;
    context.beginPath();
    context.ellipse(400, 224, 226, 126, 0, 0, Math.PI * 2);
    context.fill();

    const ingredients = [
      [318, 180, 23, '#f6d46d'],
      [405, 156, 20, '#7e9b43'],
      [491, 203, 25, '#f0d274'],
      [350, 260, 21, '#6f8d3c'],
      [448, 280, 24, '#f3c65c'],
      [530, 259, 18, '#82a14c'],
      [270, 216, 17, '#f4ca63'],
      [389, 222, 18, '#7b9840'],
      [470, 152, 16, '#f5d879'],
      [336, 307, 15, '#8da955'],
      [423, 188, 15, '#f0d071'],
      [502, 291, 16, '#79964a']
    ] as const;
    for (const [x, y, radius, color] of ingredients) {
      context.fillStyle = color;
      context.beginPath();
      context.ellipse(x, y, radius, radius * 0.72, -0.28, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = 'rgba(255, 244, 206, 0.8)';
    for (const [x, y] of [
      [369, 190],
      [456, 232],
      [302, 256],
      [438, 299],
      [520, 173]
    ]) {
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    }
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  });
  return Buffer.from(encoded, 'base64');
}

export interface StepPhotoRequest {
  path: string;
  params: Record<string, string>;
}

/** Isolated E2E media: no internet request and no real recipe text leaves the browser. */
export async function mockRecipeStepPhotos(page: Page): Promise<StepPhotoRequest[]> {
  const requests: StepPhotoRequest[] = [];
  const syntheticPng = await createSyntheticPng(page);
  await page.route('**/api/recipes/step-photos**', async (route) => {
    const url = new URL(route.request().url());
    const params = Object.fromEntries(url.searchParams.entries());
    requests.push({ path: url.pathname, params });

    if (url.pathname.endsWith('/image')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: syntheticPng });
      return;
    }

    const scene = url.searchParams.get('scene') ?? '';
    const id = PHOTO_IDS[scene];
    if (!id || Object.keys(params).some((key) => key !== 'scene')) {
      await route.fulfill({
        status: 400,
        json: { success: false, message: 'Invalid photo scene' }
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        success: true,
        data: {
          id,
          altText: `Imagen sintética de referencia: ${scene}`,
          author: 'Autora sintética de E2E',
          licenseName: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          sourceUrl: `https://commons.wikimedia.org/wiki/File:synthetic-${scene}.jpg`
        }
      }
    });
  });
  return requests;
}
