import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeUiServer, UiConnectionError } from '../src/cli/ui/app/api.js';

describe('React UI API connection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetch 연결 실패만 UI 연결 오류로 분류한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(probeUiServer()).rejects.toBeInstanceOf(UiConnectionError);
  });

  it('HTTP 오류와 abort는 UI 연결 끊김으로 분류하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'invalid config' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )));
    await expect(probeUiServer()).rejects.toMatchObject({
      message: 'invalid config',
      name: 'Error',
    });

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));
    await expect(probeUiServer()).rejects.toBe(aborted);
  });
});
