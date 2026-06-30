import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import { formatDisplayPath } from './paths.js';
import { resolveLoadTestDir } from './scenario-paths.js';

export interface UiReportContext {
  cwd: string;
  config: LoadTestConfig;
}

export interface UiReportList {
  reportDir: string;
  reports: UiReportListItem[];
}

export interface UiReportListItem {
  id: string;
  fileName: string;
  path: string;
  generatedAt?: string;
  suiteKey?: string;
  suiteName?: string;
  result?: string;
  scenarioPassed?: number;
  scenarioTotal?: number;
  stepPassed?: number;
  stepTotal?: number;
  durationMs?: number;
  error?: string;
}

export async function listUiReports(context: UiReportContext): Promise<UiReportList> {
  const reportDir = resolveUiReportDir(context);
  const files = await listReportFiles(reportDir);
  const reports = await Promise.all(files.map((filePath) => readUiReportListItem(context, reportDir, filePath)));

  reports.sort((left, right) => {
    const leftTime = Date.parse(left.generatedAt ?? '');
    const rightTime = Date.parse(right.generatedAt ?? '');
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0) ||
      right.fileName.localeCompare(left.fileName);
  });

  return {
    reportDir: formatDisplayPath(context.cwd, reportDir),
    reports,
  };
}

export async function readUiReport(context: UiReportContext, reportId: string): Promise<unknown> {
  const reportPath = resolveUiReportPath(context, reportId);
  return JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
}

export async function readUiReportJsonText(context: UiReportContext, reportId: string): Promise<string> {
  const reportPath = resolveUiReportPath(context, reportId);
  return fs.readFile(reportPath, 'utf8');
}

export async function readUiReportHtml(context: UiReportContext, reportId: string): Promise<string> {
  const report = await readUiReport(context, reportId);
  return renderUiReportHtml(reportId, report);
}

export function resolveUiReportDownloadFileName(reportId: string, extension: 'html' | 'json'): string {
  const parsed = path.parse(assertReportId(reportId));
  return `${parsed.name}.${extension}`;
}

async function readUiReportListItem(
  context: UiReportContext,
  reportDir: string,
  filePath: string,
): Promise<UiReportListItem> {
  const fileName = path.basename(filePath);

  try {
    const report = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    const suite = asRecord(report.suite);
    const summary = asRecord(report.summary);
    const scenarios = asRecord(summary.scenarios);
    const steps = asRecord(summary.steps);

    return {
      id: fileName,
      fileName,
      path: formatDisplayPath(context.cwd, filePath),
      generatedAt: asString(report.generatedAt),
      suiteKey: asString(suite.key),
      suiteName: asString(suite.name),
      result: asString(report.result),
      scenarioPassed: asNumber(scenarios.passed),
      scenarioTotal: asNumber(scenarios.total),
      stepPassed: asNumber(steps.passed),
      stepTotal: asNumber(steps.total),
      durationMs: asNumber(summary.durationMs),
    };
  } catch (error) {
    return {
      id: fileName,
      fileName,
      path: formatDisplayPath(context.cwd, path.join(reportDir, fileName)),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listReportFiles(directoryPath: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function resolveUiReportPath(context: UiReportContext, reportId: string): string {
  const reportDir = resolveUiReportDir(context);
  const fileName = assertReportId(reportId);
  const reportPath = path.join(reportDir, fileName);
  const relative = path.relative(reportDir, reportPath);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`report must be inside ${formatDisplayPath(context.cwd, reportDir)}`);
  }

  return reportPath;
}

function assertReportId(value: string): string {
  const fileName = value.trim();

  if (
    fileName === '' ||
    fileName !== path.basename(fileName) ||
    path.extname(fileName).toLowerCase() !== '.json'
  ) {
    throw new Error('report must be a JSON report file name');
  }

  return fileName;
}

function resolveUiReportDir(context: UiReportContext): string {
  return path.join(resolveLoadTestDir(context.cwd, context.config), 'reports');
}

function renderUiReportHtml(reportId: string, report: unknown): string {
  const data = asRecord(report);
  const suite = asRecord(data.suite);
  const summary = asRecord(data.summary);
  const scenarioSummary = asRecord(summary.scenarios);
  const stepSummary = asRecord(summary.steps);
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios.map(asRecord) : [];
  const result = asString(data.result) ?? 'UNKNOWN';
  const title = asString(suite.name) ?? asString(suite.key) ?? reportId;
  const failures = collectReportFailures(scenarios);
  const orderedScenarios = orderReportScenarios(scenarios);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - openapi-k6 suite report</title>
  <style>
    :root { color-scheme: light; --bg: #f7f8fb; --panel: #fff; --line: #d9dee8; --text: #17202f; --muted: #667085; --ok: #067647; --bad: #b42318; --ok-bg: #e7f8ef; --bad-bg: #fff0ee; --terminal: #101828; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; gap: 14px; margin: 0 auto; max-width: 1120px; padding: 22px; }
    header, section { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 16px; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; }
    h3 { font-size: 13px; }
    .top { align-items: start; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) max-content; }
    .muted { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .pill { align-items: center; border-radius: 999px; display: inline-flex; font-size: 12px; font-weight: 800; padding: 3px 8px; }
    .pill.pass { background: var(--ok-bg); color: var(--ok); }
    .pill.fail { background: var(--bad-bg); color: var(--bad); }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .metric { border-top: 1px solid var(--line); display: grid; gap: 2px; padding-top: 10px; }
    .metric-label { color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .metric-value { font-size: 15px; font-weight: 800; }
    .scenario-list { display: grid; gap: 10px; }
    .scenario { background: #fff; border: 1px solid var(--line); border-left: 4px solid #98a2b3; border-radius: 6px; display: grid; gap: 6px; padding: 12px; }
    .scenario.pass { background: #fbfffd; border-left-color: var(--ok); }
    .scenario.fail { background: #fffafa; border-left-color: var(--bad); }
    .scenario-head { align-items: start; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) max-content; }
    .scenario-name { font-weight: 800; overflow-wrap: anywhere; }
    .scenario-failure { color: var(--bad); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .failure-summary { background: #fffafa; border: 1px solid #fecaca; border-left: 4px solid var(--bad); border-radius: 6px; display: grid; gap: 8px; padding: 16px; }
    .failure-summary.ok { background: #f6fef9; border-color: #abefc6; border-left-color: var(--ok); }
    .failure-title { color: var(--bad); font-size: 15px; font-weight: 800; }
    .failure-summary.ok .failure-title { color: var(--ok); }
    .failure-list { display: grid; gap: 8px; }
    .failure-item { display: grid; gap: 2px; }
    .failure-main { font-size: 13px; font-weight: 800; overflow-wrap: anywhere; }
    .explanation-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .explanation-card { background: #fff; border: 1px solid var(--line); border-radius: 6px; display: grid; gap: 4px; min-width: 0; padding: 12px; }
    .explanation-label { color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .explanation-title { font-size: 13px; font-weight: 800; overflow-wrap: anywhere; }
    .explanation-text { color: var(--muted); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .error { color: var(--bad); font-size: 12px; overflow-wrap: anywhere; }
    @media (max-width: 760px) { .top, .scenario-head, .grid, .explanation-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="top">
        <div>
          <h1>${escapeHtml(title)} 종합 리포트</h1>
          <div class="muted">스위트 실행 결과를 한 페이지로 요약합니다. 시나리오 목록은 성공/실패와 실패 원인만 표시합니다.</div>
        </div>
        <span class="pill ${result === 'PASS' ? 'pass' : 'fail'}">${escapeHtml(result)}</span>
      </div>
    </header>
    <section class="grid">
      ${renderMetric('Generated', formatDateTime(asString(data.generatedAt)))}
      ${renderMetric('Scenarios in suite', `${formatCount(asNumber(scenarioSummary.passed))}/${formatCount(asNumber(scenarioSummary.total))}`)}
      ${renderMetric('Steps', `${formatCount(asNumber(stepSummary.passed))}/${formatCount(asNumber(stepSummary.total))}`)}
      ${renderMetric('Duration', formatDuration(asNumber(summary.durationMs)))}
    </section>
    ${renderReportExplanation(reportId, data, failures)}
    ${renderReportFailureSummary(failures)}
    <section>
      <h2>테스트한 시나리오</h2>
      ${orderedScenarios.length === 0 ? '<p class="muted">테스트한 시나리오 없음</p>' : `<div class="scenario-list">${orderedScenarios.map(renderReportScenario).join('')}</div>`}
    </section>
  </main>
</body>
</html>
`;
}

function renderMetric(label: string, value: string): string {
  return `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div></div>`;
}

function renderReportScenario(scenario: Record<string, unknown>): string {
  const result = asString(scenario.result) ?? 'UNKNOWN';
  const steps = Array.isArray(scenario.steps) ? scenario.steps.map(asRecord) : [];
  const title = asString(scenario.name) ?? asString(scenario.key) ?? 'scenario';
  const failedStep = steps.find(reportStepHasFailure);
  const requestStep = pickReportScenarioRequestStep(steps, failedStep);
  const request = requestStep === undefined ? undefined : [asString(requestStep.method), asString(requestStep.path)].filter(Boolean).join(' ');
  const passedSteps = steps.filter((step) => !reportStepHasFailure(step)).length;
  const tone = result === 'PASS' ? 'pass' : 'fail';

  return `<div class="scenario ${tone}">
    <div class="scenario-head">
      <div>
        <div class="scenario-name">${escapeHtml(title)}</div>
        <div class="muted">${escapeHtml([
          request,
          steps.length === 0 ? undefined : `${passedSteps}/${steps.length} steps`,
          formatDuration(asNumber(scenario.durationMs)),
        ].filter(Boolean).join(' · '))}</div>
      </div>
      <span class="pill ${tone}">${escapeHtml(result)}</span>
    </div>
    ${failedStep === undefined ? '' : `<div class="scenario-failure">${escapeHtml(formatReportStepFailure(failedStep))}</div>`}
  </div>`;
}

function pickReportScenarioRequestStep(
  steps: Array<Record<string, unknown>>,
  failedStep: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (failedStep !== undefined && (asString(failedStep.method) !== undefined || asString(failedStep.path) !== undefined)) {
    return failedStep;
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (asString(step.method) !== undefined || asString(step.path) !== undefined) return step;
  }

  return undefined;
}

function formatReportStepFailure(step: Record<string, unknown>): string {
  const response = asRecord(step.response);
  const condition = asRecord(step.condition);
  const extracts = Array.isArray(step.extracts) ? step.extracts.map(asRecord) : [];
  const errors = [
    asString(step.error),
    condition.passed === false ? `condition: ${asString(condition.expression) ?? ''}` : undefined,
    ...extracts
      .filter((extract) => extract.passed === false)
      .map((extract) => `extract: ${asString(extract.name) ?? ''}${asString(extract.error) ? ` - ${asString(extract.error)}` : ''}`),
  ].filter((value): value is string => value !== undefined && value.trim() !== '');

  const request = [asString(step.method), asString(step.path)].filter(Boolean).join(' ');
  const actual = response.status === undefined
    ? '-'
    : `HTTP ${String(response.status)}${asString(response.statusText) ? ` ${asString(response.statusText)}` : ''}`;
  const expected = asString(condition.expression) ?? '-';

  return [
    `실패 step ${asString(step.id) ?? `step ${formatCount(asNumber(step.index))}`}`,
    request,
    `actual ${actual}`,
    `expected ${expected}`,
    errors.join(' · '),
  ].filter(Boolean).join(' · ');
}

function renderReportExplanation(reportId: string, report: Record<string, unknown>, failures: ReportFailureItem[]): string {
  const firstFailure = failures[0];
  if (firstFailure === undefined) return '';
  const next = inferReportNextCheck(firstFailure);

  return `<section class="explanation-grid">
    ${renderReportExplanationCard('첫 실패', `${firstFailure.scenario} · ${firstFailure.step}`, [firstFailure.source, firstFailure.request, `actual ${firstFailure.actual}`, `expected ${firstFailure.expected}`].filter(Boolean).join(' · '))}
    ${renderReportExplanationCard('다음 확인', next.title, next.text)}
  </section>`;
}

function renderReportExplanationCard(label: string, title: string, text: string): string {
  return `<div class="explanation-card">
    <div class="explanation-label">${escapeHtml(label)}</div>
    <div class="explanation-title">${escapeHtml(title || '-')}</div>
    <div class="explanation-text">${escapeHtml(text || '-')}</div>
  </div>`;
}

function inferReportNextCheck(failure: ReportFailureItem): { title: string; text: string } {
  const expectedStatus = parseReportStatusCode(failure.expected);
  const actualStatus = parseReportStatusCode(failure.actual);

  if (expectedStatus !== undefined && actualStatus !== undefined && expectedStatus !== actualStatus) {
    return {
      title: 'status 기대값과 실제 응답 불일치',
      text: '시나리오 condition, OpenAPI 스펙, 백엔드 구현 중 어느 쪽이 맞는지 확인',
    };
  }

  if (failure.expected.startsWith('extract:')) {
    return {
      title: '응답 extract 실패',
      text: '응답 JSON 경로와 실제 응답 필드명 확인',
    };
  }

  if (failure.expected !== '-') {
    return {
      title: '조건식 실패',
      text: 'condition 표현식과 실제 응답 상태를 같이 확인',
    };
  }

  return {
    title: '실행 오류 확인',
    text: '대상 서버, URL, 인증, 네트워크 오류 메시지 확인',
  };
}

function parseReportStatusCode(value: string): number | undefined {
  const match = value.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : undefined;
}

function renderReportFailureSummary(failures: ReportFailureItem[]): string {
  if (failures.length === 0) {
    return '<section class="failure-summary ok"><div class="failure-title">모든 시나리오 통과</div><div class="muted">실패 step 없음</div></section>';
  }

  return `<section class="failure-summary">
    <div class="failure-title">실패 원인 ${failures.length}개</div>
    <div class="failure-list">
      ${failures.slice(0, 8).map((failure) => `<div class="failure-item">
        <div class="failure-main">${escapeHtml(`${failure.scenario} · ${failure.step}`)}</div>
        <div class="muted">${escapeHtml([failure.source, failure.request, `actual ${failure.actual}`, `expected ${failure.expected}`].filter(Boolean).join(' · '))}</div>
      </div>`).join('')}
    </div>
    ${failures.length > 8 ? `<div class="muted">외 ${failures.length - 8}개 실패</div>` : ''}
  </section>`;
}

interface ReportFailureItem {
  scenario: string;
  step: string;
  source: string;
  request: string;
  actual: string;
  expected: string;
}

function collectReportFailures(scenarios: Array<Record<string, unknown>>): ReportFailureItem[] {
  const failures: ReportFailureItem[] = [];

  for (const scenario of scenarios) {
    const steps = Array.isArray(scenario.steps) ? scenario.steps.map(asRecord) : [];

    for (const step of steps) {
      if (!reportStepHasFailure(step)) continue;
      const response = asRecord(step.response);
      const condition = asRecord(step.condition);
      failures.push({
        scenario: asString(scenario.name) ?? asString(scenario.key) ?? 'scenario',
        step: asString(step.id) ?? 'step',
        source: formatReportStepSource(step.source),
        request: [asString(step.method), asString(step.path)].filter(Boolean).join(' '),
        actual: response.status === undefined
          ? '-'
          : `HTTP ${String(response.status)}${asString(response.statusText) ? ` ${asString(response.statusText)}` : ''}`,
        expected: asString(condition.expression) ?? asString(step.error) ?? '-',
      });
    }
  }

  return failures;
}

function formatReportStepSource(source: unknown): string {
  const record = asRecord(source);
  const kind = asString(record.kind);

  if (kind === undefined) return '';
  if (kind === 'direct') return '직접 정의';
  if (kind === 'use') return `시나리오 사용: ${asString(record.reference) ?? ''}`.trim();
  if (kind === 'include') return `파일 포함: ${asString(record.reference) ?? ''}`.trim();
  return kind;
}

function reportScenarioHasFailure(scenario: Record<string, unknown>): boolean {
  if (asString(scenario.result)?.toUpperCase() === 'FAIL') return true;
  const steps = Array.isArray(scenario.steps) ? scenario.steps.map(asRecord) : [];
  return steps.some(reportStepHasFailure);
}

function reportStepHasFailure(step: Record<string, unknown>): boolean {
  if (asString(step.result)?.toUpperCase() === 'FAIL') return true;
  if (step.error !== undefined) return true;
  if (asRecord(step.condition).passed === false) return true;
  const extracts = Array.isArray(step.extracts) ? step.extracts.map(asRecord) : [];
  return extracts.some((extract) => extract.passed === false);
}

function orderReportScenarios(scenarios: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...scenarios].sort((left, right) => Number(reportScenarioHasFailure(right)) - Number(reportScenarioHasFailure(left)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '-' : String(value);
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value / 1000)}s`;
}

function formatDateTime(value: string | undefined): string {
  if (value === undefined) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
