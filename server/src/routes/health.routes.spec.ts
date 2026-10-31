import { afterEach, describe, expect, it } from 'vitest';
import { healthRoutes } from './health.routes.js';

const originalImageRef = process.env.APP_IMAGE_REF;

afterEach(() => {
  if (originalImageRef === undefined) delete process.env.APP_IMAGE_REF;
  else process.env.APP_IMAGE_REF = originalImageRef;
});

describe('health route runtime metadata', () => {
  it('returns process uptime and the exact published image ref without caching it', async () => {
    process.env.APP_IMAGE_REF = 'ghcr.io/juanjoGonDev/hogaria:abc123';

    const response = await healthRoutes.request('/');
    const body = (await response.json()) as { uptime: number; imageRef: string };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.imageRef).toBe('ghcr.io/juanjoGonDev/hogaria:abc123');
  });

  it('labels an unset image ref as local and unpublished', async () => {
    delete process.env.APP_IMAGE_REF;

    const response = await healthRoutes.request('/');
    const body = (await response.json()) as { imageRef: string };

    expect(body.imageRef).toBe('local-unpublished');
  });
});
