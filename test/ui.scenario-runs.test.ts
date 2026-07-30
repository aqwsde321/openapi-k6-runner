import { describe, expect, it } from 'vitest';

import type { UiRunTestResult, UiSuiteRunResult } from '../src/cli/ui/run-state.js';
import {
  reduceUiRuns,
  selectUiRun,
  type UiRuns,
  type UiRunsAction,
} from '../src/cli/ui/app/scenario-runs.js';

describe('React UI scenario runs', () => {
  it('scenario별 validate와 test 최신 실행을 분리한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'validate', runId: 'validate-1', at: '2026-07-30T00:00:01.000Z' },
      { type: 'done', kind: 'scenario', id: 'smoke', command: 'validate', runId: 'validate-1', status: 'passed', exitCode: 0, at: '2026-07-30T00:00:02.000Z' },
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:03.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', at: '2026-07-30T00:00:04.000Z' },
    ]);

    expect(selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'validate')).toMatchObject({
      runId: 'validate-1',
      status: 'passed',
      connection: 'closed',
      requestedAt: '2026-07-30T00:00:00.000Z',
      startedAt: '2026-07-30T00:00:01.000Z',
      finishedAt: '2026-07-30T00:00:02.000Z',
      exitCode: 0,
    });
    expect(selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'test')).toMatchObject({
      runId: 'test-1',
      status: 'running',
      connection: 'connecting',
      requestedAt: '2026-07-30T00:00:03.000Z',
      startedAt: '2026-07-30T00:00:04.000Z',
    });
  });

  it('같은 명령의 이전 run 이벤트를 무시한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'test', runId: 'old', at: '2026-07-30T00:00:01.000Z' },
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:02.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'test', runId: 'current', at: '2026-07-30T00:00:03.000Z' },
    ]);
    const staleChunkState = reduceUiRuns(state, {
      type: 'chunk',
      kind: 'scenario',
      id: 'smoke',
      command: 'test',
      runId: 'old',
      chunk: { stream: 'stdout', chunk: 'stale', html: 'stale' },
    });
    const staleDoneState = reduceUiRuns(staleChunkState, {
      type: 'done',
      kind: 'scenario',
      id: 'smoke',
      command: 'test',
      runId: 'old',
      status: 'failed',
      exitCode: 1,
      at: '2026-07-30T00:00:04.000Z',
    });

    expect(staleChunkState).toBe(state);
    expect(staleDoneState).toBe(state);
    expect(selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'test')).toMatchObject({
      runId: 'current',
      status: 'running',
      chunks: [],
    });
  });

  it('SSE 재연결 뒤 Last-Event-ID 이후 로그를 이어 붙인다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', at: '2026-07-30T00:00:01.000Z' },
      { type: 'connected', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1' },
      { type: 'chunk', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', chunk: { stream: 'stdout', chunk: 'before\n', html: 'before\n' } },
      { type: 'reconnecting', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', error: 'disconnected' },
      { type: 'connected', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1' },
      { type: 'chunk', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', chunk: { stream: 'stdout', chunk: 'after\n', html: 'after\n' } },
    ]);

    expect(selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'test')).toMatchObject({
      connection: 'connected',
      chunks: [
        expect.objectContaining({ chunk: 'before\n' }),
        expect.objectContaining({ chunk: 'after\n' }),
      ],
      error: undefined,
    });
  });

  it('첫 실패에서 끝난 test 결과를 그대로 보존한다', () => {
    const result: UiRunTestResult = {
      scenario: 'smoke',
      status: 'failed',
      durationMs: 12,
      steps: [{
        index: 0,
        id: 'first',
        status: 'failed',
        durationMs: 8,
        source: { kind: 'direct' },
        method: 'GET',
        path: '/first',
        responseStatus: 500,
        condition: { expression: 'status == 200', passed: false },
        extracts: [],
      }],
    };
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', at: '2026-07-30T00:00:01.000Z' },
      { type: 'connected', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1' },
      { type: 'test-result', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', result },
      { type: 'done', kind: 'scenario', id: 'smoke', command: 'test', runId: 'test-1', status: 'failed', exitCode: 1, at: '2026-07-30T00:00:02.000Z' },
    ]);

    const run = selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'test');
    expect(run?.testResult).toBe(result);
    expect(run?.testResult?.steps).toHaveLength(1);
    expect(run?.testResult?.steps[0]).toMatchObject({
      id: 'first',
      status: 'failed',
      responseStatus: 500,
      condition: { expression: 'status == 200', passed: false },
    });
    expect(run).toMatchObject({ status: 'failed', connection: 'closed', exitCode: 1 });
  });

  it('suite validate와 test를 분리하고 실패 뒤 성공한 scenario까지 보존한다', () => {
    const result: UiSuiteRunResult = {
      suite: 'smoke suite',
      status: 'failed',
      durationMs: 24,
      reportPath: 'openapi-k6/reports/smoke.json',
      scenarios: [
        {
          scenarioKey: 'auth/login',
          scenarioName: 'login',
          status: 'failed',
          durationMs: 10,
          passedSteps: 0,
          totalSteps: 1,
          method: 'POST',
          path: '/login',
          failedStep: { id: 'login', responseStatus: 401, condition: 'status == 200' },
        },
        {
          scenarioKey: 'health',
          status: 'passed',
          durationMs: 14,
          passedSteps: 1,
          totalSteps: 1,
          method: 'GET',
          path: '/health',
        },
      ],
    };
    const state = reduce([
      { type: 'requested', kind: 'suite', id: 'smoke', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'suite', id: 'smoke', command: 'validate', runId: 'validate-suite', at: '2026-07-30T00:00:01.000Z' },
      { type: 'done', kind: 'suite', id: 'smoke', command: 'validate', runId: 'validate-suite', status: 'passed', exitCode: 0, at: '2026-07-30T00:00:02.000Z' },
      { type: 'requested', kind: 'suite', id: 'smoke', command: 'test', at: '2026-07-30T00:00:03.000Z' },
      { type: 'started', kind: 'suite', id: 'smoke', command: 'test', runId: 'test-suite', at: '2026-07-30T00:00:04.000Z' },
      { type: 'suite-result', kind: 'suite', id: 'smoke', command: 'test', runId: 'test-suite', result },
      { type: 'done', kind: 'suite', id: 'smoke', command: 'test', runId: 'test-suite', status: 'failed', exitCode: 1, at: '2026-07-30T00:00:05.000Z' },
    ]);

    expect(selectUiRun(state, { kind: 'suite', id: 'smoke' }, 'validate')).toMatchObject({
      status: 'passed',
      runId: 'validate-suite',
    });
    expect(selectUiRun(state, { kind: 'suite', id: 'smoke' }, 'test')).toMatchObject({
      status: 'failed',
      runId: 'test-suite',
      suiteResult: result,
    });
    expect(selectUiRun(state, { kind: 'scenario', id: 'smoke' }, 'test')).toBeUndefined();
  });

  it('suite 재연결 중 input 상태를 유지하고 제출 이벤트로 지운다', () => {
    const state = reduce([
      { type: 'requested', kind: 'suite', id: 'manual', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'suite', id: 'manual', command: 'test', runId: 'suite-input', at: '2026-07-30T00:00:01.000Z' },
      {
        type: 'input-request',
        kind: 'suite',
        id: 'manual',
        command: 'test',
        runId: 'suite-input',
        request: {
          runId: 'suite-input',
          index: 0,
          totalSteps: 1,
          id: 'otp',
          name: 'otp',
          required: true,
          sensitive: true,
        },
      },
      { type: 'reconnecting', kind: 'suite', id: 'manual', command: 'test', runId: 'suite-input' },
    ]);

    expect(selectUiRun(state, { kind: 'suite', id: 'manual' }, 'test')).toMatchObject({
      connection: 'reconnecting',
      pendingInput: { name: 'otp', sensitive: true },
    });

    const submitted = reduceUiRuns(state, {
      type: 'input-submitted',
      kind: 'suite',
      id: 'manual',
      command: 'test',
      runId: 'suite-input',
    });
    expect(selectUiRun(submitted, { kind: 'suite', id: 'manual' }, 'test')?.pendingInput).toBeUndefined();
  });

  it('명령 시작 실패를 실행 실패로 기록한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'missing', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'start-failed', kind: 'scenario', id: 'missing', command: 'validate', error: 'scenario not found', at: '2026-07-30T00:00:01.000Z' },
    ]);

    expect(selectUiRun(state, { kind: 'scenario', id: 'missing' }, 'validate')).toMatchObject({
      status: 'failed',
      connection: 'closed',
      chunks: [],
      error: 'scenario not found',
      requestedAt: '2026-07-30T00:00:00.000Z',
      finishedAt: '2026-07-30T00:00:01.000Z',
    });
  });
});

function reduce(actions: UiRunsAction[]): UiRuns {
  return actions.reduce(reduceUiRuns, new Map());
}
