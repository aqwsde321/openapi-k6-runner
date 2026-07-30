import { describe, expect, it } from 'vitest';

import type { UiRunTestResult, UiSuiteRunResult } from '../src/cli/ui/run-state.js';
import {
  reduceUiRuns,
  selectLatestSuiteReportRun,
  selectLatestUiRun,
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
      log: '',
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
      log: 'before\nafter\n',
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

  it('탐색 행에는 validate와 test 중 마지막 실행 상태를 선택한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'requested', kind: 'scenario', id: 'smoke', command: 'validate', at: '2026-07-30T00:00:01.000Z' },
    ]);

    expect(selectLatestUiRun(state, { kind: 'scenario', id: 'smoke' })?.command).toBe('validate');
  });

  it('선택과 무관하게 마지막 스위트 리포트 실행을 찾는다', () => {
    const state = reduce([
      { type: 'requested', kind: 'suite', id: 'first', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'suite', id: 'first', command: 'test', runId: 'first-run', at: '2026-07-30T00:00:01.000Z' },
      {
        type: 'suite-result',
        kind: 'suite',
        id: 'first',
        command: 'test',
        runId: 'first-run',
        result: suiteResult('first.json'),
      },
      { type: 'requested', kind: 'suite', id: 'second', command: 'test', at: '2026-07-30T00:00:02.000Z' },
      { type: 'started', kind: 'suite', id: 'second', command: 'test', runId: 'second-run', at: '2026-07-30T00:00:03.000Z' },
      {
        type: 'suite-result',
        kind: 'suite',
        id: 'second',
        command: 'test',
        runId: 'second-run',
        result: suiteResult('second.json'),
      },
    ]);

    expect(selectLatestSuiteReportRun(state)?.suiteResult?.reportPath).toBe('second.json');
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

  it('재시작으로 유실된 실행을 종료해 재실행 가능 상태로 만든다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'hold', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'hold', command: 'test', runId: 'lost', at: '2026-07-30T00:00:01.000Z' },
      { type: 'reconnecting', kind: 'scenario', id: 'hold', command: 'test', runId: 'lost' },
      {
        type: 'done',
        kind: 'scenario',
        id: 'hold',
        command: 'test',
        runId: 'lost',
        status: 'failed',
        exitCode: 1,
        error: 'run was lost',
        at: '2026-07-30T00:00:02.000Z',
      },
    ]);

    expect(selectUiRun(state, { kind: 'scenario', id: 'hold' }, 'test')).toMatchObject({
      status: 'failed',
      connection: 'closed',
      error: 'run was lost',
      exitCode: 1,
    });
  });

  it('큰 실행 로그는 최신 10만 자만 유지한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'large', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', kind: 'scenario', id: 'large', command: 'test', runId: 'large-run', at: '2026-07-30T00:00:01.000Z' },
      {
        type: 'chunk',
        kind: 'scenario',
        id: 'large',
        command: 'test',
        runId: 'large-run',
        chunk: { stream: 'stdout', chunk: 'x'.repeat(120_000), html: '' },
      },
    ]);

    const log = selectUiRun(state, { kind: 'scenario', id: 'large' }, 'test')?.log;
    expect(log).toHaveLength(100_000);
    expect(log).toMatch(/^\[이전 실행 로그 생략\]\n+x+$/);
  });

  it('명령 시작 실패를 실행 실패로 기록한다', () => {
    const state = reduce([
      { type: 'requested', kind: 'scenario', id: 'missing', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'start-failed', kind: 'scenario', id: 'missing', command: 'validate', error: 'scenario not found', at: '2026-07-30T00:00:01.000Z' },
    ]);

    expect(selectUiRun(state, { kind: 'scenario', id: 'missing' }, 'validate')).toMatchObject({
      status: 'failed',
      connection: 'closed',
      log: '',
      error: 'scenario not found',
      requestedAt: '2026-07-30T00:00:00.000Z',
      finishedAt: '2026-07-30T00:00:01.000Z',
    });
  });
});

function reduce(actions: UiRunsAction[]): UiRuns {
  return actions.reduce(reduceUiRuns, new Map());
}

function suiteResult(reportPath: string): UiSuiteRunResult {
  return {
    suite: 'suite',
    status: 'passed',
    durationMs: 1,
    reportPath,
    scenarios: [],
  };
}
