import { describe, expect, it } from 'vitest';
import { createRecipeStepPhotoProvider } from './recipe-step-photos.js';

describe.skipIf(process.env.HOGARIA_REAL_PHOTO_SMOKE !== '1')(
  'opt-in Wikimedia Commons photo smoke test',
  () => {
    it('finds one generic cooking photo and downloads its same-origin-proxy payload', async () => {
      const provider = createRecipeStepPhotoProvider();
      const photo = await provider.search('cut');

      expect(photo).not.toBeNull();
      expect(photo?.licenseName).toBeTruthy();
      expect(photo?.author).toBeTruthy();
      expect(photo?.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);

      const image = await provider.getImage(photo!.id);
      expect(image).not.toBeNull();
      expect(image?.bytes.byteLength).toBeGreaterThan(0);
      expect(['image/jpeg', 'image/png', 'image/webp']).toContain(image?.mimeType);
    }, 15_000);
  }
);
