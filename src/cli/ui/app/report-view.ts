import type { UiReportListItem } from '../reports.js';

export interface UiReportDetail {
  generatedAt?: string;
  result?: string;
  suite?: {
    key?: string;
    name?: string;
    path?: string;
  };
  summary?: {
    scenarios?: { passed?: number; total?: number };
    steps?: { passed?: number; total?: number };
    durationMs?: number;
  };
  scenarios?: UiReportScenario[];
}

export interface UiReportScenario {
  key?: string;
  name?: string;
  path?: string;
  result?: string;
  durationMs?: number;
  steps?: UiReportStep[];
}

export interface UiReportStep {
  index?: number;
  id?: string;
  result?: string;
  method?: string;
  path?: string;
  durationMs?: number;
  response?: { status?: number; statusText?: string };
  condition?: { expression?: string; passed?: boolean };
  extracts?: Array<{ name?: string; path?: string; passed?: boolean; error?: string }>;
  error?: string;
}

export interface UiReportFailure {
  scenario: string;
  step: string;
  request?: string;
  actual: string;
  expected: string;
  error?: string;
}

export function normalizeUiReport(value: unknown): UiReportDetail {
  const report = asRecord(value);
  const suite = asRecord(report.suite);
  const summary = asRecord(report.summary);
  const scenarioSummary = asRecord(summary.scenarios);
  const stepSummary = asRecord(summary.steps);

  return {
    ...optionalString('generatedAt', report.generatedAt),
    ...optionalString('result', report.result),
    suite: {
      ...optionalString('key', suite.key),
      ...optionalString('name', suite.name),
      ...optionalString('path', suite.path),
    },
    summary: {
      scenarios: {
        ...optionalNumber('passed', scenarioSummary.passed),
        ...optionalNumber('total', scenarioSummary.total),
      },
      steps: {
        ...optionalNumber('passed', stepSummary.passed),
        ...optionalNumber('total', stepSummary.total),
      },
      ...optionalNumber('durationMs', summary.durationMs),
    },
    scenarios: asRecords(report.scenarios).map(normalizeScenario),
  };
}

export function formatReportListLabel(report: UiReportListItem): string {
  const title = report.suiteName ?? report.suiteKey ?? report.fileName;
  return [title, formatReportResult(report.result), formatReportDate(report.generatedAt)]
    .filter(Boolean)
    .join(' · ');
}

export function reportIdFromPath(value: string | undefined): string | undefined {
  return value?.split(/[\\/]/).filter(Boolean).pop();
}

export function getReportScenarios(report: UiReportDetail, failuresOnly: boolean): UiReportScenario[] {
  const scenarios = report.scenarios ?? [];
  return failuresOnly ? scenarios.filter(reportScenarioHasFailure) : scenarios;
}

export function reportScenarioHasFailure(scenario: UiReportScenario): boolean {
  if (normalizeResult(scenario.result) === 'failed') return true;
  return (scenario.steps ?? []).some(reportStepHasFailure);
}

export function collectReportFailures(report: UiReportDetail): UiReportFailure[] {
  return (report.scenarios ?? []).flatMap((scenario) => (
    (scenario.steps ?? [])
      .filter(reportStepHasFailure)
      .map((step) => {
        const failedExtract = step.extracts?.find((extract) => extract.passed === false);
        const error = [step.error, failedExtract?.error].filter(Boolean).join(' · ');
        return {
          scenario: scenario.name ?? scenario.key ?? 'scenario',
          step: step.id ?? (step.index === undefined ? 'step' : `step ${step.index + 1}`),
          ...([step.method, step.path].filter(Boolean).length === 0
            ? {}
            : { request: [step.method, step.path].filter(Boolean).join(' ') }),
          actual: step.response?.status === undefined
            ? '-'
            : `HTTP ${step.response.status}${step.response.statusText ? ` ${step.response.statusText}` : ''}`,
          expected: step.condition?.expression ?? (failedExtract === undefined
            ? '-'
            : `extract ${[failedExtract.name, failedExtract.path].filter(Boolean).join(' @ ') || '-'}`),
          ...(error === '' ? {} : { error }),
        };
      })
  ));
}

export function formatReportFailuresForCopy(failures: UiReportFailure[]): string {
  return failures.map((failure) => [
    `${failure.scenario} · ${failure.step}`,
    failure.request,
    `actual ${failure.actual}`,
    `expected ${failure.expected}`,
    failure.error,
  ].filter(Boolean).join(' · ')).join('\n');
}

export function formatReportResult(value: string | undefined): string {
  const result = normalizeResult(value);
  return result === 'passed' ? '성공' : result === 'failed' ? '실패' : '알 수 없음';
}

export function normalizeResult(value: string | undefined): 'passed' | 'failed' | 'unknown' {
  const normalized = value?.toUpperCase();
  if (normalized === 'PASS' || normalized === 'PASSED') return 'passed';
  if (normalized === 'FAIL' || normalized === 'FAILED') return 'failed';
  return 'unknown';
}

export function formatReportDuration(value: number | undefined): string {
  if (value === undefined) return '-';
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

export function formatReportDate(value: string | undefined): string {
  if (value === undefined) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

function reportStepHasFailure(step: UiReportStep): boolean {
  if (normalizeResult(step.result) === 'failed') return true;
  if (step.error !== undefined) return true;
  if (step.condition?.passed === false) return true;
  return (step.extracts ?? []).some((extract) => extract.passed === false);
}

function normalizeScenario(value: Record<string, unknown>): UiReportScenario {
  return {
    ...optionalString('key', value.key),
    ...optionalString('name', value.name),
    ...optionalString('path', value.path),
    ...optionalString('result', value.result),
    ...optionalNumber('durationMs', value.durationMs),
    steps: asRecords(value.steps).map(normalizeStep),
  };
}

function normalizeStep(value: Record<string, unknown>): UiReportStep {
  const response = asRecord(value.response);
  const condition = asRecord(value.condition);
  return {
    ...optionalNumber('index', value.index),
    ...optionalString('id', value.id),
    ...optionalString('result', value.result),
    ...optionalString('method', value.method),
    ...optionalString('path', value.path),
    ...optionalNumber('durationMs', value.durationMs),
    response: {
      ...optionalNumber('status', response.status),
      ...optionalString('statusText', response.statusText),
    },
    condition: {
      ...optionalString('expression', condition.expression),
      ...optionalBoolean('passed', condition.passed),
    },
    extracts: asRecords(value.extracts).map((extract) => ({
      ...optionalString('name', extract.name),
      ...optionalString('path', extract.path),
      ...optionalBoolean('passed', extract.passed),
      ...optionalString('error', extract.error),
    })),
    ...optionalString('error', value.error),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item !== null && typeof item === 'object' && !Array.isArray(item)
      ))
    : [];
}

function optionalString<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  return typeof value === 'string' ? { [key]: value } as Record<Key, string> : {};
}

function optionalNumber<Key extends string>(key: Key, value: unknown): Partial<Record<Key, number>> {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } as Record<Key, number> : {};
}

function optionalBoolean<Key extends string>(key: Key, value: unknown): Partial<Record<Key, boolean>> {
  return typeof value === 'boolean' ? { [key]: value } as Record<Key, boolean> : {};
}
