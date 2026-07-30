import type {
  UiRunChunk,
  UiRunInputRequest,
  UiRunStatus,
  UiRunTestResult,
} from '../run-state.js';

export type ScenarioRunCommand = 'validate' | 'test';
export type ScenarioRunStatus = 'starting' | UiRunStatus;
export type ScenarioRunConnection = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface ScenarioRun {
  scenario: string;
  command: ScenarioRunCommand;
  runId?: string;
  status: ScenarioRunStatus;
  connection: ScenarioRunConnection;
  chunks: UiRunChunk[];
  testResult?: UiRunTestResult;
  pendingInput?: UiRunInputRequest;
  error?: string;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

interface ScenarioRunSlots {
  validate?: ScenarioRun;
  test?: ScenarioRun;
}

export type ScenarioRuns = ReadonlyMap<string, Readonly<ScenarioRunSlots>>;

interface ScenarioRunTarget {
  scenario: string;
  command: ScenarioRunCommand;
}

interface ActiveScenarioRunTarget extends ScenarioRunTarget {
  runId: string;
}

export type ScenarioRunsAction =
  | (ScenarioRunTarget & { type: 'requested'; at: string })
  | (ActiveScenarioRunTarget & { type: 'started'; at: string })
  | (ScenarioRunTarget & { type: 'start-failed'; error: string; at: string })
  | (ActiveScenarioRunTarget & { type: 'connected' })
  | (ActiveScenarioRunTarget & { type: 'reconnecting'; error?: string })
  | (ActiveScenarioRunTarget & { type: 'chunk'; chunk: UiRunChunk })
  | (ActiveScenarioRunTarget & { type: 'test-result'; result: UiRunTestResult })
  | (ActiveScenarioRunTarget & { type: 'input-request'; request: UiRunInputRequest })
  | (ActiveScenarioRunTarget & { type: 'input-submitted' })
  | (ActiveScenarioRunTarget & {
      type: 'done';
      status: Exclude<UiRunStatus, 'running'>;
      exitCode: number;
      error?: string;
      at: string;
    });

export function selectScenarioRun(
  state: ScenarioRuns,
  scenario: string,
  command: ScenarioRunCommand,
): ScenarioRun | undefined {
  return state.get(scenario)?.[command];
}

export function reduceScenarioRuns(state: ScenarioRuns, action: ScenarioRunsAction): ScenarioRuns {
  switch (action.type) {
    case 'requested':
      return setScenarioRun(state, action, {
        scenario: action.scenario,
        command: action.command,
        status: 'starting',
        connection: 'connecting',
        chunks: [],
        requestedAt: action.at,
      });
    case 'started': {
      const current = selectScenarioRun(state, action.scenario, action.command);
      return setScenarioRun(state, action, {
        scenario: action.scenario,
        command: action.command,
        runId: action.runId,
        status: 'running',
        connection: 'connecting',
        chunks: [],
        requestedAt: current?.requestedAt ?? action.at,
        startedAt: action.at,
      });
    }
    case 'start-failed': {
      const current = selectScenarioRun(state, action.scenario, action.command);
      return setScenarioRun(state, action, {
        scenario: action.scenario,
        command: action.command,
        status: 'failed',
        connection: 'closed',
        chunks: [],
        error: action.error,
        requestedAt: current?.requestedAt ?? action.at,
        finishedAt: action.at,
      });
    }
    case 'connected':
      return updateActiveRun(state, action, (run) => ({
        ...run,
        connection: 'connected',
        error: undefined,
      }));
    case 'reconnecting':
      return updateActiveRun(state, action, (run) => ({
        ...run,
        connection: 'reconnecting',
        ...(action.error === undefined ? {} : { error: action.error }),
      }));
    case 'chunk':
      return updateActiveRun(state, action, (run) => ({
        ...run,
        chunks: [...run.chunks, action.chunk],
      }));
    case 'test-result':
      return updateActiveRun(state, action, (run) => ({ ...run, testResult: action.result }));
    case 'input-request':
      return updateActiveRun(state, action, (run) => ({ ...run, pendingInput: action.request }));
    case 'input-submitted':
      return updateActiveRun(state, action, (run) => ({ ...run, pendingInput: undefined }));
    case 'done':
      return updateActiveRun(state, action, (run) => ({
        ...run,
        status: action.status,
        connection: 'closed',
        pendingInput: undefined,
        exitCode: action.exitCode,
        finishedAt: action.at,
        ...(action.error === undefined ? {} : { error: action.error }),
      }));
  }
}

function updateActiveRun(
  state: ScenarioRuns,
  target: ActiveScenarioRunTarget,
  update: (run: ScenarioRun) => ScenarioRun,
): ScenarioRuns {
  const run = selectScenarioRun(state, target.scenario, target.command);
  return run?.runId === target.runId ? setScenarioRun(state, target, update(run)) : state;
}

function setScenarioRun(
  state: ScenarioRuns,
  target: ScenarioRunTarget,
  run: ScenarioRun,
): ScenarioRuns {
  const next = new Map(state);
  next.set(target.scenario, {
    ...state.get(target.scenario),
    [target.command]: run,
  });
  return next;
}
