export const UI_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>openapi-k6 UI</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-2: #f0f3f8;
      --line: #d9dee8;
      --text: #17202f;
      --muted: #667085;
      --accent: #0f766e;
      --accent-2: #155eef;
      --danger: #b42318;
      --ok-bg: #e7f8ef;
      --ok: #067647;
      --bad-bg: #fff0ee;
      --bad: #b42318;
      --warn-bg: #fff7e6;
      --warn: #a15c07;
      --focus: rgba(21, 94, 239, 0.18);
      --hover: #f7f9fc;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
      --terminal: #101828;
      --terminal-line: #243047;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      padding: 10px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.9);
      position: sticky;
      top: 0;
      z-index: 2;
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0; font-size: 17px; letter-spacing: 0; }
    .subtitle { color: var(--muted); font-size: 12px; }
    .brand { min-width: 220px; }
    .header-meta {
      justify-content: flex-end;
      max-width: 820px;
      min-width: 0;
    }
    .server-status {
      display: inline-flex;
      margin-bottom: -8px;
      padding-bottom: 8px;
      position: relative;
    }
    .server-status-summary {
      align-items: center;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 999px;
      display: inline-flex;
      gap: 10px;
      min-height: 28px;
      padding: 3px 9px;
    }
    .server-count {
      align-items: center;
      color: var(--muted);
      display: inline-flex;
      font-size: 12px;
      font-weight: 800;
      gap: 4px;
      line-height: 1;
    }
    .server-dot {
      border-radius: 999px;
      display: inline-block;
      height: 8px;
      width: 8px;
    }
    .server-dot.ok { background: var(--ok); }
    .server-dot.bad { background: var(--bad); }
    .server-popover {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      box-shadow: 0 12px 28px rgba(16, 24, 40, 0.14);
      display: none;
      gap: 8px;
      max-width: calc(100vw - 24px);
      padding: 10px;
      position: absolute;
      right: 0;
      top: 100%;
      width: 420px;
      z-index: 10;
    }
    .server-status:hover .server-popover,
    .server-status:focus-within .server-popover {
      display: grid;
    }
    .server-popover-head {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
    }
    .icon-button {
      align-items: center;
      display: inline-grid;
      height: 30px;
      justify-content: center;
      padding: 0;
      width: 30px;
    }
    main {
      display: grid;
      grid-template-columns: minmax(250px, 300px) minmax(430px, 1fr) minmax(390px, 0.9fr);
      gap: 12px;
      padding: 12px;
      height: calc(100vh - 60px);
    }
    body.ui-disconnected header,
    body.ui-disconnected main {
      filter: blur(2px);
      pointer-events: none;
      user-select: none;
    }
    .connection-overlay {
      align-items: center;
      background: rgba(247, 248, 251, 0.62);
      display: none;
      inset: 0;
      justify-content: center;
      padding: 18px;
      position: fixed;
      z-index: 50;
    }
    body.ui-disconnected .connection-overlay {
      display: grid;
    }
    .connection-card {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      box-shadow: 0 18px 44px rgba(16, 24, 40, 0.18);
      display: grid;
      gap: 10px;
      max-width: 440px;
      padding: 16px;
      width: min(100%, 440px);
    }
    .connection-title {
      font-size: 16px;
      font-weight: 800;
    }
    .connection-message {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .connection-actions {
      display: flex;
      justify-content: flex-end;
    }
    .panel {
      min-height: 0;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: #fbfcfe;
    }
    .panel-title { margin: 0; font-size: 13px; font-weight: 750; }
    .panel-body { padding: 12px; overflow: auto; min-height: 0; }
    input, button {
      font: inherit;
      border-radius: 6px;
    }
    input {
      width: 100%;
      padding: 8px 9px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
    }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 650;
      white-space: nowrap;
    }
    button:hover:not(:disabled) {
      background: var(--hover);
      border-color: #b8c0cc;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button.primary:hover:not(:disabled) { background: #0b665f; }
    button.blue {
      border-color: var(--accent-2);
      background: var(--accent-2);
      color: #fff;
    }
    button.blue:hover:not(:disabled) { background: #104bc5; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    button:focus-visible,
    input:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .scenario-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .scenario-group {
      background: #fbfcfe;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 4px 6px 7px;
    }
    .scenario-group-title {
      border: 0;
      background: transparent;
      padding: 6px 2px 6px;
      color: var(--muted);
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) max-content;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      min-width: 0;
      text-align: left;
      text-transform: uppercase;
      width: 100%;
    }
    .scenario-group:not(.collapsed) .scenario-group-title {
      border-bottom: 1px solid var(--line);
      margin-bottom: 4px;
    }
    .scenario-group-title:hover {
      color: var(--text);
      cursor: pointer;
    }
    .scenario-group-caret {
      color: var(--muted);
      font-size: 12px;
      line-height: 1;
      text-align: center;
    }
    .scenario-group-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .scenario-group-count {
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
    }
    .scenario-group.collapsed .scenario-group-items { display: none; }
    .scenario-group-items {
      display: grid;
      gap: 2px;
      padding-top: 2px;
    }
    .scenario-item {
      border: 0;
      border-left: 3px solid transparent;
      border-radius: 0;
      padding: 7px 7px 7px 9px;
      background: transparent;
      display: block;
      text-align: left;
      width: 100%;
      min-width: 0;
      white-space: normal;
      overflow: hidden;
      transition: border-color 120ms ease, background 120ms ease;
    }
    .scenario-item:hover { background: var(--hover); }
    .scenario-item.active {
      border-color: var(--accent);
      background: #f4fbf8;
    }
    .scenario-item-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      align-items: start;
      gap: 6px;
    }
    .scenario-name {
      display: block;
      min-width: 0;
      font-weight: 760;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .muted {
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.3;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .scenario-item .muted {
      display: block;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .section {
      border: 0;
      border-left: 3px solid #d7e4f7;
      border-radius: 0;
      padding: 9px 0 9px 10px;
      background: #fbfcfe;
    }
    #scenarioSummary.section {
      border: 0;
      border-radius: 0;
      padding: 0 0 2px;
      background: transparent;
    }
    .section h3 {
      margin: 0 0 6px;
      font-size: 12px;
    }
    .section-heading {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      margin-bottom: 8px;
    }
    .section-heading h3 {
      margin: 0;
    }
    .section-content {
      padding: 0;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--panel-2);
      font-size: 11px;
      color: #344054;
      font-weight: 650;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.bad { background: var(--bad-bg); color: var(--bad); }
    .pill.warn { background: var(--warn-bg); color: var(--warn); }
    .hint {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      min-width: 220px;
    }
    .hint.warn { color: var(--warn); }
    .hint.bad { color: var(--bad); }
    .steps {
      display: grid;
      gap: 0;
    }
    .step {
      border: 0;
      border-top: 1px solid var(--line);
      border-left: 3px solid transparent;
      border-radius: 0;
      display: grid;
      gap: 4px;
      min-width: 0;
      width: 100%;
      background: transparent;
      color: inherit;
    }
    .step:hover { background: var(--hover); }
    .step.active {
      border-left-color: #98a2b3;
      background: #f9fafb;
    }
    .step.reused {
      border-left-color: var(--accent-2);
      background: #f7faff;
    }
    .step.reused.active {
      border-left-color: var(--accent-2);
      background: #f7faff;
    }
    .step-toggle {
      align-items: start;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 6px;
      grid-template-columns: 12px minmax(0, 1fr) max-content;
      min-width: 0;
      padding: 8px 0 8px 8px;
      text-align: left;
      width: 100%;
    }
    .step-caret {
      align-self: start;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.6;
    }
    .step-title-row {
      align-items: start;
      display: grid;
      gap: 6px;
      grid-template-columns: minmax(0, 1fr) max-content;
      min-width: 0;
    }
    .step-title {
      min-width: 0;
      font-weight: 760;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .step-source {
      align-self: start;
      font-size: 11px;
    }
    .step.reused > .step-toggle .step-source {
      background: #eef4ff;
      color: #175cd3;
    }
    .step-code {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 8px 0 8px 26px;
    }
    .step-code-head {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
    }
    .step-code-path {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .definition-code {
      background: var(--terminal);
      border-radius: 6px;
      color: #f3f7ff;
      font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      margin: 0;
      max-height: 260px;
      min-width: 0;
      overflow: auto;
      padding: 10px;
      tab-size: 2;
      white-space: pre;
    }
    .yaml-key { color: #7dd3fc; }
    .yaml-value { color: #fde68a; }
    .yaml-comment { color: #94a3b8; }
    .actions {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 7px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .actions > .button-row {
      display: grid;
      grid-template-columns: repeat(3, max-content);
      gap: 8px;
    }
    .run-summary {
      background: transparent;
      border: 0;
      border-radius: 0;
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 0;
      width: 100%;
    }
    .run-result {
      background: #fff;
      border: 1px solid var(--line);
      border-left: 4px solid #94a3b8;
      border-radius: 6px;
      display: grid;
      gap: 7px;
      min-width: 0;
      padding: 10px 12px;
    }
    .run-result-validate {
      border-left-color: var(--blue);
    }
    .run-result-test {
      border-left-color: var(--primary);
    }
    .run-result-failed {
      background: #fffafa;
      border-color: #fecaca;
    }
    .run-result-failed.run-result-validate {
      border-left-color: var(--blue);
    }
    .run-result-failed.run-result-test {
      border-left-color: var(--primary);
    }
    .run-result-title-row {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      min-width: 0;
    }
    .run-result-heading {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .run-result-kind {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .run-result-title {
      font-size: 13px;
      font-weight: 780;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .run-summary-grid {
      display: grid;
      gap: 6px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      min-width: 0;
    }
    .run-summary-cell {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .run-summary-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .run-summary-value {
      font-size: 12px;
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .run-summary-message {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .run-summary-message div {
      font-size: 12px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .run-summary-message .error { color: var(--bad); }
    .run-summary-message .next { color: var(--warn); }
    .run-step-results {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 0;
      min-width: 0;
      padding-top: 2px;
    }
    .run-step-result {
      align-items: start;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      min-width: 0;
      padding: 6px 0;
    }
    .run-step-result + .run-step-result { border-top: 1px solid var(--line); }
    .run-step-result-main {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .run-step-result-title {
      font-size: 12px;
      font-weight: 750;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .run-step-result-meta {
      color: var(--muted);
      font-size: 11px;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .run-step-result-source {
      font-size: 11px;
      justify-self: end;
    }
    .terminal {
      margin: 0;
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      background: var(--terminal);
      color: #f3f7ff;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      border-top: 1px solid var(--terminal-line);
      tab-size: 2;
    }
    .terminal .ansi-bold { font-weight: 800; }
    .terminal .ansi-dim { opacity: 0.68; }
    .terminal .ansi-grey { color: #98a2b3; }
    .terminal .ansi-cyan { color: #67e8f9; }
    .terminal .ansi-green { color: #86efac; }
    .terminal .ansi-yellow { color: #fde68a; }
    .terminal .ansi-red { color: #fda4af; }
    .server-grid {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 0;
      max-height: 320px;
      overflow: auto;
    }
    .server {
      display: grid;
      grid-template-columns: minmax(54px, 78px) minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      padding: 8px 0;
      min-width: 0;
    }
    .server > strong {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .server-lines {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .server-lines div {
      overflow-wrap: anywhere;
    }
    .empty {
      color: var(--muted);
      border: 0;
      border-radius: 0;
      padding: 10px 0;
      text-align: center;
    }
    @media (max-width: 1100px) {
      main {
        height: auto;
        grid-template-columns: 1fr;
      }
      header { align-items: flex-start; flex-direction: column; gap: 10px; }
      .header-meta { justify-content: flex-start; }
      .section-heading {
        align-items: start;
        grid-template-columns: 1fr;
      }
      .terminal { min-height: 360px; }
    }
    @media (max-height: 560px) and (min-width: 1101px) {
      main {
        height: auto;
        min-height: calc(100vh - 72px);
      }
      .panel { min-height: 300px; }
      .terminal { min-height: 220px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>openapi-k6 UI</h1>
      <div class="subtitle">시나리오 검증/실행</div>
    </div>
    <div class="row header-meta">
      <div id="serverStatus" class="server-status" tabindex="0" aria-label="서버 상태">
        <div id="serverStatusSummary" class="server-status-summary">
          <span class="server-count"><span class="server-dot ok" aria-hidden="true"></span><span id="serverConnectedCount">0</span></span>
          <span class="server-count"><span class="server-dot bad" aria-hidden="true"></span><span id="serverIssueCount">0</span></span>
        </div>
        <div class="server-popover">
          <div class="server-popover-head">
            <strong>서버 상태</strong>
            <button id="checkServersBtn" class="icon-button" type="button" title="서버 다시 확인" aria-label="서버 다시 확인">↻</button>
          </div>
          <span id="serverCheckedAt" class="muted"></span>
          <div id="serverList" class="server-grid"><div class="empty">서버 확인 전</div></div>
        </div>
      </div>
    </div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">시나리오</h2>
        <span id="scenarioCount" class="pill">0</span>
      </div>
      <div class="panel-body">
        <input id="searchInput" placeholder="시나리오 검색">
        <div id="scenarioList" class="scenario-list"></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title" id="detailTitle">시나리오</h2>
        <span id="detailStatus" class="pill">미실행</span>
      </div>
      <div class="panel-body stack">
        <div id="scenarioSummary" class="section">
          <div class="empty">왼쪽에서 시나리오를 선택하세요.</div>
        </div>
        <div class="section">
          <div class="section-heading">
            <h3>최근 실행 결과</h3>
          </div>
          <div id="runSummary" class="run-summary"><div class="muted">실행 기록 없음</div></div>
        </div>
        <div class="section">
          <div id="detailBody" class="section-content empty">왼쪽에서 시나리오를 선택하세요.</div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">실행 로그</h2>
        <span id="runStatus" class="pill">대기</span>
      </div>
      <div class="actions">
        <div class="button-row">
          <button id="validateBtn" class="blue" disabled>validate</button>
          <button id="testBtn" class="primary" disabled>test</button>
          <button id="clearBtn">clear</button>
        </div>
        <span id="runHint" class="hint">시나리오를 선택하세요.</span>
      </div>
      <pre id="output" class="terminal">시나리오를 선택한 뒤 검증/실행하세요.</pre>
    </section>
  </main>
  <div id="connectionOverlay" class="connection-overlay" role="alert" aria-live="assertive">
    <div class="connection-card">
      <div class="connection-title">UI 서버 연결 끊김</div>
      <div id="connectionMessage" class="connection-message">샘플 UI 서버가 실행 중인지 확인하세요.</div>
      <div class="connection-actions">
        <button id="reconnectBtn" class="blue" type="button">재연결</button>
      </div>
    </div>
  </div>
  <script>
    const COLLAPSED_GROUPS_STORAGE_KEY = 'openapi-k6.ui.collapsedScenarioGroups';
    const UI_CONNECTION_CHECK_INTERVAL_MS = 5000;

    const state = {
      scenarios: [],
      selected: null,
      openStepIndexes: new Set(),
      detail: null,
      collapsedGroups: readCollapsedScenarioGroups(),
      lastRun: new Map(),
      runsByScenario: new Map(),
      activeOutputRunId: null,
      uiDisconnected: false,
      serverSummary: { checked: false, moduleCount: 0, connectedServers: 0, failedServers: 0, missingSnapshots: 0, issueModules: 0 }
    };

    const els = {
      scenarioCount: document.getElementById('scenarioCount'),
      scenarioList: document.getElementById('scenarioList'),
      searchInput: document.getElementById('searchInput'),
      detailTitle: document.getElementById('detailTitle'),
      detailStatus: document.getElementById('detailStatus'),
      scenarioSummary: document.getElementById('scenarioSummary'),
      detailBody: document.getElementById('detailBody'),
      serverStatusSummary: document.getElementById('serverStatusSummary'),
      serverConnectedCount: document.getElementById('serverConnectedCount'),
      serverIssueCount: document.getElementById('serverIssueCount'),
      checkServersBtn: document.getElementById('checkServersBtn'),
      serverCheckedAt: document.getElementById('serverCheckedAt'),
      serverList: document.getElementById('serverList'),
      validateBtn: document.getElementById('validateBtn'),
      testBtn: document.getElementById('testBtn'),
      clearBtn: document.getElementById('clearBtn'),
      output: document.getElementById('output'),
      runStatus: document.getElementById('runStatus'),
      runHint: document.getElementById('runHint'),
      runSummary: document.getElementById('runSummary'),
      connectionMessage: document.getElementById('connectionMessage'),
      reconnectBtn: document.getElementById('reconnectBtn')
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderYamlCode(value) {
      return String(value).split('\n').map(renderYamlLine).join('\n');
    }

    function renderYamlLine(line) {
      const commentIndex = findYamlCommentIndex(line);
      const body = commentIndex === -1 ? line : line.slice(0, commentIndex);
      const comment = commentIndex === -1
        ? ''
        : '<span class="yaml-comment">' + escapeHtml(line.slice(commentIndex)) + '</span>';
      const match = body.match(/^(\s*(?:-\s*)?)([A-Za-z0-9_.-]+)(:)(.*)$/);

      if (!match) {
        return escapeHtml(body) + comment;
      }

      return escapeHtml(match[1]) +
        '<span class="yaml-key">' + escapeHtml(match[2]) + '</span>' +
        escapeHtml(match[3]) +
        (match[4] ? '<span class="yaml-value">' + escapeHtml(match[4]) + '</span>' : '') +
        comment;
    }

    function findYamlCommentIndex(line) {
      let quote = null;

      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const previous = line[index - 1];

        if ((char === '"' || char === "'") && previous !== '\\') {
          quote = quote === char ? null : quote || char;
        }

        if (char === '#' && quote === null && (index === 0 || /\s/.test(previous))) {
          return index;
        }
      }

      return -1;
    }

    function formatUiPath(value) {
      return String(value || '').replace(/^openapi-k6\//, '').replace(/^scenarios\//, '');
    }

    function formatStatusLabel(value) {
      const normalized = String(value).toLowerCase();
      if (normalized === 'passed') return '성공';
      if (normalized === 'failed') return '실패';
      if (normalized === 'running') return '실행 중';
      if (normalized === 'not run') return '미실행';
      if (normalized === 'idle') return '대기';
      if (normalized === 'checking') return '확인 중';
      if (normalized === 'reachable') return '연결됨';
      if (normalized === 'unknown') return '알 수 없음';
      if (normalized === 'missing') return '없음';
      if (normalized === 'present') return '있음';
      return String(value);
    }

    function formatCommandLabel(value) {
      return String(value);
    }

    function formatStepCount(value) {
      return value === 1 ? '1단계' : value + '단계';
    }

    function readCollapsedScenarioGroups() {
      try {
        if (typeof localStorage === 'undefined') return new Set();
        const raw = localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
        if (!raw) return new Set();
        const values = JSON.parse(raw);
        if (!Array.isArray(values)) return new Set();
        return new Set(values.filter((value) => typeof value === 'string'));
      } catch {
        return new Set();
      }
    }

    function saveCollapsedScenarioGroups() {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(Array.from(state.collapsedGroups).sort()));
      } catch {
        // Ignore storage failures so the UI still works in restricted browsers.
      }
    }

    function resetOutput() {
      els.output.innerHTML = '';
    }

    function appendOutputChunk(chunk) {
      els.output.insertAdjacentHTML('beforeend', chunk.html !== undefined ? chunk.html : escapeHtml(chunk.chunk || ''));
      els.output.scrollTop = els.output.scrollHeight;
    }

    function appendOutputHtml(html) {
      els.output.insertAdjacentHTML('beforeend', html);
      els.output.scrollTop = els.output.scrollHeight;
    }

    function statusTone(value) {
      const normalized = String(value).toLowerCase();
      if (normalized.includes('passed') || normalized.includes('reachable') || normalized.includes('ready') || normalized.includes('present')) return ' ok';
      if (normalized.includes('failed') || normalized.includes('missing') || normalized.includes('error')) return ' bad';
      if (normalized.includes('running') || normalized.includes('checking') || normalized.includes('warning') || normalized.includes('unknown')) return ' warn';
      return '';
    }

    function setStatus(el, value) {
      el.textContent = formatStatusLabel(value);
      el.className = 'pill' + statusTone(value);
    }

    function setHint(message, tone) {
      els.runHint.textContent = message;
      els.runHint.className = 'hint' + (tone ? ' ' + tone : '');
    }

    function createUiConnectionError(error) {
      const next = new Error('UI 서버 연결 끊김');
      next.name = 'UiConnectionError';
      next.cause = error;
      return next;
    }

    function isUiConnectionError(error) {
      return error instanceof Error && error.name === 'UiConnectionError';
    }

    function setUiDisconnected(error) {
      state.uiDisconnected = true;
      document.body.classList.add('ui-disconnected');
      const reason = error instanceof Error && error.message ? ' 마지막 오류: ' + error.message : '';
      els.connectionMessage.textContent = location.host + '에 연결할 수 없습니다. 샘플 UI 서버가 실행 중인지 확인하세요.' + reason;
      els.validateBtn.disabled = true;
      els.testBtn.disabled = true;
      setHint('UI 서버 연결 끊김. 재연결 후 실행할 수 있습니다.', 'bad');
    }

    function clearUiDisconnected() {
      if (!state.uiDisconnected) return;
      state.uiDisconnected = false;
      document.body.classList.remove('ui-disconnected');
      updateRunHint();
    }

    function updateRunHint() {
      if (state.uiDisconnected) {
        setHint('UI 서버 연결 끊김. 재연결 후 실행할 수 있습니다.', 'bad');
        els.validateBtn.disabled = true;
        els.testBtn.disabled = true;
        return;
      }

      if (!state.selected) {
        setHint('시나리오를 선택하세요.', '');
      } else if (state.serverSummary.missingSnapshots > 0) {
        setHint('OpenAPI 스냅샷이 없습니다. 먼저 openapi-k6 sync를 실행하세요.', 'bad');
      } else if (state.serverSummary.failedServers > 0) {
        setHint('일부 서버에 연결할 수 없습니다. 검증은 가능하지만 실행은 실패할 수 있습니다.', 'warn');
      } else if (state.serverSummary.checked) {
        setHint('검증/실행 준비됨.', '');
      } else {
        setHint('백엔드 상태가 불확실하면 실행 전에 서버를 확인하세요.', 'warn');
      }

      els.validateBtn.title = state.serverSummary.missingSnapshots > 0
        ? 'OpenAPI 스냅샷이 없습니다. 먼저 openapi-k6 sync를 실행하세요.'
        : '';
      els.testBtn.title = state.serverSummary.failedServers > 0
        ? '하나 이상의 대상 서버에 연결할 수 없습니다.'
        : els.validateBtn.title;
    }

    async function fetchJson(url, options) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        setUiDisconnected(error);
        throw createUiConnectionError(error);
      }
      clearUiDisconnected();
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || response.statusText);
      }
      return json;
    }

    async function checkUiConnection() {
      try {
        const response = await fetch('/api/scenarios', { cache: 'no-store' });
        if (!response.ok) return;
        if (state.uiDisconnected) await reconnectUi();
      } catch (error) {
        setUiDisconnected(error);
      }
    }

    async function loadScenarios() {
      const data = await fetchJson('/api/scenarios');
      state.scenarios = data.scenarios;
      renderScenarioList();
      const selectedExists = state.selected && state.scenarios.some((scenario) => scenario.id === state.selected);
      if (selectedExists) {
        await selectScenario(state.selected);
      } else if (state.scenarios.length > 0) {
        state.selected = null;
        await selectScenario(state.scenarios[0].id);
      }
      updateRunHint();
    }

    function renderScenarioList() {
      const query = els.searchInput.value.trim().toLowerCase();
      const items = state.scenarios.filter((scenario) => {
        return !query ||
          scenario.name.toLowerCase().includes(query) ||
          scenario.path.toLowerCase().includes(query) ||
          scenario.group.toLowerCase().includes(query);
      });
      els.scenarioCount.textContent = String(items.length);
      const groups = [];
      for (const scenario of items) {
        let group = groups.find((candidate) => candidate.name === scenario.group);
        if (!group) {
          group = { name: scenario.group, scenarios: [] };
          groups.push(group);
        }
        group.scenarios.push(scenario);
      }
      els.scenarioList.innerHTML = groups.map((group) => {
        const collapsed = !query && state.collapsedGroups.has(group.name);
        return '<div class="scenario-group ' + (collapsed ? 'collapsed' : '') + '" data-group="' + escapeHtml(group.name) + '">' +
          '<button class="scenario-group-title" type="button" data-group="' + escapeHtml(group.name) + '" aria-expanded="' + String(!collapsed) + '">' +
            '<span class="scenario-group-caret" aria-hidden="true">' + (collapsed ? '&gt;' : 'v') + '</span>' +
            '<span class="scenario-group-label">' + escapeHtml(group.name) + '</span>' +
            '<span class="scenario-group-count">' + group.scenarios.length + '</span>' +
          '</button>' +
          '<div class="scenario-group-items">' + group.scenarios.map(renderScenarioItem).join('') + '</div>' +
        '</div>';
      }).join('');

      for (const title of els.scenarioList.querySelectorAll('.scenario-group-title')) {
        title.addEventListener('click', () => toggleScenarioGroup(title.getAttribute('data-group')));
      }
      for (const item of els.scenarioList.querySelectorAll('.scenario-item')) {
        item.addEventListener('click', () => selectScenario(item.getAttribute('data-id')));
      }
    }

    function toggleScenarioGroup(groupName) {
      if (!groupName) return;
      if (state.collapsedGroups.has(groupName)) {
        state.collapsedGroups.delete(groupName);
      } else {
        state.collapsedGroups.add(groupName);
      }
      saveCollapsedScenarioGroups();
      renderScenarioList();
    }

    function renderScenarioItem(scenario) {
        const status = state.lastRun.get(scenario.id) || (scenario.error ? 'failed' : 'not run');
        return '<button class="scenario-item ' + (state.selected === scenario.id ? 'active' : '') + '" data-id="' + escapeHtml(scenario.id) + '" title="' + escapeHtml(scenario.path) + '">' +
          '<div class="scenario-item-head"><span class="scenario-name">' + escapeHtml(scenario.name) + '</span><span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span></div>' +
          '<div class="muted">' + (scenario.stepCount === undefined ? '파싱 오류' : formatStepCount(scenario.stepCount)) + '</div>' +
          '</button>';
    }

    async function selectScenario(id) {
      const previousSelected = state.selected;
      state.selected = id;
      if (previousSelected !== id) state.openStepIndexes.clear();
      const activeItem = findRunById(state.activeOutputRunId);
      if (!activeItem || activeItem.scenario !== id) {
        const latestItem = getLatestScenarioRun(id);
        state.activeOutputRunId = latestItem ? latestItem.id : null;
        if (latestItem) {
          els.output.innerHTML = latestItem.html || '';
          els.output.scrollTop = els.output.scrollHeight;
          setStatus(els.runStatus, latestItem.status);
        } else {
          resetOutput();
          setStatus(els.runStatus, 'idle');
        }
      }
      renderScenarioList();
      try {
        state.detail = await fetchJson('/api/scenario?scenario=' + encodeURIComponent(id));
        renderDetail();
        els.validateBtn.disabled = false;
        els.testBtn.disabled = false;
      } catch (error) {
        state.detail = null;
        state.openStepIndexes.clear();
        const message = isUiConnectionError(error)
          ? '상세 정보를 불러오지 못했습니다.'
          : error.message;
        els.detailTitle.textContent = isUiConnectionError(error) ? '상세 정보' : '시나리오 오류';
        els.scenarioSummary.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
        els.detailBody.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
        els.validateBtn.disabled = true;
        els.testBtn.disabled = true;
      }
      renderRunSummary();
      updateRunHint();
    }

    function renderDetail() {
      const detail = state.detail;
      els.detailTitle.textContent = detail.name;
      setStatus(els.detailStatus, state.lastRun.get(detail.id) || 'not run');
      els.scenarioSummary.innerHTML =
        '<div class="stack" style="gap: 6px;">' +
          '<div class="muted">' + escapeHtml(formatUiPath(detail.path)) + '</div>' +
          '<div class="row"><span class="pill">' + escapeHtml(formatStepCount(detail.stepCount)) + '</span></div>' +
        '</div>';
      for (const index of Array.from(state.openStepIndexes)) {
        if (index >= detail.steps.length) state.openStepIndexes.delete(index);
      }
      const steps = detail.steps.map((step, index) => {
        const sourceText = formatStepSource(step.source);
        const reused = step.source && step.source.kind !== 'direct';
        const active = state.openStepIndexes.has(index);
        const code = step.definition ? step.definition.code : '코드 조각을 찾을 수 없습니다.';
        const codePath = step.definition ? formatUiPath(step.definition.path) : '';
        const codeBlock = active
          ? '<div class="step-code">' +
              '<div class="step-code-head">' +
                '<div class="step-code-path">' + escapeHtml(codePath || step.id) + '</div>' +
              '</div>' +
              '<pre class="definition-code">' + renderYamlCode(code) + '</pre>' +
            '</div>'
          : '';
        return '<div class="step ' + (reused ? 'reused ' : '') + (active ? 'active' : '') + '" data-step-index="' + index + '">' +
          '<button type="button" class="step-toggle" data-step-index="' + index + '" aria-expanded="' + String(active) + '">' +
            '<span class="step-caret" aria-hidden="true">' + (active ? 'v' : '&gt;') + '</span>' +
            '<div class="step-title">' + escapeHtml(step.id) + '</div><span class="pill step-source">' + escapeHtml(sourceText) + '</span>' +
          '</button>' +
          codeBlock +
        '</div>';
      }).join('');
      els.detailBody.className = 'section-content stack';
      els.detailBody.innerHTML = '<div><h3>실행 단계</h3><div class="steps">' + steps + '</div></div>';
      for (const item of els.detailBody.querySelectorAll('.step-toggle')) {
        item.addEventListener('click', () => {
          const nextIndex = Number(item.getAttribute('data-step-index'));
          if (state.openStepIndexes.has(nextIndex)) {
            state.openStepIndexes.delete(nextIndex);
          } else {
            state.openStepIndexes.add(nextIndex);
          }
          renderDetail();
        });
      }
    }

    async function checkServers() {
      setStatus(els.runStatus, 'checking');
      els.serverList.innerHTML = '<div class="empty">서버 확인 중...</div>';
      els.serverCheckedAt.textContent = '확인 중';
      try {
        const result = await fetchJson('/api/check-servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        state.serverSummary = summarizeServerResult(result);
        updateServerStatusSummary();
        els.serverCheckedAt.textContent = formatServerStatusSummaryText(state.serverSummary) + ' · ' + new Date(result.checkedAt).toLocaleTimeString();
        els.serverList.innerHTML = result.modules.map((module) => {
          const snapshot = module.snapshot || { status: 'missing', error: 'snapshot unknown' };
          const serverMeta = formatServerMeta(module);
          const snapshotMeta = formatSnapshotMeta(snapshot);
          return '<div class="server"><strong>' + escapeHtml(module.name) + '</strong><div class="server-lines"><div>' + escapeHtml(module.baseUrl || 'baseUrl 미설정') + '</div><div class="muted">' + escapeHtml(serverMeta) + '</div><div class="muted">' + escapeHtml(snapshotMeta) + '</div></div><span class="pill' + statusTone(module.status) + '">' + escapeHtml(formatStatusLabel(module.status)) + '</span></div>';
        }).join('');
      } catch (error) {
        state.serverSummary = { checked: false, moduleCount: 0, connectedServers: 0, failedServers: 1, missingSnapshots: 0, issueModules: 1 };
        updateServerStatusSummary();
        els.serverStatusSummary.title = '서버 확인 실패';
        els.serverList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        els.serverCheckedAt.textContent = '확인 실패';
      } finally {
        setStatus(els.runStatus, 'idle');
        updateRunHint();
      }
    }

    async function reconnectUi() {
      try {
        await loadScenarios();
        await checkServers();
      } catch (error) {
        if (!isUiConnectionError(error)) {
          els.scenarioList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        }
      }
    }

    function summarizeServerResult(result) {
      const modules = result.modules || [];
      return {
        checked: true,
        moduleCount: modules.length,
        connectedServers: modules.filter((module) => module.status === 'reachable').length,
        failedServers: modules.filter((module) => module.status === 'failed' || module.status === 'unknown').length,
        missingSnapshots: modules.filter((module) => !module.snapshot || module.snapshot.status !== 'present').length,
        issueModules: modules.filter((module) => module.status !== 'reachable' || !module.snapshot || module.snapshot.status !== 'present').length
      };
    }

    function updateServerStatusSummary() {
      els.serverConnectedCount.textContent = String(state.serverSummary.connectedServers || 0);
      els.serverIssueCount.textContent = String(state.serverSummary.issueModules || 0);
      els.serverStatusSummary.title = state.serverSummary.checked
        ? formatServerStatusSummaryText(state.serverSummary)
        : '서버 확인 전';
    }

    function formatServerStatusSummaryText(summary) {
      const modules = summary.moduleCount === 1 ? '1 module' : summary.moduleCount + ' modules';
      const connected = summary.connectedServers === 1 ? '1 connected' : summary.connectedServers + ' connected';
      const missing = summary.missingSnapshots === 1 ? '1 missing snapshot' : summary.missingSnapshots + ' missing snapshots';
      return modules + ' · ' + connected + ' · ' + missing;
    }

    function formatServerMeta(module) {
      const parts = [];
      if (module.status === 'reachable') {
        parts.push('서버 연결됨');
        if (typeof module.httpStatus === 'number') parts.push('/ 응답 HTTP ' + module.httpStatus);
      } else if (module.status === 'unknown') {
        parts.push('baseUrl 미설정');
      }
      if (module.status !== 'reachable' && typeof module.httpStatus === 'number') parts.push('HTTP ' + module.httpStatus);
      if (typeof module.durationMs === 'number') parts.push(module.durationMs + 'ms');
      if (module.source) parts.push(module.source);
      if (module.error) parts.push(module.error);
      return parts.join(' · ') || 'baseUrl 미설정';
    }

    function formatSnapshotMeta(snapshot) {
      const parts = ['스냅샷: ' + formatStatusLabel(snapshot.status)];
      if (snapshot.path) parts.push(formatUiPath(snapshot.path));
      if (snapshot.error) parts.push(snapshot.error);
      return parts.join(' · ');
    }

    function findScenarioName(id) {
      const scenario = state.scenarios.find((candidate) => candidate.id === id);
      return scenario ? scenario.name : id;
    }

    function formatRunHistoryTime(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
    }

    function getScenarioRuns(scenarioId) {
      return state.runsByScenario.get(scenarioId) || {};
    }

    function saveScenarioRun(item) {
      const runs = Object.assign({}, getScenarioRuns(item.scenario));
      runs[item.command] = item;
      state.runsByScenario.set(item.scenario, runs);
    }

    function findRunById(runId) {
      if (!runId) return null;
      for (const runs of state.runsByScenario.values()) {
        for (const item of [runs.validate, runs.test]) {
          if (item && item.id === runId) return item;
        }
      }
      return null;
    }

    function getLatestScenarioRun(scenarioId) {
      const runs = getScenarioRuns(scenarioId);
      const items = [runs.validate, runs.test].filter(Boolean);
      items.sort((left, right) => {
        const leftTime = Date.parse(left.finishedAt || left.startedAt || '');
        const rightTime = Date.parse(right.finishedAt || right.startedAt || '');
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });
      return items[0] || null;
    }

    function formatRunDuration(item) {
      const startedAt = Date.parse(item.startedAt);
      const finishedAt = item.finishedAt ? Date.parse(item.finishedAt) : Date.now();
      if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return '';
      const durationMs = Math.max(0, finishedAt - startedAt);
      if (durationMs < 1000) return durationMs + 'ms';
      if (durationMs < 10000) return (durationMs / 1000).toFixed(1) + 's';
      return Math.round(durationMs / 1000) + 's';
    }

    function stripAnsi(value) {
      return String(value).replace(/\u001b\[[0-9;]*m/g, '');
    }

    function summarizeRunText(value) {
      const lines = stripAnsi(value)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const next = lines.find((line) => line.startsWith('Next:')) || '';
      const error = lines.find((line) => {
        return !line.startsWith('$ openapi-k6 ') &&
          !line.startsWith('Next:') &&
          !line.startsWith('scenario:') &&
          !line.startsWith('base url:') &&
          !line.startsWith('steps:') &&
          !line.startsWith('[') &&
          !line.startsWith('{') &&
          !line.startsWith('Validated ');
      }) || '';
      return { error, next };
    }

    function formatStepSource(source) {
      if (!source || source.kind === 'direct') return '직접 정의';
      if (source.kind === 'use') return '시나리오 사용: ' + (source.reference || '');
      if (source.kind === 'include') return '파일 포함: ' + (source.reference || '');
      return source.kind + ' ' + (source.reference || '');
    }

    function formatStepResultMeta(step) {
      const parts = [];
      const api = ((step.method || '') + ' ' + (step.path || '')).trim();
      if (api) parts.push(api);
      if (typeof step.responseStatus === 'number') parts.push('HTTP ' + step.responseStatus);
      if (typeof step.durationMs === 'number') parts.push(Math.round(step.durationMs) + 'ms');
      return parts.join(' · ');
    }

    function renderRunStepResults(item) {
      if (!item.stepResults || item.stepResults.length === 0) return '';

      return '<div class="run-step-results">' + item.stepResults.map((step) => {
        const index = typeof step.index === 'number' ? step.index + 1 : '';
        const title = (index ? index + '. ' : '') + step.id;
        const status = step.status || 'unknown';
        return '<div class="run-step-result">' +
          '<span class="run-step-result-main">' +
            '<span class="run-step-result-title">' + escapeHtml(title) + ' <span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span></span>' +
            '<span class="run-step-result-meta">' + escapeHtml(formatStepResultMeta(step)) + '</span>' +
          '</span>' +
          '<span class="pill run-step-result-source">' + escapeHtml(formatStepSource(step.source)) + '</span>' +
        '</div>';
      }).join('') + '</div>';
    }

    function renderRunMessage(item, summary) {
      const failedSteps = (item.stepResults || []).filter((step) => step.status === 'failed');
      if (failedSteps.length > 0) {
        return '<div class="run-summary-message">' + failedSteps.map((step) => {
          const source = formatStepSource(step.source);
          return '<div class="error">실패 지점: ' + escapeHtml(step.id) + (source ? ' · ' + escapeHtml(source) : '') + '</div>';
        }).join('') + '</div>';
      }

      if (item.status !== 'failed' || (!summary.error && !summary.next)) return '';

      return '<div class="run-summary-message">' +
        (summary.error ? '<div class="error">' + escapeHtml(summary.error) + '</div>' : '') +
        (summary.next ? '<div class="next">' + escapeHtml(summary.next) + '</div>' : '') +
      '</div>';
    }

    function formatRunResultTitle(item) {
      const command = item.command === 'validate' ? '검증' : item.command === 'test' ? '테스트' : formatCommandLabel(item.command);
      if (item.status === 'passed') return command + ' 통과';
      if (item.status === 'failed') return command + ' 실패';
      if (item.status === 'running') return command + ' 중';
      return command + ' ' + formatStatusLabel(item.status);
    }

    function formatRunResultKind(command) {
      if (command === 'validate') return '정적 검증';
      if (command === 'test') return '실행 테스트';
      return formatCommandLabel(command);
    }

    function formatRunResultClassPart(value) {
      return String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    }

    function renderRunResult(item) {
      const summary = summarizeRunText(item.text);
      const duration = formatRunDuration(item);
      const exitCode = item.exitCode === null || item.exitCode === undefined ? '-' : String(item.exitCode);
      const message = renderRunMessage(item, summary);
      const className = 'run-result run-result-' + formatRunResultClassPart(item.command) + ' run-result-' + formatRunResultClassPart(item.status);

      return '<div class="' + className + '">' +
        '<div class="run-result-title-row">' +
          '<div class="run-result-heading">' +
            '<div class="run-result-kind">' + escapeHtml(formatRunResultKind(item.command)) + '</div>' +
            '<div class="run-result-title">' + escapeHtml(formatRunResultTitle(item)) + '</div>' +
          '</div>' +
          '<span class="pill' + statusTone(item.status) + '">' + escapeHtml(formatStatusLabel(item.status)) + '</span>' +
        '</div>' +
        '<div class="run-summary-grid">' +
          '<div class="run-summary-cell"><div class="run-summary-label">종료코드</div><div class="run-summary-value">' + escapeHtml(exitCode) + '</div></div>' +
          '<div class="run-summary-cell"><div class="run-summary-label">소요시간</div><div class="run-summary-value">' + escapeHtml(duration) + '</div></div>' +
          '<div class="run-summary-cell"><div class="run-summary-label">시각</div><div class="run-summary-value">' + escapeHtml(formatRunHistoryTime(item.finishedAt || item.startedAt)) + '</div></div>' +
        '</div>' +
        message +
        renderRunStepResults(item) +
      '</div>';
    }

    function renderRunSummary() {
      if (!state.selected) {
        els.runSummary.innerHTML = '<div class="muted">이 시나리오 실행 기록 없음</div>';
        return;
      }

      const runs = getScenarioRuns(state.selected);
      const items = [runs.validate, runs.test].filter(Boolean);
      if (items.length === 0) {
        els.runSummary.innerHTML = '<div class="muted">이 시나리오 실행 기록 없음</div>';
        return;
      }

      els.runSummary.innerHTML = items.map(renderRunResult).join('');
    }

    function clearRunOutput() {
      state.activeOutputRunId = null;
      resetOutput();
      setStatus(els.runStatus, 'idle');
      renderRunSummary();
    }

    async function runCommand(command) {
      const runScenario = state.selected;
      if (!runScenario) return;
      setStatus(els.runStatus, 'running');
      resetOutput();
      let result;
      try {
        result = await fetchJson('/api/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: command, scenario: runScenario })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(els.runStatus, 'failed');
        appendOutputHtml(escapeHtml(message + '\n'));
        updateRunHint();
        return;
      }

      const runItem = {
        id: result.runId,
        command,
        scenario: runScenario,
        scenarioName: findScenarioName(runScenario),
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        html: '',
        text: '',
        stepResults: []
      };
      saveScenarioRun(runItem);
      state.activeOutputRunId = result.runId;
      state.lastRun.set(runScenario, 'running');
      if (state.selected === runScenario) {
        setStatus(els.detailStatus, 'running');
      }
      renderScenarioList();
      renderRunSummary();

      const events = new EventSource('/api/runs/' + encodeURIComponent(result.runId) + '/events');
      events.addEventListener('chunk', (event) => {
        const data = JSON.parse(event.data);
        const html = data.html !== undefined ? data.html : escapeHtml(data.chunk || '');
        runItem.html += html;
        runItem.text += data.chunk || '';
        if (state.activeOutputRunId === result.runId) {
          appendOutputChunk(data);
        }
        if (state.selected === runScenario) {
          renderRunSummary();
        }
      });
      events.addEventListener('test-result', (event) => {
        const data = JSON.parse(event.data);
        runItem.stepResults = Array.isArray(data.steps) ? data.steps : [];
        if (state.selected === runScenario) {
          renderRunSummary();
        }
      });
      events.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        runItem.status = data.status;
        runItem.finishedAt = new Date().toISOString();
        runItem.exitCode = data.exitCode;
        state.lastRun.set(runScenario, data.status);
        if (state.activeOutputRunId === result.runId) {
          setStatus(els.runStatus, data.status);
        }
        if (state.selected === runScenario) {
          setStatus(els.detailStatus, data.status);
          renderRunSummary();
        }
        renderScenarioList();
        updateRunHint();
        events.close();
      });
      events.onerror = () => {
        if (runItem.status === 'running') {
          setUiDisconnected(new Error('실행 로그 연결이 끊겼습니다.'));
          runItem.status = 'failed';
          runItem.finishedAt = new Date().toISOString();
          runItem.exitCode = 1;
          runItem.html += escapeHtml('\nEvent stream disconnected.\n');
          runItem.text += '\nEvent stream disconnected.\n';
          state.lastRun.set(runScenario, 'failed');
          if (state.activeOutputRunId === result.runId) {
            appendOutputHtml(escapeHtml('\nEvent stream disconnected.\n'));
            setStatus(els.runStatus, 'failed');
          }
          if (state.selected === runScenario) {
            setStatus(els.detailStatus, 'failed');
            renderRunSummary();
          }
          renderScenarioList();
          updateRunHint();
        }
        events.close();
      };
    }

    els.searchInput.addEventListener('input', renderScenarioList);
    els.checkServersBtn.addEventListener('click', checkServers);
    els.reconnectBtn.addEventListener('click', reconnectUi);
    els.validateBtn.addEventListener('click', () => runCommand('validate'));
    els.testBtn.addEventListener('click', () => runCommand('test'));
    els.clearBtn.addEventListener('click', clearRunOutput);
    setInterval(checkUiConnection, UI_CONNECTION_CHECK_INTERVAL_MS);

    loadScenarios().then(checkServers).catch((error) => {
      const message = isUiConnectionError(error)
        ? '시나리오 목록을 불러오지 못했습니다.'
        : error.message;
      els.scenarioList.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
    });
  </script>
</body>
</html>`;
