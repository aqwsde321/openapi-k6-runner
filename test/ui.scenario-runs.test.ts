import { describe, expect, it } from 'vitest';

import type { UiRunTestResult } from '../src/cli/ui/run-state.js';
import {
  reduceScenarioRuns,
  selectScenarioRun,
  type ScenarioRuns,
  type ScenarioRunsAction,
} from '../src/cli/ui/app/scenario-runs.js';

describe('React UI scenario runs', () => {
  it('scenario별 validate와 test 최신 실행을 분리한다', () => {
    const state = reduce([
      { type: 'requested', scenario: 'smoke', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', scenario: 'smoke', command: 'validate', runId: 'validate-1', at: '2026-07-30T00:00:01.000Z' },
      { type: 'done', scenario: 'smoke', command: 'validate', runId: 'validate-1', status: 'passed', exitCode: 0, at: '2026-07-30T00:00:02.000Z' },
      { type: 'requested', scenario: 'smoke', command: 'test', at: '2026-07-30T00:00:03.000Z' },
      { type: 'started', scenario: 'smoke', command: 'test', runId: 'test-1', at: '2026-07-30T00:00:04.000Z' },
    ]);

    expect(selectScenarioRun(state, 'smoke', 'validate')).toMatchObject({
      runId: 'validate-1',
      status: 'passed',
      connection: 'closed',
      requestedAt: '2026-07-30T00:00:00.000Z',
      startedAt: '2026-07-30T00:00:01.000Z',
      finishedAt: '2026-07-30T00:00:02.000Z',
      exitCode: 0,
    });
    expect(selectScenarioRun(state, 'smoke', 'test')).toMatchObject({
      runId: 'test-1',
      status: 'running',
      connection: 'connecting',
      requestedAt: '2026-07-30T00:00:03.000Z',
      startedAt: '2026-07-30T00:00:04.000Z',
    });
  });

  it('같은 명령의 이전 run 이벤트를 무시한다', () => {
    const state = reduce([
      { type: 'requested', scenario: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', scenario: 'smoke', command: 'test', runId: 'old', at: '2026-07-30T00:00:01.000Z' },
      { type: 'requested', scenario: 'smoke', command: 'test', at: '2026-07-30T00:00:02.000Z' },
      { type: 'started', scenario: 'smoke', command: 'test', runId: 'current', at: '2026-07-30T00:00:03.000Z' },
    ]);
    const staleChunkState = reduceScenarioRuns(state, {
      type: 'chunk',
      scenario: 'smoke',
      command: 'test',
      runId: 'old',
      chunk: { stream: 'stdout', chunk: 'stale', html: 'stale' },
    });
    const staleDoneState = reduceScenarioRuns(staleChunkState, {
      type: 'done',
      scenario: 'smoke',
      command: 'test',
      runId: 'old',
      status: 'failed',
      exitCode: 1,
      at: '2026-07-30T00:00:04.000Z',
    });

    expect(staleChunkState).toBe(state);
    expect(staleDoneState).toBe(state);
    expect(selectScenarioRun(state, 'smoke', 'test')).toMatchObject({
      runId: 'current',
      status: 'running',
      chunks: [],
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
      { type: 'requested', scenario: 'smoke', command: 'test', at: '2026-07-30T00:00:00.000Z' },
      { type: 'started', scenario: 'smoke', command: 'test', runId: 'test-1', at: '2026-07-30T00:00:01.000Z' },
      { type: 'connected', scenario: 'smoke', command: 'test', runId: 'test-1' },
      { type: 'test-result', scenario: 'smoke', command: 'test', runId: 'test-1', result },
      { type: 'done', scenario: 'smoke', command: 'test', runId: 'test-1', status: 'failed', exitCode: 1, at: '2026-07-30T00:00:02.000Z' },
    ]);

    const run = selectScenarioRun(state, 'smoke', 'test');
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

  it('명령 시작 실패를 실행 실패로 기록한다', () => {
    const state = reduce([
      { type: 'requested', scenario: 'missing', command: 'validate', at: '2026-07-30T00:00:00.000Z' },
      { type: 'start-failed', scenario: 'missing', command: 'validate', error: 'scenario not found', at: '2026-07-30T00:00:01.000Z' },
    ]);

    expect(selectScenarioRun(state, 'missing', 'validate')).toMatchObject({
      status: 'failed',
      connection: 'closed',
      chunks: [],
      error: 'scenario not found',
      requestedAt: '2026-07-30T00:00:00.000Z',
      finishedAt: '2026-07-30T00:00:01.000Z',
    });
  });
});

function reduce(actions: ScenarioRunsAction[]): ScenarioRuns {
  return actions.reduce(reduceScenarioRuns, new Map());
}
