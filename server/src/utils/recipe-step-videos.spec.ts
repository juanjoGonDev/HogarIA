import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import {
  MAX_RECIPE_STEP_VIDEO_BYTES,
  MAX_RECIPE_STEP_VIDEO_RANGE_BYTES,
  RECIPE_STEP_VIDEO_SCENES,
  createRecipeStepVideoProvider
} from './recipe-step-videos.js';

const VIDEO_URL =
  'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Chop.webm/Chop.webm.360p.vp9.webm';
const THUMB_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Chop.webm/320px-Chop.webm.jpg';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const SOURCE_URL = 'https://commons.wikimedia.org/wiki/File:Chop.webm';

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function searchResponse(titles = ['File:Chop.webm']): Response {
  return jsonResponse({ query: { search: titles.map((title) => ({ title })) } });
}

function detailsResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    query: {
      pages: [
        {
          title: 'File:Chop.webm',
          videoinfo: [
            {
              descriptionurl: SOURCE_URL,
              thumburl: THUMB_URL,
              extmetadata: {
                Artist: { value: '<a href="https://example.test">Ana Cocina</a>' },
                LicenseShortName: { value: 'CC BY 4.0' },
                LicenseUrl: { value: LICENSE_URL },
                ObjectName: { value: 'Chopping vegetables on a board' }
              },
              derivatives: [
                {
                  src: VIDEO_URL,
                  type: 'video/webm',
                  width: 640,
                  height: 360,
                  bitrate: 480000
                }
              ],
              ...overrides
            }
          ]
        }
      ]
    }
  });
}

function fileResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    title: 'Chop.webm',
    file_description_url: SOURCE_URL,
    preferred: {
      mediatype: 'VIDEO',
      size: 680000,
      duration: 22,
      url: VIDEO_URL
    },
    thumbnail: { url: THUMB_URL, mediatype: 'BITMAP' },
    ...overrides
  });
}

function validSearchFetcher(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(searchResponse())
    .mockResolvedValueOnce(detailsResponse())
    .mockResolvedValueOnce(fileResponse());
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Commons recipe step video provider', () => {
  it('exposes only enumerated generic kitchen scenes', () => {
    expect(RECIPE_STEP_VIDEO_SCENES).toEqual([
      'wash',
      'cut',
      'mix',
      'cook',
      'bake',
      'rest',
      'serve',
      'prepare'
    ]);
    expect(RECIPE_STEP_VIDEO_SCENES).not.toContain('recipe-title' as never);
    expect(MAX_RECIPE_STEP_VIDEO_RANGE_BYTES).toBeGreaterThan(0);
    expect(MAX_RECIPE_STEP_VIDEO_BYTES).toBeGreaterThan(MAX_RECIPE_STEP_VIDEO_RANGE_BYTES);
  });

  it('sends a fixed generic Commons query and returns attributed, bounded video metadata', async () => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });

    const [video] = await provider.search('cut');

    expect(video).toMatchObject({
      title: 'Chop.webm',
      author: 'Ana Cocina',
      licenseName: 'CC BY 4.0',
      licenseUrl: LICENSE_URL,
      sourceUrl: SOURCE_URL,
      thumbnailUrl: THUMB_URL,
      durationSeconds: 22,
      mimeType: 'video/webm'
    });
    expect(video?.id).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.stringify(video)).not.toContain(VIDEO_URL);

    const searchUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(searchUrl.hostname).toBe('commons.wikimedia.org');
    expect(searchUrl.searchParams.get('srsearch')).toBe(
      'chopping vegetables cutting board filetype:video'
    );
    expect(searchUrl.searchParams.get('srnamespace')).toBe('6');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Api-User-Agent': expect.stringContaining('https://github.com/juanjoGonDev/HogarIA'),
      'User-Agent': expect.stringContaining('https://github.com/juanjoGonDev/HogarIA')
    });
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('rejects runtime scenes outside the enum without contacting Commons', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createRecipeStepVideoProvider({ fetcher });

    await expect(provider.search('recipe name' as never)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['missing identifying author', { extmetadata: { Artist: { value: 'Unknown' } } }],
    [
      'unsafe license URL',
      { extmetadata: { LicenseUrl: { value: 'https://attacker.test/license' } } }
    ],
    [
      'unsafe media URL',
      { derivatives: [{ src: 'https://127.0.0.1/evil.webm', type: 'video/webm' }] }
    ],
    ['unsupported MIME', { derivatives: [{ src: VIDEO_URL, type: 'application/octet-stream' }] }]
  ])('omits candidates with %s', async (_caseName, override) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(detailsResponse(override as Record<string, unknown>))
      .mockResolvedValueOnce(fileResponse());
    const provider = createRecipeStepVideoProvider({ fetcher });

    expect(await provider.search('cut')).toEqual([]);
  });

  it.each([
    ['unknown length', { duration: null, size: 680000 }],
    ['long clip', { duration: 61, size: 680000 }],
    ['zero length', { duration: 0, size: 680000 }],
    ['oversized file', { duration: 22, size: 31 * 1024 * 1024 }],
    ['unknown size', { duration: 22, size: null }]
  ])('omits candidates with %s', async (_caseName, preferred) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(searchResponse())
      .mockResolvedValueOnce(detailsResponse())
      .mockResolvedValueOnce(
        fileResponse({ preferred: { ...preferred, mediatype: 'VIDEO', url: VIDEO_URL } })
      );
    const provider = createRecipeStepVideoProvider({ fetcher });

    expect(await provider.search('cut')).toEqual([]);
  });

  it('returns empty results for no search hits and never calls metadata APIs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(searchResponse([]));
    const provider = createRecipeStepVideoProvider({ fetcher });

    expect(await provider.search('serve')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('normalizes Commons HTTP %s into a provider error', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({}, status));
    const provider = createRecipeStepVideoProvider({ fetcher });

    await expect(provider.search('cook')).rejects.toThrow();
  });

  it('times out upstream metadata requests and aborts the provider fetch', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()));
      });
    });
    const provider = createRecipeStepVideoProvider({ fetcher, timeoutMs: 25 });
    const pending = provider.search('mix');
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(26);

    await rejection;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('propagates caller cancellation to an in-flight Commons metadata request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()));
      });
    });
    const provider = createRecipeStepVideoProvider({ fetcher });
    const abort = new AbortController();
    const pending = provider.search('cut', abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();

    await rejection;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('validates identifiers and streams only a bounded requested range without buffering', async () => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });
    const [video] = await provider.search('cut');
    let sourcePulls = 0;
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          sourcePulls += 1;
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    fetcher.mockResolvedValueOnce(
      new Response(source, {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-length': '4',
          'content-range': 'bytes 0-3/680000'
        }
      })
    );

    expect(provider.getVideo('invalid')).toBeNull();
    const opened = await provider.openStream(video!.id, { start: 0, end: 3 });

    expect(opened).not.toBeNull();
    expect(opened!.body).toBeInstanceOf(ReadableStream);
    expect(sourcePulls).toBe(0);
    expect(fetcher.mock.calls[3]?.[1]?.headers).toMatchObject({ Range: 'bytes=0-3' });
    expect(fetcher.mock.calls[3]?.[1]?.redirect).toBe('error');
    expect(Array.from(new Uint8Array(await new Response(opened!.body).arrayBuffer()))).toEqual([
      1, 2, 3, 4
    ]);
    expect(sourcePulls).toBe(1);
  });

  it('streams a persisted validated selection after provider-cache loss/restart', async () => {
    const discoveryFetcher = validSearchFetcher();
    const discoveryProvider = createRecipeStepVideoProvider({ fetcher: discoveryFetcher });
    const [candidate] = await discoveryProvider.search('cut');
    const persisted = discoveryProvider.getSelectedVideo(candidate!.id);
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(new Uint8Array([7, 8, 9]));
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    const playbackFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-length': '3',
          'content-range': 'bytes 12-14/680000'
        }
      })
    );
    const restartedProvider = createRecipeStepVideoProvider({ fetcher: playbackFetcher });

    expect(persisted).toMatchObject({ id: candidate!.id, mediaUrl: VIDEO_URL, sizeBytes: 680000 });
    const opened = await restartedProvider.openStoredStream(persisted!, { start: 12, end: 14 });

    expect(opened?.contentRange).toBe('bytes 12-14/680000');
    expect(playbackFetcher).toHaveBeenCalledWith(
      VIDEO_URL,
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ Range: 'bytes=12-14' })
      })
    );
    expect(Array.from(new Uint8Array(await new Response(opened!.body).arrayBuffer()))).toEqual([
      7, 8, 9
    ]);
  });

  it('aborts upstream body when the downstream stream is cancelled', async () => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });
    const [video] = await provider.search('cut');
    let upstreamCancelled = false;
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            upstreamCancelled = true;
          }
        }),
        {
          status: 206,
          headers: {
            'content-type': 'video/webm',
            'content-range': 'bytes 0-3/680000',
            'content-length': '4'
          }
        }
      )
    );
    const opened = await provider.openStream(video!.id, { start: 0, end: 3 });

    await opened!.body.cancel('step changed');

    expect(upstreamCancelled).toBe(true);
  });

  it('rejects full or malformed upstream responses rather than proxying them', async () => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });
    const [video] = await provider.search('cut');
    fetcher.mockResolvedValueOnce(
      new Response('unexpected full response', {
        status: 200,
        headers: { 'content-type': 'video/webm' }
      })
    );

    await expect(provider.openStream(video!.id, { start: 0, end: 3 })).rejects.toThrow();
    expect(await provider.openStream('0'.repeat(24), { start: 0, end: 3 })).toBeNull();
  });

  it.each([
    [
      'wrong MIME',
      {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-3/680000',
          'content-length': '4'
        }
      }
    ],
    [
      'wrong total size',
      {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-range': 'bytes 0-3/680001',
          'content-length': '4'
        }
      }
    ],
    [
      'wrong range start',
      {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-range': 'bytes 1-4/680000',
          'content-length': '4'
        }
      }
    ],
    [
      'compressed range',
      {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-range': 'bytes 0-3/680000',
          'content-length': '4',
          'content-encoding': 'gzip'
        }
      }
    ],
    [
      'too many range bytes',
      {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-range': 'bytes 0-3/680000',
          'content-length': '5'
        }
      }
    ]
  ])('rejects an upstream %s response', async (_caseName, init) => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });
    const [video] = await provider.search('cut');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), init));

    await expect(provider.openStream(video!.id, { start: 0, end: 3 })).rejects.toThrow();
  });

  it('limits active streams and releases the slot when a consumer cancels', async () => {
    const fetcher = validSearchFetcher();
    const provider = createRecipeStepVideoProvider({ fetcher });
    const [video] = await provider.search('cut');
    const makeRangeResponse = () =>
      new Response(new ReadableStream<Uint8Array>({ cancel() {} }, { highWaterMark: 0 }), {
        status: 206,
        headers: {
          'content-type': 'video/webm',
          'content-range': 'bytes 0-3/680000',
          'content-length': '4'
        }
      });
    fetcher.mockImplementation(async (input, _init) => {
      if (String(input) === VIDEO_URL) return makeRangeResponse();
      throw new Error('unexpected request');
    });

    const streams = await Promise.all(
      Array.from({ length: 3 }, () => provider.openStream(video!.id, { start: 0, end: 3 }))
    );
    await expect(provider.openStream(video!.id, { start: 0, end: 3 })).rejects.toThrow();
    await streams[0]!.body.cancel('step changed');
    const reopened = await provider.openStream(video!.id, { start: 0, end: 3 });
    expect(reopened).not.toBeNull();
    await Promise.all(streams.slice(1).map((stream) => stream!.body.cancel('test cleanup')));
    await reopened!.body.cancel('test cleanup');
  });
});
