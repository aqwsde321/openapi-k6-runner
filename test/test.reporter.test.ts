import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScenarioConsoleReporter } from '../src/cli/test.reporter.js';

function createCapture(): { stream: Writable; output: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return {
    stream,
    output: () => Buffer.concat(chunks).toString('utf8'),
  };
}

describe('scenario console reporter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates live running elapsed time until the step ends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'));

    const stdout = createCapture();
    const reporter = createScenarioConsoleReporter(stdout.stream, {
      live: true,
      liveIntervalMs: 100,
    });

    await reporter.onStepRequest?.({
      scenario: 'smoke',
      index: 0,
      totalSteps: 1,
      id: 'health',
      method: 'GET',
      path: '/health',
      url: 'https://api.test.local/health',
      secretValues: [],
    });

    expect(stdout.output()).toContain('state: → running 0.0s');

    await vi.advanceTimersByTimeAsync(250);

    expect(stdout.output()).toContain('state: → running 0.1s');
    expect(stdout.output()).toContain('state: → running 0.2s');

    await reporter.onStepEnd?.({
      scenario: 'smoke',
      index: 0,
      totalSteps: 1,
      secretValues: [],
      result: {
        index: 0,
        id: 'health',
        method: 'GET',
        path: '/health',
        url: 'https://api.test.local/health',
        durationMs: 250,
        passed: true,
        response: {
          status: 200,
          statusText: 'OK',
          body: '{"ok":true}',
        },
        condition: {
          expression: 'status == 200',
          passed: true,
        },
        extracts: [],
      },
    });

    const outputAfterEnd = stdout.output();

    await vi.advanceTimersByTimeAsync(500);

    expect(stdout.output()).toBe(outputAfterEnd);
    expect(stdout.output()).toContain('status: ✓ 200 OK  250ms');
  });
});
