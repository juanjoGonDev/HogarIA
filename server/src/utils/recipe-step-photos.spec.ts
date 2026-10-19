import { describe, expect, it, vi } from 'vitest';
import {
  RECIPE_STEP_PHOTO_SCENES,
  createRecipeStepPhotoProvider,
  type RecipeStepPhotoScene
} from './recipe-step-photos.js';

function commonsResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      query: {
        pages: [
          {
            title: 'File:Cooking_step.jpg',
            imageinfo: [
              {
                mime: 'image/jpeg',
                thumburl: 'https://thumb.wikimedia.org/thumbs/cooking-step.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cooking_step.jpg',
                extmetadata: {
                  Artist: { value: '<a href="https://example.test">Ana &amp; Luis</a>' },
                  LicenseShortName: { value: 'CC BY 4.0' },
                  LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
                  ObjectName: { value: 'Fresh vegetables on a board' }
                }
              }
            ]
          }
        ]
      },
      ...overrides
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('recipe step photo search', () => {
  it('exposes only fixed cooking scenes', () => {
    expect(RECIPE_STEP_PHOTO_SCENES).toEqual([
      'wash',
      'cut',
      'mix',
      'cook',
      'bake',
      'rest',
      'serve',
      'prepare'
    ]);
    expect(RECIPE_STEP_PHOTO_SCENES).not.toContain('recipe-title' as RecipeStepPhotoScene);
  });

  it.each(['thumb.wikimedia.org', 'upload.wikimedia.org'])(
    'allows Wikimedia image host %s',
    async (host) => {
      const payload = JSON.parse(await commonsResponse().text());
      payload.query.pages[0].imageinfo[0].thumburl = `https://${host}/thumbs/cooking-step.jpg`;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
      const photo = await createRecipeStepPhotoProvider({ fetcher }).search('cut');

      expect(photo).not.toBeNull();
    }
  );

  it('uses a fixed generic query and returns safe photo attribution', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(commonsResponse())
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      );
    const provider = createRecipeStepPhotoProvider({ fetcher });

    const photo = await provider.search('cut');

    expect(photo).toMatchObject({
      altText: 'Fresh vegetables on a board',
      author: 'Ana & Luis',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cooking_step.jpg',
      thumbnailUrl: 'https://thumb.wikimedia.org/thumbs/cooking-step.jpg'
    });
    expect(photo?.id).toMatch(/^[a-f0-9]{24}$/);
    const request = fetcher.mock.calls[0];
    const apiUrl = new URL(String(request[0]));
    expect(apiUrl.origin).toBe('https://commons.wikimedia.org');
    expect(apiUrl.searchParams.get('gsrsearch')).toBe('photo chopping vegetables cutting board knife');
    expect(apiUrl.searchParams.get('gsrlimit')).toBe('5');
    expect(request[1]?.headers).toMatchObject({
      'Api-User-Agent': expect.stringContaining('HogarIA/'),
      'User-Agent': expect.stringContaining('HogarIA/')
    });
    expect(request[1]?.redirect).toBe('error');
    expect(JSON.stringify(request)).not.toContain('Ana & Luis');

    const image = await provider.getImage(photo!.id);
    expect(image).toMatchObject({ mimeType: 'image/jpeg' });
    expect(Array.from(image!.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await provider.getImage(photo!.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unknown author', { Artist: { value: 'Unknown' } }],
    ['missing license', { LicenseUrl: { value: '' } }],
    ['raster drawing', { ObjectName: { value: 'Vector illustration of chopping' } }],
    ['unsafe image host', { thumburl: 'https://attacker.test/photo.jpg' }],
    ['unsafe source link', { descriptionurl: 'https://attacker.test/file' }],
    ['SVG instead of photo', { mime: 'image/svg+xml' }],
    ['unsafe license link', { LicenseUrl: { value: 'javascript:alert(1)' } }]
  ])('rejects metadata with %s', async (_label, change) => {
    const base = JSON.parse(await commonsResponse().text());
    const imageInfo = base.query.pages[0].imageinfo[0];
    if ('Artist' in change) imageInfo.extmetadata.Artist = change.Artist;
    if ('LicenseUrl' in change) imageInfo.extmetadata.LicenseUrl = change.LicenseUrl;
    if ('thumburl' in change) imageInfo.thumburl = change.thumburl;
    if ('descriptionurl' in change) imageInfo.descriptionurl = change.descriptionurl;
    if ('mime' in change) imageInfo.mime = change.mime;
    if ('ObjectName' in change) imageInfo.extmetadata.ObjectName = change.ObjectName;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(base), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const photo = await createRecipeStepPhotoProvider({ fetcher }).search('cut');

    expect(photo).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns empty for malformed or empty responses and normalizes upstream failures', async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{bad json', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await expect(createRecipeStepPhotoProvider({ fetcher: malformed }).search('wash')).rejects.toThrow();

    const empty = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ query: { pages: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect(createRecipeStepPhotoProvider({ fetcher: empty }).search('wash')).resolves.toBeNull();

    const unavailable = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('unavailable', { status: 429 })
    );
    await expect(createRecipeStepPhotoProvider({ fetcher: unavailable }).search('wash')).rejects.toThrow();
  });

  it('rejects oversized or non-raster image responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(commonsResponse())
      .mockResolvedValueOnce(
        new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      );
    const provider = createRecipeStepPhotoProvider({ fetcher });
    const photo = await provider.search('cut');

    await expect(provider.getImage(photo!.id)).rejects.toThrow();
  });

  it('fetches a persisted thumbnail only from the allowed Wikimedia raster hosts', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    );
    const provider = createRecipeStepPhotoProvider({ fetcher });

    const image = await provider.getImageFromUrl?.('https://upload.wikimedia.org/thumbs/photo.png');
    expect(image).toMatchObject({ mimeType: 'image/png' });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
    await expect(provider.getImageFromUrl?.('https://attacker.test/photo.png')).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent searches for the same scene', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => (release = resolve));
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending);
    const provider = createRecipeStepPhotoProvider({ fetcher });
    const first = provider.search('cut');
    const second = provider.search('cut');
    release(commonsResponse());

    const photos = await Promise.all([first, second]);

    expect(photos[0]).not.toBeNull();
    expect(photos[1]).toEqual(photos[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts an upstream request on timeout', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
    );

    await expect(
      createRecipeStepPhotoProvider({ fetcher, timeoutMs: 1 }).search('wash')
    ).rejects.toThrow();
  });

  it('refuses unknown scenes and image identifiers without doing network requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createRecipeStepPhotoProvider({ fetcher });

    await expect(provider.search('recipe-title' as RecipeStepPhotoScene)).rejects.toThrow();
    await expect(provider.getImage('attacker-controlled')).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('searches recipe cover photos by a bounded user query and retains validated metadata', async () => {
    const payload = JSON.parse(await commonsResponse().text());
    payload.query.pages.push({
      title: 'File:Second_cooking_photo.jpg',
      imageinfo: [
        {
          ...payload.query.pages[0].imageinfo[0],
          thumburl: 'https://upload.wikimedia.org/thumbs/second-photo.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Second_cooking_photo.jpg',
          extmetadata: {
            Artist: { value: 'María' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
            ObjectName: { value: 'Homemade Spanish tortilla' }
          }
        }
      ]
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const provider = createRecipeStepPhotoProvider({ fetcher });

    const photos = await provider.searchByQuery(' tortilla española ');

    expect(photos).toHaveLength(2);
    expect(photos[0]).toMatchObject({
      altText: 'Fresh vegetables on a board',
      author: 'Ana & Luis'
    });
    expect(photos[1]).toMatchObject({
      author: 'María',
      licenseName: 'CC BY-SA 4.0'
    });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('gsrsearch')).toBe(
      'tortilla española'
    );
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('gsrlimit')).toBe('10');
    expect(provider.getPhoto(photos[1].id)).toMatchObject({ author: 'María' });
  });

  it('limits results to ten and rejects invalid or oversized search text before networking', async () => {
    const payload = JSON.parse(await commonsResponse().text());
    payload.query.pages = Array.from({ length: 12 }, (_, index) => {
      const imageInfo = payload.query.pages[0].imageinfo[0];
      return {
        title: `File:Photo_${index}.jpg`,
        imageinfo: [{
          ...imageInfo,
          thumburl: `https://thumb.wikimedia.org/thumbs/photo-${index}.jpg`,
          descriptionurl: `https://commons.wikimedia.org/wiki/File:Photo_${index}.jpg`
        }]
      };
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const provider = createRecipeStepPhotoProvider({ fetcher });

    await expect(provider.searchByQuery('x')).rejects.toThrow();
    await expect(provider.searchByQuery('x'.repeat(81))).rejects.toThrow();
    const photos = await provider.searchByQuery('  pollo\n al horno  ');

    expect(photos).toHaveLength(10);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('gsrsearch')).toBe('pollo al horno');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
