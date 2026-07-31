import type {
  UiScenarioDetail,
  UiScenarioList,
  UiScenarioSourceSave,
  UiScenarioSourceValidation,
} from '../scenarios.js';
import type { UiReportList } from '../reports.js';
import type { UiServerCheckResult } from '../server-checks.js';
import type { UiSuiteDetail, UiSuiteList } from '../suites.js';
import { normalizeUiReport, type UiReportDetail } from './report-view.js';

export type UiScenarioRunCommand = 'validate' | 'test';

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new UiConnectionError(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : response.statusText || `request failed (${response.status})`,
    );
  }

  return response.json() as Promise<T>;
}

export class UiConnectionError extends Error {
  override name = 'UiConnectionError';
}

export function loadUiScenarios(signal?: AbortSignal): Promise<UiScenarioList> {
  return requestJson('/api/scenarios', { signal });
}

export function loadUiScenario(id: string, signal?: AbortSignal): Promise<UiScenarioDetail> {
  return requestJson(`/api/scenario?scenario=${encodeURIComponent(id)}`, { signal });
}

export function validateUiScenarioSource(
  scenario: string,
  code: string,
): Promise<UiScenarioSourceValidation> {
  return requestJson('/api/scenario/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario, code }),
  });
}

export function saveUiScenarioSource(
  scenario: string,
  code: string,
  revision: string,
): Promise<UiScenarioSourceSave> {
  return requestJson('/api/scenario', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario, code, revision }),
  });
}

export function loadUiSuites(signal?: AbortSignal): Promise<UiSuiteList> {
  return requestJson('/api/suites', { signal });
}

export function loadUiSuite(id: string, signal?: AbortSignal): Promise<UiSuiteDetail> {
  return requestJson(`/api/suite?suite=${encodeURIComponent(id)}`, { signal });
}

export function loadUiReports(signal?: AbortSignal): Promise<UiReportList> {
  return requestJson('/api/reports', { signal });
}

export async function loadUiReport(id: string, signal?: AbortSignal): Promise<UiReportDetail> {
  return normalizeUiReport(await requestJson(`/api/report?report=${encodeURIComponent(id)}`, { signal }));
}

export async function probeUiServer(signal?: AbortSignal): Promise<void> {
  await requestJson('/api/scenarios', { signal });
}

export function checkUiServers(signal?: AbortSignal): Promise<UiServerCheckResult> {
  return requestJson('/api/check-servers', { method: 'POST', signal });
}

export function startUiScenarioRun(
  command: UiScenarioRunCommand,
  scenario: string,
): Promise<{ runId: string; status: 'running' }> {
  return requestJson('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command, scenario, showValues: command === 'test' }),
  });
}

export function startUiSuiteRun(
  command: UiScenarioRunCommand,
  suite: string,
): Promise<{ runId: string; status: 'running' }> {
  return requestJson('/api/run-suite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command, suite, showValues: command === 'test' }),
  });
}

export function submitUiRunInput(
  runId: string,
  name: string,
  value: string,
): Promise<{ accepted: true }> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, value }),
  });
}

function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
}
