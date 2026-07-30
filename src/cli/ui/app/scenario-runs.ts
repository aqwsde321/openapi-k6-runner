import type {
  UiRunChunk,
  UiRunInputRequest,
  UiRunStatus,
  UiSuiteRunResult,
  UiRunTestResult,
} from '../run-state.js';

export type UiRunTargetKind = 'scenario' | 'suite';
export type ScenarioRunCommand = 'validate' | 'test';
export type ScenarioRunStatus = 'starting' | UiRunStatus;
export type ScenarioRunConnection = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface UiRunTarget {
  kind: UiRunTargetKind;
  id: string;
}

export interface UiRun {
  target: UiRunTarget;
  command: ScenarioRunCommand;
  runId?: string;
  status: ScenarioRunStatus;
  connection: ScenarioRunConnection;
  chunks: UiRunChunk[];
  testResult?: UiRunTestResult;
  suiteResult?: UiSuiteRunResult;
  pendingInput?: UiRunInputRequest;
  error?: string;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

export type ScenarioRun = UiRun;

interface UiRunSlots {
  validate?: UiRun;
  test?: UiRun;
}

export type UiRuns = ReadonlyMap<string, Readonly<UiRunSlots>>;
export type ScenarioRuns = UiRuns;

interface UiRunCommandTarget extends UiRunTarget {
  command: ScenarioRunCommand;
}

interface ActiveUiRunTarget extends UiRunCommandTarget {
  runId: string;
}

export type UiRunsAction =
  | (UiRunCommandTarget & { type: 'requested'; at: string })
  | (ActiveUiRunTarget & { type: 'started'; at: string })
  | (UiRunCommandTarget & { type: 'start-failed'; error: string; at: string })
  | (ActiveUiRunTarget & { type: 'connected' })
  | (ActiveUiRunTarget & { type: 'reconnecting'; error?: string })
  | (ActiveUiRunTarget & { type: 'chunk'; chunk: UiRunChunk })
  | (ActiveUiRunTarget & { type: 'test-result'; result: UiRunTestResult })
  | (ActiveUiRunTarget & { type: 'suite-result'; result: UiSuiteRunResult })
  | (ActiveUiRunTarget & { type: 'input-request'; request: UiRunInputRequest })
  | (ActiveUiRunTarget & { type: 'input-submitted' })
  | (ActiveUiRunTarget & {
      type: 'done';
      status: Exclude<UiRunStatus, 'running'>;
      exitCode: number;
      error?: string;
      at: string;
    });
export type ScenarioRunsAction = UiRunsAction;

export function selectUiRun(
  state: UiRuns,
  target: UiRunTarget,
  command: ScenarioRunCommand,
): UiRun | undefined {
  return state.get(formatTargetKey(target))?.[command];
}

export function selectScenarioRun(
  state: UiRuns,
  scenario: string,
  command: ScenarioRunCommand,
): UiRun | undefined {
  return selectUiRun(state, { kind: 'scenario', id: scenario }, command);
}

export function reduceUiRuns(state: UiRuns, action: UiRunsAction): UiRuns {
  switch (action.type) {
    case 'requested':
      return setUiRun(state, action, {
        target: { kind: action.kind, id: action.id },
        command: action.command,
        status: 'starting',
        connection: 'connecting',
        chunks: [],
        requestedAt: action.at,
      });
    case 'started': {
      const current = selectUiRun(state, action, action.command);
      return setUiRun(state, action, {
        target: { kind: action.kind, id: action.id },
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
      const current = selectUiRun(state, action, action.command);
      return setUiRun(state, action, {
        target: { kind: action.kind, id: action.id },
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
    case 'suite-result':
      return updateActiveRun(state, action, (run) => ({ ...run, suiteResult: action.result }));
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

export const reduceScenarioRuns = reduceUiRuns;

function updateActiveRun(
  state: UiRuns,
  target: ActiveUiRunTarget,
  update: (run: UiRun) => UiRun,
): UiRuns {
  const run = selectUiRun(state, target, target.command);
  return run?.runId === target.runId ? setUiRun(state, target, update(run)) : state;
}

function setUiRun(
  state: UiRuns,
  target: UiRunCommandTarget,
  run: UiRun,
): UiRuns {
  const next = new Map(state);
  const key = formatTargetKey(target);
  next.set(key, {
    ...state.get(key),
    [target.command]: run,
  });
  return next;
}

function formatTargetKey(target: UiRunTarget): string {
  return `${target.kind}\0${target.id}`;
}
