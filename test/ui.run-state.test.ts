import type { ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { ScenarioExecutionResult } from '../src/executor/scenario.executor.js';
import {
  appendUiRunChunk,
  appendUiRunTestResult,
  createUiRunRecord,
  createUiRunTestResult,
  finishUiRun,
  requestUiRunInput,
  streamUiRunEvents,
  submitUiRunInput,
} from '../src/cli/ui/run-state.js';

describe('UI run state', () => {
  it('SSE id 이후 이벤트만 재생한다', () => {
    const run = createUiRunRecord({ id: '1', command: 'validate', scenario: 'smoke' });
    appendUiRunChunk(run, 'stdout', 'first\n');
    appendUiRunChunk(run, 'stderr', 'second\n');
    finishUiRun(run, 'passed', 0);

    const initial = createResponse();
    streamUiRunEvents(run, initial.response);
    expect(parseEvents(initial.text())).toEqual([
      expect.objectContaining({ id: 1, name: 'chunk', data: expect.objectContaining({ chunk: 'first\n' }) }),
      expect.objectContaining({ id: 2, name: 'chunk', data: expect.objectContaining({ chunk: 'second\n' }) }),
      { id: 3, name: 'done', data: { status: 'passed', exitCode: 0 } },
    ]);

    const resumed = createResponse();
    streamUiRunEvents(run, resumed.response, '1');
    expect(parseEvents(resumed.text())).toEqual([
      expect.objectContaining({ id: 2, name: 'chunk', data: expect.objectContaining({ chunk: 'second\n' }) }),
      { id: 3, name: 'done', data: { status: 'passed', exitCode: 0 } },
    ]);
  });

  it('첫 접속 snapshot도 원래 event id 순서를 유지한다', () => {
    const run = createUiRunRecord({ id: 'failure', command: 'test', scenario: 'smoke' });
    appendUiRunChunk(run, 'stdout', 'started\n');
    appendUiRunTestResult(run, {
      scenario: 'smoke',
      status: 'failed',
      durationMs: 1,
      steps: [],
    });
    appendUiRunChunk(run, 'stderr', 'failed\n');
    finishUiRun(run, 'failed', 1);

    const response = createResponse();
    streamUiRunEvents(run, response.response);
    expect(parseEvents(response.text()).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: 'chunk' },
      { id: 2, name: 'test-result' },
      { id: 3, name: 'chunk' },
      { id: 4, name: 'done' },
    ]);
  });

  it('pending input은 첫 접속에만 snapshot으로 재생하고 제출 이벤트는 id로 이어받는다', async () => {
    const run = createUiRunRecord({ id: '2', command: 'test', scenario: 'manual' });
    const input = requestUiRunInput(run, {
      scenario: 'manual',
      index: 0,
      totalSteps: 1,
      id: 'enter-code',
      name: 'code',
      required: true,
      secretValues: [],
    });
    const pending = createResponse();
    streamUiRunEvents(run, pending.response);
    expect(parseEvents(pending.text())).toEqual([
      expect.objectContaining({ id: 1, name: 'input-request' }),
    ]);

    submitUiRunInput(run, { name: 'code', value: '123456' });
    await expect(input).resolves.toBe('123456');
    finishUiRun(run, 'passed', 0);

    const fresh = createResponse();
    streamUiRunEvents(run, fresh.response);
    expect(parseEvents(fresh.text())).toEqual([
      { id: 3, name: 'done', data: { status: 'passed', exitCode: 0 } },
    ]);

    const resumed = createResponse();
    streamUiRunEvents(run, resumed.response, '1');
    expect(parseEvents(resumed.text())).toEqual([
      { id: 2, name: 'input-submitted', data: { runId: '2', id: 'enter-code', name: 'code' } },
      { id: 3, name: 'done', data: { status: 'passed', exitCode: 0 } },
    ]);
  });

  it('구조화 실행 결과를 서버 저장 전에 마스킹한다', () => {
    const result = {
      scenario: 'secret-run',
      baseUrl: 'https://api.test.local',
      durationMs: 12,
      passed: false,
      secretValues: ['known-secret', 'a/b'],
      steps: [{
        index: 0,
        id: 'login',
        method: 'POST',
        path: '/login/known-secret',
        url: 'https://api.test.local/callback/a%2Fb?api-key=query-value&safe=a%2Fb#access_token=fragment-value&safe=a%2Fb',
        durationMs: 10,
        passed: false,
        request: {
          headers: {
            Authorization: 'Bearer header-value',
            'X-Trace': 'known-secret',
          },
          body: JSON.stringify({
            password: 'body-password',
            profile: { accessToken: 'body-token', note: 'known-secret' },
          }),
        },
        response: {
          status: 401,
          statusText: 'known-secret',
          headers: {
            'set-cookie': 'session=cookie-value',
            'x-trace': 'known-secret',
          },
          body: JSON.stringify({ token: 'response-token', message: 'known-secret' }),
        },
        condition: {
          expression: 'headers["authorization"] == "Bearer condition-token" && note == "known-secret"',
          passed: false,
        },
        extracts: [{
          name: 'session',
          path: '$.token',
          passed: false,
          error: 'secret=extract-value known-secret',
        }],
        error: 'response {"secret":"error-secret"} known-secret',
      }],
    } satisfies ScenarioExecutionResult;

    const masked = createUiRunTestResult(result, [{ kind: 'direct' }], { includeValues: true });
    const step = masked.steps[0];

    expect(step.path).toBe('/login/***');
    expect(step.url).toBe('https://api.test.local/callback/***?api-key=***&safe=***#access_token=***&safe=***');
    expect(step.request?.headers).toEqual({ Authorization: '***', 'X-Trace': '***' });
    expect(JSON.parse(step.request?.body ?? '{}')).toEqual({
      password: '***',
      profile: { accessToken: '***', note: '***' },
    });
    expect(step.response).toMatchObject({
      statusText: '***',
      headers: { 'set-cookie': '***', 'x-trace': '***' },
    });
    expect(JSON.parse(step.response?.body ?? '{}')).toEqual({ token: '***', message: '***' });
    expect(step.condition?.expression).toBe('headers["authorization"] == *** && note == "***"');
    expect(step.extracts[0]?.error).toBe('secret=***');
    expect(step.error).toBe('response {"secret":"***"} ***');
    expect(JSON.stringify(masked)).not.toContain('known-secret');
    expect(JSON.stringify(masked)).not.toContain('body-password');
    expect(JSON.stringify(masked)).not.toContain('response-token');
  });

  it('console chunk도 민감 JSON 값을 저장하지 않는다', () => {
    const run = createUiRunRecord({ id: 'secret-log', command: 'test', scenario: 'smoke' });
    appendUiRunChunk(run, 'stderr', 'response {"token":"literal-token"}\n');

    expect(run.chunks[0]?.chunk).toBe('response {"token":"***"}\n');
    expect(JSON.stringify(run.events)).not.toContain('literal-token');
  });
});

function createResponse(): { response: ServerResponse; text(): string } {
  const chunks: string[] = [];
  const response = {
    writeHead() {},
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {},
    on() {
      return response;
    },
  } as unknown as ServerResponse;

  return { response, text: () => chunks.join('') };
}

function parseEvents(value: string): Array<{ id: number; name: string; data: unknown }> {
  return value.trim().split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    return {
      id: Number(lines.find((line) => line.startsWith('id: '))?.slice(4)),
      name: lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '',
      data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? 'null') as unknown,
    };
  });
}
