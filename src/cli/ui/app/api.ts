import type { UiScenarioDetail, UiScenarioList } from '../scenarios.js';
import type { UiServerCheckResult } from '../server-checks.js';
import type { UiSuiteList } from '../suites.js';

export type UiScenarioRunCommand = 'validate' | 'test';

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);

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

export function loadUiScenarios(signal?: AbortSignal): Promise<UiScenarioList> {
  return requestJson('/api/scenarios', { signal });
}

export function loadUiScenario(id: string, signal?: AbortSignal): Promise<UiScenarioDetail> {
  return requestJson(`/api/scenario?scenario=${encodeURIComponent(id)}`, { signal });
}

export function loadUiSuites(signal?: AbortSignal): Promise<UiSuiteList> {
  return requestJson('/api/suites', { signal });
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
