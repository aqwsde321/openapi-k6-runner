import { afterEach, describe, expect, it, vi } from 'vitest';

import { startUiConnectionPolling } from '../src/cli/ui/app/ui-connection.js';

describe('React UI connection polling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('연결 실패 뒤 첫 성공에서 한 번만 복구를 알린다', async () => {
    vi.useFakeTimers();
    let disconnected = false;
    let shouldFail = true;
    const probe = vi.fn(async () => {
      if (shouldFail) throw new Error('offline');
    });
    const onDisconnected = vi.fn(() => {
      disconnected = true;
    });
    const onRecovered = vi.fn(() => {
      disconnected = false;
    });
    const stop = startUiConnectionPolling({
      probe,
      isDisconnected: () => disconnected,
      onDisconnected,
      onRecovered,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onDisconnected).toHaveBeenCalledTimes(1);

    shouldFail = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(4);

    stop();
  });

  it('중단할 때 진행 중인 probe를 abort하고 이후 상태를 바꾸지 않는다', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const probe = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        resolve();
      });
    }));
    const onDisconnected = vi.fn();
    const onRecovered = vi.fn();
    const stop = startUiConnectionPolling({
      probe,
      isDisconnected: () => true,
      onDisconnected,
      onRecovered,
    });

    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    stop();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(aborted).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
