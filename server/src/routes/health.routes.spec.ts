import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthRoutes } from './health.routes.js';

describe('health runtime metadata', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('exposes the container image revision separately from the app version', async () => {
    vi.stubEnv('HOGARIA_IMAGE_REVISION', '0123456789abcdef');

    const response = await healthRoutes.request('/');
    const body = (await response.json()) as {
      version: string;
      imageRevision: string;
      uptime: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      version: '1.0.0',
      imageRevision: '0123456789abcdef'
    });
    expect(body.uptime).toEqual(expect.any(Number));
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('uses an explicit dev revision when the image build arg is absent or blank', async () => {
    vi.stubEnv('HOGARIA_IMAGE_REVISION', '   ');

    const response = await healthRoutes.request('/');
    const body = (await response.json()) as { imageRevision: string };

    expect(body.imageRevision).toBe('dev');
  });
});
