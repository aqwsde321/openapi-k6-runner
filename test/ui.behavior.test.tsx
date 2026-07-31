/**
 * @vitest-environment jsdom
 */

import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiReportList } from '../src/cli/ui/reports.js';
import type { UiScenarioDetail, UiScenarioList } from '../src/cli/ui/scenarios.js';
import type { UiSuiteList } from '../src/cli/ui/suites.js';
import { ReportDialog, type ReportController } from '../src/cli/ui/app/ReportDialog.js';
import { ScenarioExplorer, type ExplorerMode } from '../src/cli/ui/app/ScenarioExplorer.js';
import { ScenarioFlow } from '../src/cli/ui/app/ScenarioFlow.js';
import { ScenarioRunPanel } from '../src/cli/ui/app/ScenarioRunPanel.js';
import {
  reduceUiRuns,
  selectUiRun,
  type UiRuns,
} from '../src/cli/ui/app/scenario-runs.js';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value() {} });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath() {},
    arc() {},
    stroke() {},
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('React UI behavior', () => {
  it('searches and selects scenarios and suites', async () => {
    const selected = vi.fn();

    function ExplorerHarness() {
      const [mode, setMode] = useState<ExplorerMode>('scenario');
      return (
        <ScenarioExplorer
          mode={mode}
          onModeChange={setMode}
          onSelect={(id) => selected(mode, id)}
          runs={new Map()}
          scenarios={scenarioList}
          suites={suiteList}
        />
      );
    }

    await render(<ExplorerHarness />);
    await click(getTreeAction('item:scenario:auth/login'));
    expect(selected).toHaveBeenLastCalledWith('scenario', 'auth/login');

    await click(getButton('스위트'));
    const search = getInput('스위트 검색');
    await changeInput(search, 'regression');
    expect(document.body.textContent).toContain('nightly regression');
    expect(document.body.textContent).not.toContain('smoke suite');

    await click(getTreeAction('item:suite:nightly'));
    expect(selected).toHaveBeenLastCalledWith('suite', 'nightly');
  });

  it('expands an endpoint to show planned request and response values', async () => {
    const item = scenarioList.scenarios[0];
    const detail: UiScenarioDetail = {
      id: item.id,
      name: item.name,
      path: item.path,
      stepCount: 2,
      modules: ['app'],
      targetModules: ['app'],
      env: [],
      vars: ['name'],
      includes: [],
      fixtures: [],
      definition: {
        path: 'openapi-k6/scenarios/auth/login.yaml',
        code: 'name: login\nsteps: []',
      },
      steps: [
        {
          id: 'create-user',
          source: {
            kind: 'use',
            reference: 'auth/session',
            lineage: [
              {
                kind: 'use',
                reference: 'auth/session',
                definition: {
                  path: 'openapi-k6/scenarios/auth/session.yaml',
                  code: 'name: session\nsteps:\n  - use: auth/login',
                },
              },
              {
                kind: 'use',
                reference: 'auth/login',
                definition: {
                  path: 'openapi-k6/scenarios/auth/login.yaml',
                  code: 'name: login\nsteps:\n  - id: create-user',
                },
              },
            ],
          },
          targetModule: 'app',
          method: 'POST',
          path: '/users',
          request: {
            body: {
              active: true,
              name: '{{vars.name}}',
              retries: 2,
            },
          },
          expectedResponse: { status: '201', source: 'schema', body: { id: 'string' } },
          definition: {
            path: 'openapi-k6/scenarios/auth/login.yaml',
            code: 'STEP_LEVEL_SHOULD_NOT_RENDER',
          },
        },
        {
          id: 'yaml-only',
          source: { kind: 'direct' },
          definition: {
            path: 'openapi-k6/scenarios/auth/yaml-only.yaml',
            code: 'id: yaml-only',
          },
        },
      ],
    };

    await render(
      <ScenarioFlow
        defaultModule="app"
        detail={detail}
        item={item}
        loading={false}
        modules={[]}
      />,
    );
    const stepButton = getButtonContaining('create-user');
    expect(stepButton.textContent).toContain('포함 · auth/session › auth/login');
    expect(stepButton.getAttribute('aria-expanded')).toBe('false');
    await click(stepButton);
    expect(stepButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('요청 · 예정 구조');
    expect(document.body.textContent).toContain('{{vars.name}}');
    expect(document.body.textContent).toContain('"status": "201"');
    const stepDetail = document.body.querySelector<HTMLElement>(
      'section[aria-label="create-user 단계 상세"]',
    );
    expect(stepDetail).not.toBeNull();
    expect(stepDetail?.querySelector('[data-astryx-syntax-theme="one-light"]')).not.toBeNull();
    const requestCode = stepDetail?.querySelector<HTMLElement>('.astryx-codeblock');
    expect(requestCode?.dataset.language).toBe('json');
    expect([...requestCode?.querySelectorAll('.astryx-token-property') ?? []]
      .map((token) => token.textContent)).toContain('"name"');
    expect([...requestCode?.querySelectorAll('.astryx-token-string') ?? []]
      .map((token) => token.textContent)).toContain('"{{vars.name}}"');
    expect([...requestCode?.querySelectorAll('.astryx-token-number') ?? []]
      .map((token) => token.textContent)).toContain('2');
    expect([...requestCode?.querySelectorAll('.astryx-token-constant') ?? []]
      .map((token) => token.textContent)).toContain('true');
    expect(document.body.textContent).not.toContain('STEP_LEVEL_SHOULD_NOT_RENDER');

    await click(getButtonContaining('yaml-only'));
    expect(document.body.textContent).not.toContain('표시할 상세 정보 없음');

    await click(getButtonContaining('openapi-k6/scenarios/auth/session.yaml'));
    expect(document.body.textContent).toContain('포함 시나리오 YAML');
    expect(document.body.textContent).toContain('name: session');
    let closeDialog = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    await click(expectElement(closeDialog));

    await click(getButtonContaining('단계 원본 YAML'));
    expect(document.body.textContent).toContain('단계 YAML');
    expect(document.body.textContent).toContain('STEP_LEVEL_SHOULD_NOT_RENDER');
    closeDialog = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    await click(expectElement(closeDialog));

    await click(getButton('YAML 보기'));
    expect(document.body.textContent).toContain('시나리오 YAML');
    expect(document.body.textContent).toContain('openapi-k6/scenarios/auth/login.yaml');
    expect(document.body.textContent).toContain('name: login');
  });

  it('starts a run and submits a sensitive input value', async () => {
    const start = vi.fn(async () => undefined);
    const submit = vi.fn(async () => undefined);

    await render(
      <ScenarioRunPanel
        isReady
        runs={new Map()}
        start={start}
        submit={submit}
        targetId="manual"
        targetKind="scenario"
        targetName="manual"
      />,
    );
    await click(getButton('실행'));
    expect(start).toHaveBeenCalledWith({ kind: 'scenario', id: 'manual' }, 'test');

    const runs = pendingInputRuns();
    await render(
      <ScenarioRunPanel
        isReady
        runs={runs}
        start={start}
        submit={submit}
        targetId="manual"
        targetKind="scenario"
        targetName="manual"
      />,
    );
    const input = document.body.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input?.labels?.[0]?.textContent).toContain('SMS 인증번호');
    await changeInput(expectElement(input), '123456');
    await click(getButton('계속'));

    expect(submit).toHaveBeenCalledWith(
      selectUiRun(runs, { kind: 'scenario', id: 'manual' }, 'test'),
      '123456',
    );
  });

  it('renders k6 ANSI log colors without control sequences', async () => {
    const runs = ansiLogRuns();

    await render(
      <ScenarioRunPanel
        isReady
        runs={runs}
        start={async () => undefined}
        submit={async () => undefined}
        targetId="manual"
        targetKind="scenario"
        targetName="manual"
      />,
    );

    const logTheme = document.body.querySelector('[data-astryx-syntax-theme="github-dark"]');
    expect(logTheme).not.toBeNull();
    expect(logTheme?.querySelector('pre')?.getAttribute('data-container')).toBe('card');
    expect([...document.body.querySelectorAll('.astryx-token-tag')].map((token) => (
      token.textContent
    ))).toEqual(['PASS', 'NEXT']);
    expect(document.body.querySelector('.astryx-token-keyword')?.textContent).toBe('FAIL');
    expect(document.body.textContent).not.toContain('\u001b');
  });

  it('filters report failures and keeps download actions', async () => {
    const controller: ReportController = {
      count: 1,
      detail: {
        result: 'FAIL',
        suite: { key: 'nightly', name: 'nightly regression' },
        summary: {
          scenarios: { passed: 1, total: 2 },
          steps: { passed: 1, total: 2 },
        },
        scenarios: [
          {
            key: 'failed',
            name: 'failed scenario',
            result: 'FAIL',
            steps: [{
              id: 'login',
              result: 'FAIL',
              method: 'POST',
              path: '/login',
              response: { status: 401 },
              condition: { expression: 'status == 200', passed: false },
            }],
          },
          {
            key: 'passed',
            name: 'passed scenario',
            result: 'PASS',
            steps: [{ id: 'health', result: 'PASS', method: 'GET', path: '/health' }],
          },
        ],
      },
      isDetailLoading: false,
      isListLoading: false,
      isOpen: true,
      list: reportList,
      selectedId: 'nightly.json',
      open() {},
      async refresh() {},
      select() {},
      setIsOpen() {},
    };

    await render(<ReportDialog controller={controller} />);
    expect(document.body.textContent).toContain('failed scenario');
    expect(document.body.textContent).toContain('passed scenario');
    expect(document.body.querySelector('a[href*="format=html"]')).not.toBeNull();
    expect(document.body.querySelector('a[href*="format=json"]')).not.toBeNull();

    await click(expectElement(document.body.querySelector('input[type="checkbox"]')));
    expect(document.body.textContent).toContain('failed scenario');
    expect(document.body.textContent).not.toContain('passed scenario');
  });
});

const scenarioList: UiScenarioList = {
  configPath: 'openapi-k6/config.yaml',
  scenarioDir: 'openapi-k6/scenarios',
  defaultModule: 'app',
  moduleCount: 1,
  scenarios: [
    {
      id: 'auth/login',
      name: 'login',
      description: 'user login',
      group: 'auth',
      path: 'openapi-k6/scenarios/auth/login.yaml',
      stepCount: 1,
    },
    {
      id: 'health',
      name: 'health check',
      group: 'system',
      path: 'openapi-k6/scenarios/health.yaml',
      stepCount: 1,
    },
  ],
};

const suiteList: UiSuiteList = {
  suiteDir: 'openapi-k6/suites',
  suites: [
    {
      id: 'smoke',
      name: 'smoke suite',
      group: 'root',
      path: 'openapi-k6/suites/smoke.yaml',
      scenarioCount: 1,
      scenarios: ['health'],
    },
    {
      id: 'nightly',
      name: 'nightly regression',
      group: 'root',
      path: 'openapi-k6/suites/nightly.yaml',
      scenarioCount: 2,
      scenarios: ['auth/login', 'health'],
    },
  ],
};

const reportList: UiReportList = {
  reportDir: 'openapi-k6/reports',
  reports: [{
    id: 'nightly.json',
    fileName: 'nightly.json',
    path: 'openapi-k6/reports/nightly.json',
    suiteName: 'nightly regression',
    result: 'FAIL',
  }],
};

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(<Theme mode="light" theme={neutralTheme}>{node}</Theme>);
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function getButton(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => (
    normalizeText(candidate.textContent).startsWith(label)
  ));
  return expectElement(button);
}

function getButtonContaining(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => (
    normalizeText(candidate.textContent).includes(label)
  ));
  return expectElement(button);
}

function getInput(placeholder: string): HTMLInputElement {
  return expectElement(document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`));
}

function getTreeAction(id: string): HTMLButtonElement {
  return expectElement(document.body.querySelector<HTMLButtonElement>(
    `[data-tree-id="${id}"] button:not([data-tree-toggle])`,
  ));
}

function expectElement<ElementType extends Element>(value: ElementType | null | undefined): ElementType {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as ElementType;
}

function normalizeText(value: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function pendingInputRuns(): UiRuns {
  let runs: UiRuns = new Map();
  runs = reduceUiRuns(runs, {
    type: 'requested',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    at: '2026-07-30T00:00:00.000Z',
  });
  runs = reduceUiRuns(runs, {
    type: 'started',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    runId: 'manual-run',
    at: '2026-07-30T00:00:01.000Z',
  });
  return reduceUiRuns(runs, {
    type: 'input-request',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    runId: 'manual-run',
    request: {
      runId: 'manual-run',
      index: 0,
      totalSteps: 2,
      id: 'otp',
      name: 'otp',
      label: 'SMS 인증번호',
      required: true,
      sensitive: true,
    },
  });
}

function ansiLogRuns(): UiRuns {
  let runs: UiRuns = new Map();
  runs = reduceUiRuns(runs, {
    type: 'requested',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    at: '2026-07-30T00:00:00.000Z',
  });
  runs = reduceUiRuns(runs, {
    type: 'started',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    runId: 'manual-run',
    at: '2026-07-30T00:00:01.000Z',
  });
  return reduceUiRuns(runs, {
    type: 'chunk',
    kind: 'scenario',
    id: 'manual',
    command: 'test',
    runId: 'manual-run',
    chunk: {
      stream: 'stdout',
      chunk: '\u001b[32mPASS\nNEXT\u001b[0m \u001b[91mFAIL\u001b[0m',
      html: '<span class="ansi-green">PASS\nNEXT</span> <span class="ansi-red">FAIL</span>',
    },
  });
}
