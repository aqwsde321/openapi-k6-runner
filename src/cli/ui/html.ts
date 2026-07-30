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
    .header-action-button {
      align-items: center;
      display: inline-flex;
      gap: 6px;
      height: 30px;
      padding: 0 10px;
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
    .report-modal {
      align-items: center;
      background: rgba(16, 24, 40, 0.48);
      display: grid;
      inset: 0;
      justify-content: center;
      padding: 18px;
      position: fixed;
      z-index: 45;
    }
    .report-modal[hidden] {
      display: none;
    }
    .report-modal-card {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      box-shadow: 0 24px 60px rgba(16, 24, 40, 0.22);
      display: grid;
      grid-template-rows: max-content minmax(0, 1fr);
      max-height: min(86vh, 900px);
      max-width: 980px;
      min-width: 0;
      overflow: hidden;
      width: min(100%, 980px);
    }
    .report-modal-head {
      align-items: start;
      background: #fbfcfe;
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 10px;
      grid-template-columns: minmax(0, 1fr) max-content;
      padding: 14px 16px;
    }
    .report-modal-controls {
      align-items: start;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      min-width: 0;
    }
    .report-modal-title {
      font-size: 15px;
      font-weight: 800;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-modal-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-modal-body {
      display: grid;
      gap: 12px;
      min-height: 0;
      overflow: auto;
      padding: 14px 16px;
    }
    .report-modal-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .report-action-group {
      align-items: center;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 34px;
      padding: 3px;
    }
    .report-action-group + .report-action-group {
      border-color: #c8d1df;
    }
    .report-modal-controls > .icon-button {
      background: #fff;
      border-color: #c8d1df;
    }
    .report-modal-select {
      border: 0;
      background: #fff;
      color: var(--text);
      font-size: 12px;
      font-weight: 650;
      max-width: 220px;
      min-height: 30px;
      padding: 5px 8px;
      width: auto;
    }
    .report-picker-card {
      align-items: center;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      padding: 9px 10px;
    }
    .report-picker-title {
      font-size: 12px;
      font-weight: 800;
    }
    .report-picker-card .report-modal-select {
      border: 1px solid var(--line);
      max-width: min(420px, 50vw);
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
    .panel-subhead {
      align-items: center;
      background: #fbfcfe;
      border-bottom: 1px solid var(--line);
      display: grid;
      flex-shrink: 0;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      padding: 9px 12px;
    }
    .panel-title { margin: 0; font-size: 13px; font-weight: 750; }
    .panel-body { padding: 12px; overflow: auto; min-height: 0; }
    .nav-tabs {
      background: #fff;
      border-bottom: 1px solid var(--line);
      display: grid;
      flex-shrink: 0;
      gap: 6px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 8px 12px;
    }
    .nav-tab {
      border-radius: 6px;
      color: var(--muted);
      min-width: 0;
      padding: 6px 8px;
    }
    .nav-tab.active {
      background: var(--panel-2);
      border-color: #b8c0cc;
      color: var(--text);
    }
    .scenario-tools {
      background: #fff;
      border-bottom: 1px solid var(--line);
      display: grid;
      flex-shrink: 0;
      gap: 8px;
      padding: 10px 12px;
    }
    .scenario-actions {
      display: grid;
      gap: 6px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .scenario-action-button {
      padding: 6px 8px;
      min-width: 0;
      font-size: 12px;
    }
    input, button, select {
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
    .sr-only {
      border: 0;
      clip: rect(0, 0, 0, 0);
      height: 1px;
      margin: -1px;
      overflow: hidden;
      padding: 0;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
    .scenario-list {
      display: grid;
      gap: 2px;
    }
    .scenario-group {
      display: grid;
      gap: 0;
      min-width: 0;
    }
    .scenario-group-title {
      border: 0;
      background: transparent;
      border-radius: 4px;
      padding: 6px 4px;
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
    .scenario-group-title:hover {
      background: var(--hover);
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
    .scenario-group.collapsed > .scenario-group-items { display: none; }
    .scenario-group-items {
      display: grid;
      gap: 2px;
      margin-left: 13px;
      padding: 2px 0 2px 9px;
      border-left: 1px solid var(--line);
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
    .suite-scenario-list,
    .suite-result-list,
    .report-scenario-list {
      display: grid;
      gap: 4px;
    }
    .suite-scenario,
    .suite-result-scenario {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 4px;
      padding: 8px 0;
    }
    .suite-scenario:first-child,
    .suite-result-scenario:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .suite-scenario-head,
    .suite-result-scenario-head,
    .report-scenario-head {
      align-items: start;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
    }
    .suite-scenario-name,
    .suite-result-scenario-name,
    .report-scenario-name {
      font-weight: 760;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-scenario-list {
      gap: 8px;
    }
    .report-scenario {
      background: #fff;
      border: 1px solid var(--line);
      border-left: 4px solid #98a2b3;
      border-radius: 6px;
      display: grid;
      gap: 5px;
      padding: 10px 12px;
    }
    .report-scenario.ok {
      background: #fbfffd;
      border-left-color: var(--ok);
    }
    .report-scenario.bad {
      background: #fffafa;
      border-left-color: var(--bad);
    }
    .report-scenario.warn {
      background: #fffcf3;
      border-left-color: var(--warn);
    }
    .report-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .report-actions a,
    .report-actions button,
    .report-modal-actions a,
    .report-modal-actions button {
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      padding: 6px 9px;
      text-decoration: none;
    }
    .report-actions a:hover,
    .report-actions button:hover:not(:disabled),
    .report-modal-actions a:hover,
    .report-modal-actions button:hover:not(:disabled) {
      background: var(--hover);
      border-color: #b8c0cc;
    }
    .report-scenario-failure {
      color: var(--bad);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-failure-summary {
      background: #fffafa;
      border: 1px solid #fecaca;
      border-left: 4px solid var(--bad);
      border-radius: 6px;
      display: grid;
      gap: 7px;
      padding: 10px 12px;
    }
    .report-failure-summary.ok {
      background: #f6fef9;
      border-color: #abefc6;
      border-left-color: var(--ok);
    }
    .report-failure-title {
      color: var(--bad);
      font-size: 13px;
      font-weight: 800;
    }
    .report-failure-summary.ok .report-failure-title { color: var(--ok); }
    .report-failure-list {
      display: grid;
      gap: 6px;
    }
    .report-failure-item {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .report-failure-main {
      font-size: 12px;
      font-weight: 760;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-file-card {
      background: #fff;
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      border-radius: 6px;
      display: grid;
      gap: 8px;
      padding: 10px 12px;
    }
    .report-file-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .report-shortcut {
      align-items: center;
      background: #fff;
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      border-radius: 6px;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      padding: 9px 10px;
    }
    .report-shortcut-title {
      font-size: 12px;
      font-weight: 800;
    }
    .report-shortcut-meta {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-section-head {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
    }
    .report-section-head h3 {
      margin: 0;
    }
    .report-explanation-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .report-explanation-card {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 9px 10px;
    }
    .report-explanation-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .report-explanation-title {
      font-size: 12px;
      font-weight: 800;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .report-explanation-text {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
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
    .scenario-description {
      color: var(--text);
      font-size: 12px;
      line-height: 1.45;
      max-width: 76ch;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .execution-config {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 6px;
      padding-top: 7px;
    }
    .execution-target {
      align-items: start;
      display: grid;
      gap: 6px;
      grid-template-columns: max-content minmax(0, 1fr);
      min-width: 0;
    }
    .execution-config-title,
    .execution-target-module {
      font-size: 11px;
      font-weight: 800;
    }
    .execution-target-url {
      font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
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
    .run-results-heading h3 {
      font-size: 12px;
      margin: 0;
    }
    .run-values-toggle {
      align-items: center;
      background: transparent;
      border-color: transparent;
      color: var(--muted);
      display: inline-flex;
      font-size: 11px;
      font-weight: 750;
      min-height: 22px;
      padding: 2px 6px;
    }
    .run-values-toggle:hover:not(:disabled) {
      background: var(--panel-2);
      border-color: var(--line);
      color: var(--text);
    }
    .run-values-toggle:disabled {
      background: transparent;
      border-color: transparent;
      color: #98a2b3;
      opacity: 1;
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
    .run-input-prompt {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 7px;
      min-width: 0;
      padding-top: 8px;
    }
    .run-input-title {
      color: var(--text);
      font-size: 12px;
      font-weight: 750;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .run-input-meta {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .run-input-form {
      display: grid;
      gap: 6px;
      grid-template-columns: minmax(0, 1fr) max-content;
      min-width: 0;
    }
    .run-input-form input {
      background: #fff;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      color: var(--text);
      font: 12px/1.2 inherit;
      height: 30px;
      min-width: 0;
      padding: 0 9px;
    }
    .run-input-form button {
      border-radius: 6px;
      font-size: 12px;
      height: 30px;
      padding: 0 10px;
      white-space: nowrap;
    }
    .run-step-results {
      border-top: 1px solid var(--line);
      display: grid;
      gap: 0;
      min-width: 0;
      padding-top: 2px;
    }
    .run-step-result {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 6px 0;
    }
    .run-step-result + .run-step-result { border-top: 1px solid var(--line); }
    .run-step-result-row {
      align-items: start;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) max-content;
      min-width: 0;
    }
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
    .run-step-result-actions {
      align-items: center;
      display: flex;
      gap: 6px;
      justify-self: end;
      min-width: 0;
    }
    .run-step-copy {
      border-radius: 6px;
      font-size: 11px;
      height: 24px;
      padding: 0 8px;
    }
    .run-step-values {
      border-left: 2px solid var(--line);
      display: grid;
      gap: 7px;
      min-width: 0;
      padding-left: 9px;
    }
    .run-step-value {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .run-step-value-title {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .run-step-value-code {
      background: var(--terminal);
      border-radius: 6px;
      color: #f3f7ff;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      margin: 0;
      max-height: 220px;
      min-width: 0;
      overflow: auto;
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
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
      padding-right: 48px;
      tab-size: 2;
    }
    .terminal-frame {
      display: flex;
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .log-copy-button {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.24);
      color: #f3f7ff;
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 1;
    }
    .log-copy-button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.42);
    }
    .copy-icon {
      display: block;
      height: 15px;
      position: relative;
      width: 15px;
    }
    .copy-icon::before,
    .copy-icon::after {
      border: 1.6px solid currentColor;
      border-radius: 2px;
      content: "";
      height: 10px;
      position: absolute;
      width: 9px;
    }
    .copy-icon::before {
      left: 1px;
      opacity: 0.58;
      top: 1px;
    }
    .copy-icon::after {
      background: var(--terminal);
      left: 4px;
      top: 4px;
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
      <div class="subtitle">시나리오·스위트 검증/실행</div>
    </div>
    <div class="row header-meta">
      <button id="reportsBtn" class="header-action-button" type="button">
        리포트 <span id="reportCount" class="pill">0</span>
      </button>
      <div id="serverStatus" class="server-status" tabindex="0" aria-label="실행 설정">
        <div id="serverStatusSummary" class="server-status-summary">
          <span class="server-count"><span class="server-dot ok" aria-hidden="true"></span><span id="serverConnectedCount">0</span></span>
          <span class="server-count"><span class="server-dot bad" aria-hidden="true"></span><span id="serverIssueCount">0</span></span>
        </div>
        <div class="server-popover">
          <div class="server-popover-head">
            <strong>실행 설정</strong>
            <button id="checkServersBtn" class="icon-button" type="button" title="서버 다시 확인" aria-label="서버 다시 확인">↻</button>
          </div>
          <span id="serverConfigMeta" class="muted">config 확인 전</span>
          <span id="serverCheckedAt" class="muted"></span>
          <div id="serverList" class="server-grid"><div class="empty">서버 확인 전</div></div>
        </div>
      </div>
    </div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-head">
        <h2 id="listTitle" class="panel-title">시나리오</h2>
        <span id="scenarioCount" class="pill">0</span>
      </div>
      <div class="nav-tabs" role="tablist" aria-label="탐색 대상">
        <button id="scenarioTabBtn" class="nav-tab active" type="button">시나리오</button>
        <button id="suiteTabBtn" class="nav-tab" type="button">스위트</button>
      </div>
      <div class="scenario-tools">
        <input id="searchInput" placeholder="시나리오 검색">
        <div class="scenario-actions">
          <button id="collapseGroupsBtn" class="scenario-action-button" type="button">전체 접기</button>
          <button id="expandGroupsBtn" class="scenario-action-button" type="button">전체 펼치기</button>
        </div>
      </div>
      <div class="panel-body">
        <div id="scenarioList" class="scenario-list"></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title" id="detailTitle">시나리오</h2>
        <span id="detailStatus" class="pill">미실행</span>
      </div>
      <div class="panel-subhead run-results-heading">
        <h3 id="runSummaryTitle">최근 실행 결과</h3>
        <button id="runValuesToggle" class="run-values-toggle" type="button" disabled>요청/응답 보기</button>
      </div>
      <div class="panel-body stack">
        <div id="scenarioSummary" class="section">
          <div class="empty">왼쪽에서 시나리오를 선택하세요.</div>
        </div>
        <div class="section run-results-section">
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
      <div class="terminal-frame">
        <button id="copyLogBtn" class="icon-button log-copy-button" type="button" disabled aria-label="실행 로그 복사" title="실행 로그 복사">
          <span class="copy-icon" aria-hidden="true"></span>
          <span class="sr-only">실행 로그 복사</span>
        </button>
        <pre id="output" class="terminal">시나리오를 선택한 뒤 검증/실행하세요.</pre>
      </div>
    </section>
  </main>
  <div id="reportModal" class="report-modal" role="dialog" aria-modal="true" aria-labelledby="reportModalTitle" hidden>
    <div class="report-modal-card">
      <div class="report-modal-head">
        <div>
          <div id="reportModalTitle" class="report-modal-title">종합 리포트</div>
          <div id="reportModalMeta" class="report-modal-meta"></div>
        </div>
        <div class="report-modal-controls">
          <div id="reportModalActions" class="report-modal-actions"></div>
          <button id="reportModalCloseBtn" class="icon-button" type="button" aria-label="리포트 닫기" title="리포트 닫기">×</button>
        </div>
      </div>
      <div id="reportModalBody" class="report-modal-body">
        <div class="empty">리포트 없음</div>
      </div>
    </div>
  </div>
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
    const COLLAPSED_SUITE_GROUPS_STORAGE_KEY = 'openapi-k6.ui.collapsedSuiteGroups';
    const UI_CONNECTION_CHECK_INTERVAL_MS = 5000;

    const state = {
      mode: 'scenario',
      scenarios: [],
      suites: [],
      reports: [],
      selectedKind: 'scenario',
      selected: null,
      openStepIndexes: new Set(),
      detail: null,
      collapsedGroups: readCollapsedScenarioGroups(),
      collapsedSuiteGroups: readCollapsedGroups(COLLAPSED_SUITE_GROUPS_STORAGE_KEY),
      reportModalReportId: null,
      reportModalReport: null,
      reportModalFailuresOnly: false,
      showRunValues: false,
      lastRun: new Map(),
      lastSuiteRun: new Map(),
      runsByScenario: new Map(),
      runsBySuite: new Map(),
      activeOutputRunId: null,
      uiDisconnected: false,
      executionConfig: { configPath: '', defaultModule: '', moduleOption: '', modules: [] },
      serverSummary: { checked: false, moduleCount: 0, connectedServers: 0, failedServers: 0, missingSnapshots: 0, issueModules: 0 }
    };

    const els = {
      listTitle: document.getElementById('listTitle'),
      scenarioCount: document.getElementById('scenarioCount'),
      scenarioTabBtn: document.getElementById('scenarioTabBtn'),
      suiteTabBtn: document.getElementById('suiteTabBtn'),
      reportsBtn: document.getElementById('reportsBtn'),
      reportCount: document.getElementById('reportCount'),
      scenarioList: document.getElementById('scenarioList'),
      searchInput: document.getElementById('searchInput'),
      collapseGroupsBtn: document.getElementById('collapseGroupsBtn'),
      expandGroupsBtn: document.getElementById('expandGroupsBtn'),
      detailTitle: document.getElementById('detailTitle'),
      detailStatus: document.getElementById('detailStatus'),
      scenarioSummary: document.getElementById('scenarioSummary'),
      detailBody: document.getElementById('detailBody'),
      runSummaryTitle: document.getElementById('runSummaryTitle'),
      serverStatusSummary: document.getElementById('serverStatusSummary'),
      serverConnectedCount: document.getElementById('serverConnectedCount'),
      serverIssueCount: document.getElementById('serverIssueCount'),
      checkServersBtn: document.getElementById('checkServersBtn'),
      serverConfigMeta: document.getElementById('serverConfigMeta'),
      serverCheckedAt: document.getElementById('serverCheckedAt'),
      serverList: document.getElementById('serverList'),
      validateBtn: document.getElementById('validateBtn'),
      testBtn: document.getElementById('testBtn'),
      copyLogBtn: document.getElementById('copyLogBtn'),
      clearBtn: document.getElementById('clearBtn'),
      runValuesToggle: document.getElementById('runValuesToggle'),
      output: document.getElementById('output'),
      runStatus: document.getElementById('runStatus'),
      runHint: document.getElementById('runHint'),
      runSummary: document.getElementById('runSummary'),
      reportModal: document.getElementById('reportModal'),
      reportModalTitle: document.getElementById('reportModalTitle'),
      reportModalMeta: document.getElementById('reportModalMeta'),
      reportModalActions: document.getElementById('reportModalActions'),
      reportModalBody: document.getElementById('reportModalBody'),
      reportModalCloseBtn: document.getElementById('reportModalCloseBtn'),
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
      if (normalized === 'pass') return '성공';
      if (normalized === 'fail') return '실패';
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

    function formatScenarioCount(value) {
      return value === 1 ? '1개 시나리오' : value + '개 시나리오';
    }

    function readCollapsedScenarioGroups() {
      return readCollapsedGroups(COLLAPSED_GROUPS_STORAGE_KEY);
    }

    function readCollapsedGroups(storageKey) {
      try {
        if (typeof localStorage === 'undefined') return new Set();
        const raw = localStorage.getItem(storageKey);
        if (!raw) return new Set();
        const values = JSON.parse(raw);
        if (!Array.isArray(values)) return new Set();
        return new Set(values.filter((value) => typeof value === 'string'));
      } catch {
        return new Set();
      }
    }

    function saveCollapsedScenarioGroups() {
      saveCollapsedGroups(COLLAPSED_GROUPS_STORAGE_KEY, state.collapsedGroups);
    }

    function saveCollapsedSuiteGroups() {
      saveCollapsedGroups(COLLAPSED_SUITE_GROUPS_STORAGE_KEY, state.collapsedSuiteGroups);
    }

    function saveCollapsedGroups(storageKey, groups) {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(storageKey, JSON.stringify(Array.from(groups).sort()));
      } catch {
        // Ignore storage failures so the UI still works in restricted browsers.
      }
    }

    function resetOutput() {
      els.output.innerHTML = '';
      updateCopyLogButton();
    }

    function appendOutputChunk(chunk) {
      els.output.insertAdjacentHTML('beforeend', chunk.html !== undefined ? chunk.html : escapeHtml(chunk.chunk || ''));
      els.output.scrollTop = els.output.scrollHeight;
      updateCopyLogButton();
    }

    function appendOutputHtml(html) {
      els.output.insertAdjacentHTML('beforeend', html);
      els.output.scrollTop = els.output.scrollHeight;
      updateCopyLogButton();
    }

    function statusTone(value) {
      const normalized = String(value).toLowerCase();
      if (normalized === 'pass' || normalized.includes('passed') || normalized.includes('reachable') || normalized.includes('ready') || normalized.includes('present')) return ' ok';
      if (normalized === 'fail' || normalized.includes('failed') || normalized.includes('missing') || normalized.includes('error')) return ' bad';
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
      const target = state.selectedKind === 'suite' ? '스위트' : '시나리오';
      if (state.uiDisconnected) {
        setHint('UI 서버 연결 끊김. 재연결 후 실행할 수 있습니다.', 'bad');
        els.validateBtn.disabled = true;
        els.testBtn.disabled = true;
        return;
      }

      if (!state.selected) {
        setHint(state.mode === 'suite' ? '스위트를 선택하세요.' : '시나리오를 선택하세요.', '');
      } else if (state.serverSummary.missingSnapshots > 0) {
        setHint('OpenAPI 스냅샷이 없습니다. 먼저 openapi-k6 sync를 실행하세요.', 'bad');
      } else if (state.serverSummary.failedServers > 0) {
        setHint('일부 서버에 연결할 수 없습니다. 검증은 가능하지만 실행은 실패할 수 있습니다.', 'warn');
      } else if (state.serverSummary.checked) {
        setHint(target + ' 검증/실행 준비됨.', '');
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
      state.executionConfig.configPath = data.configPath || '';
      state.executionConfig.defaultModule = data.defaultModule || '';
      await loadSuites();
      await loadReports();
      renderCurrentList();
      const selectedExists = state.selectedKind === 'scenario' && state.selected && state.scenarios.some((scenario) => scenario.id === state.selected);
      if (selectedExists) {
        await selectScenario(state.selected);
      } else if (state.scenarios.length > 0) {
        state.selected = null;
        await selectScenario(state.scenarios[0].id);
      }
      updateRunHint();
    }

    async function loadSuites() {
      const data = await fetchJson('/api/suites');
      state.suites = data.suites;
    }

    async function loadReports() {
      const data = await fetchJson('/api/reports');
      state.reports = data.reports;
      els.reportCount.textContent = String(state.reports.length);
    }

    function switchListMode(mode) {
      state.mode = mode;
      els.searchInput.placeholder = mode === 'suite' ? '스위트 검색' : '시나리오 검색';
      renderCurrentList();
      if (mode === 'suite' && state.selectedKind !== 'suite' && state.suites.length > 0) {
        selectSuite(state.suites[0].id);
      } else if (mode === 'scenario' && state.selectedKind !== 'scenario' && state.scenarios.length > 0) {
        selectScenario(state.scenarios[0].id);
      } else {
        updateRunHint();
      }
    }

    function renderCurrentList() {
      if (state.mode === 'suite') {
        renderSuiteList();
      } else {
        renderScenarioList();
      }
      els.listTitle.textContent = state.mode === 'suite' ? '스위트' : '시나리오';
      els.scenarioTabBtn.classList.toggle('active', state.mode === 'scenario');
      els.suiteTabBtn.classList.toggle('active', state.mode === 'suite');
    }

    function renderScenarioList() {
      const query = els.searchInput.value.trim().toLowerCase();
      const items = state.scenarios.filter((scenario) => {
        return !query ||
          scenario.name.toLowerCase().includes(query) ||
          scenario.path.toLowerCase().includes(query) ||
          scenario.group.toLowerCase().includes(query) ||
          (scenario.description || '').toLowerCase().includes(query);
      });
      els.scenarioCount.textContent = String(items.length);
      els.scenarioList.innerHTML = renderTreeNodes(
        buildItemTree(items, (scenario) => scenario.group),
        {
          query,
          collapsedGroups: state.collapsedGroups,
          renderItem: renderScenarioItem,
        },
      );

      for (const title of els.scenarioList.querySelectorAll('.scenario-group-title')) {
        title.addEventListener('click', () => toggleScenarioGroup(title.getAttribute('data-group')));
      }
      for (const item of els.scenarioList.querySelectorAll('.scenario-item')) {
        item.addEventListener('click', () => selectScenario(item.getAttribute('data-id')));
      }
    }

    function renderSuiteList() {
      const query = els.searchInput.value.trim().toLowerCase();
      const items = state.suites.filter((suite) => {
        return !query ||
          suite.name.toLowerCase().includes(query) ||
          suite.path.toLowerCase().includes(query) ||
          suite.group.toLowerCase().includes(query) ||
          (suite.description || '').toLowerCase().includes(query) ||
          (suite.scenarios || []).some((scenario) => scenario.toLowerCase().includes(query));
      });
      els.scenarioCount.textContent = String(items.length);
      els.scenarioList.innerHTML = renderTreeNodes(
        buildItemTree(items, (suite) => suite.group),
        {
          query,
          collapsedGroups: state.collapsedSuiteGroups,
          renderItem: renderSuiteItem,
        },
      );

      for (const title of els.scenarioList.querySelectorAll('.scenario-group-title')) {
        title.addEventListener('click', () => toggleSuiteGroup(title.getAttribute('data-group')));
      }
      for (const item of els.scenarioList.querySelectorAll('.scenario-item')) {
        item.addEventListener('click', () => selectSuite(item.getAttribute('data-id')));
      }
    }

    function buildItemTree(items, getGroup) {
      const root = createTreeNode('', '', 0);
      for (const item of items) {
        const parts = splitTreeGroup(getGroup(item));
        let node = root;
        let key = '';
        for (const part of parts) {
          key = key ? key + '/' + part : part;
          let child = node.children.find((candidate) => candidate.key === key);
          if (!child) {
            child = createTreeNode(part, key, node.depth + 1);
            node.children.push(child);
          }
          child.count += 1;
          node = child;
        }
        node.items.push(item);
      }
      return root.children;
    }

    function createTreeNode(label, key, depth) {
      return {
        label,
        key,
        depth,
        count: 0,
        children: [],
        items: [],
      };
    }

    function splitTreeGroup(group) {
      const value = String(group || 'root').trim();
      if (!value || value === 'root') return ['root'];
      return value.split('/').filter(Boolean);
    }

    function renderTreeNodes(nodes, options) {
      return nodes.map((node) => renderTreeNode(node, options)).join('');
    }

    function renderTreeNode(node, options) {
      const collapsed = !options.query && options.collapsedGroups.has(node.key);
      const children = renderTreeNodes(node.children, options) + node.items.map(options.renderItem).join('');
      return '<div class="scenario-group ' + (collapsed ? 'collapsed' : '') + '" data-group="' + escapeHtml(node.key) + '">' +
        '<button class="scenario-group-title" type="button" data-group="' + escapeHtml(node.key) + '" aria-expanded="' + String(!collapsed) + '">' +
          '<span class="scenario-group-caret" aria-hidden="true">' + (collapsed ? '&gt;' : 'v') + '</span>' +
          '<span class="scenario-group-label">' + escapeHtml(node.label) + '</span>' +
          '<span class="scenario-group-count">' + node.count + '</span>' +
        '</button>' +
        '<div class="scenario-group-items">' + children + '</div>' +
      '</div>';
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

    function toggleSuiteGroup(groupName) {
      if (!groupName) return;
      if (state.collapsedSuiteGroups.has(groupName)) {
        state.collapsedSuiteGroups.delete(groupName);
      } else {
        state.collapsedSuiteGroups.add(groupName);
      }
      saveCollapsedSuiteGroups();
      renderSuiteList();
    }

    function collapseAllScenarioGroups() {
      if (state.mode === 'suite') {
        collectTreeGroupKeys(state.suites, (suite) => suite.group, state.collapsedSuiteGroups);
        saveCollapsedSuiteGroups();
      } else {
        collectTreeGroupKeys(state.scenarios, (scenario) => scenario.group, state.collapsedGroups);
        saveCollapsedScenarioGroups();
      }
      renderCurrentList();
    }

    function collectTreeGroupKeys(items, getGroup, target) {
      for (const item of items) {
        let key = '';
        for (const part of splitTreeGroup(getGroup(item))) {
          key = key ? key + '/' + part : part;
          target.add(key);
        }
      }
    }

    function expandAllScenarioGroups() {
      if (state.mode === 'suite') {
        state.collapsedSuiteGroups.clear();
        saveCollapsedSuiteGroups();
      } else {
        state.collapsedGroups.clear();
        saveCollapsedScenarioGroups();
      }
      renderCurrentList();
    }

    function renderScenarioItem(scenario) {
        const status = state.lastRun.get(scenario.id) || (scenario.error ? 'failed' : 'not run');
        const label = formatScenarioListLabel(scenario);
        return '<button class="scenario-item ' + (state.selectedKind === 'scenario' && state.selected === scenario.id ? 'active' : '') + '" data-id="' + escapeHtml(scenario.id) + '" title="' + escapeHtml(formatScenarioItemTitle(scenario)) + '">' +
          '<div class="scenario-item-head"><span class="scenario-name">' + escapeHtml(label) + '</span><span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span></div>' +
          '<div class="muted">' + (scenario.stepCount === undefined ? '파싱 오류' : formatStepCount(scenario.stepCount)) + '</div>' +
          '</button>';
    }

    function renderSuiteItem(suite) {
        const status = state.lastSuiteRun.get(suite.id) || (suite.error ? 'failed' : 'not run');
        const count = suite.scenarioCount === undefined ? '파싱 오류' : formatScenarioCount(suite.scenarioCount);
        return '<button class="scenario-item ' + (state.selectedKind === 'suite' && state.selected === suite.id ? 'active' : '') + '" data-id="' + escapeHtml(suite.id) + '" title="' + escapeHtml(formatScenarioItemTitle(suite)) + '">' +
          '<div class="scenario-item-head"><span class="scenario-name">' + escapeHtml(suite.name) + '</span><span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span></div>' +
          '<div class="muted">' + escapeHtml(count) + '</div>' +
          '</button>';
    }

    function formatScenarioListLabel(scenario) {
      const name = String(scenario.name || scenario.id || '');
      const group = String(scenario.group || '');
      if (!name || !group) return name;
      const prefix = group + '/';
      return name.toLowerCase().startsWith(prefix.toLowerCase())
        ? name.slice(prefix.length) || name
        : name;
    }

    function formatScenarioDescription(scenario) {
      const description = String(scenario.description || '').trim();
      if (!description) return '';
      const normalized = description.toLowerCase();
      const autoSamples = [
        'sample scenario ' + String(scenario.id || '').toLowerCase(),
        'sample scenario ' + String(scenario.name || '').toLowerCase()
      ];
      return autoSamples.includes(normalized) ? '' : description;
    }

    function formatScenarioItemTitle(scenario) {
      const parts = [];
      if (scenario.id) parts.push(scenario.id);
      if (scenario.name && scenario.name !== scenario.id) parts.push(scenario.name);
      if (scenario.path) parts.push(scenario.path);
      return parts.join('\\n');
    }

    async function selectScenario(id) {
      const previousSelected = state.selected;
      state.selectedKind = 'scenario';
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
          updateCopyLogButton();
        } else {
          resetOutput();
          setStatus(els.runStatus, 'idle');
        }
      }
      if (state.mode !== 'scenario') state.mode = 'scenario';
      renderCurrentList();
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

    async function selectSuite(id) {
      const previousSelected = state.selected;
      state.selectedKind = 'suite';
      state.selected = id;
      if (previousSelected !== id) state.openStepIndexes.clear();
      const activeItem = findRunById(state.activeOutputRunId);
      if (!activeItem || activeItem.suite !== id) {
        const latestItem = getLatestSuiteRun(id);
        state.activeOutputRunId = latestItem ? latestItem.id : null;
        if (latestItem) {
          els.output.innerHTML = latestItem.html || '';
          els.output.scrollTop = els.output.scrollHeight;
          setStatus(els.runStatus, latestItem.status);
          updateCopyLogButton();
        } else {
          resetOutput();
          setStatus(els.runStatus, 'idle');
        }
      }
      if (state.mode !== 'suite') state.mode = 'suite';
      renderCurrentList();
      try {
        state.detail = await fetchJson('/api/suite?suite=' + encodeURIComponent(id));
        renderSuiteDetail();
        els.validateBtn.disabled = false;
        els.testBtn.disabled = false;
      } catch (error) {
        state.detail = null;
        state.openStepIndexes.clear();
        const message = isUiConnectionError(error)
          ? '상세 정보를 불러오지 못했습니다.'
          : error.message;
        els.detailTitle.textContent = isUiConnectionError(error) ? '상세 정보' : '스위트 오류';
        els.scenarioSummary.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
        els.detailBody.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
        els.validateBtn.disabled = true;
        els.testBtn.disabled = true;
      }
      renderRunSummary();
      updateRunHint();
    }

    async function openLatestReportModal() {
      els.reportModal.hidden = false;
      els.reportModalTitle.textContent = '종합 리포트';
      els.reportModalMeta.textContent = '리포트 불러오는 중';
      els.reportModalActions.innerHTML = '';
      els.reportModalBody.innerHTML = '<div class="empty">리포트를 불러오는 중...</div>';
      try {
        await loadReports();
        const report = state.reports.find((item) => !item.error) || state.reports[0];
        if (!report) {
          renderEmptyReportModal();
          return;
        }
        await openReportModal(report.id);
      } catch (error) {
        const message = isUiConnectionError(error)
          ? '리포트를 불러오지 못했습니다.'
          : error.message;
        els.reportModalActions.innerHTML = '';
        els.reportModalBody.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
      }
    }

    function renderEmptyReportModal() {
      state.reportModalReportId = null;
      state.reportModalReport = null;
      state.reportModalFailuresOnly = false;
      els.reportModalTitle.textContent = '종합 리포트';
      els.reportModalMeta.textContent = '리포트 없음';
      els.reportModalActions.innerHTML = '';
      els.reportModalBody.innerHTML = '<div class="empty">아직 생성된 리포트가 없습니다. 스위트를 실행하면 종합 리포트가 생성됩니다.</div>';
    }

    async function openReportModal(id) {
      if (!id) return;
      state.reportModalReportId = id;
      state.reportModalReport = null;
      state.reportModalFailuresOnly = false;
      els.reportModal.hidden = false;
      els.reportModalTitle.textContent = '종합 리포트';
      els.reportModalMeta.textContent = id;
      renderReportModalActions(id, []);
      els.reportModalBody.innerHTML = '<div class="empty">리포트를 불러오는 중...</div>';
      try {
        state.reportModalReport = await fetchJson('/api/report?report=' + encodeURIComponent(id));
        renderReportModal();
      } catch (error) {
        const message = isUiConnectionError(error)
          ? '리포트를 불러오지 못했습니다.'
          : error.message;
        els.reportModalTitle.textContent = '리포트 오류';
        els.reportModalActions.innerHTML = '';
        els.reportModalBody.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
      }
    }

    function closeReportModal() {
      els.reportModal.hidden = true;
      state.reportModalReportId = null;
      state.reportModalReport = null;
      state.reportModalFailuresOnly = false;
      els.reportModalActions.innerHTML = '';
    }

    function renderReportModal() {
      const reportId = state.reportModalReportId;
      const report = state.reportModalReport;
      if (!reportId || !report) return;
      const suite = report.suite || {};
      const summary = report.summary || {};
      const scenarioSummary = summary.scenarios || {};
      const stepSummary = summary.steps || {};
      const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
      const failures = collectReportFailures(report);
      const visibleScenarios = orderReportScenarios(scenarios)
        .filter((scenario) => !state.reportModalFailuresOnly || reportScenarioHasFailure(scenario));
      const title = suite.name || suite.key || reportId;
      const status = report.result || 'unknown';
      const meta = formatReportDate(report.generatedAt);
      els.reportModalTitle.textContent = title + ' 종합 리포트';
      els.reportModalMeta.textContent = meta ? '생성 ' + meta : reportId;
      renderReportModalActions(reportId, failures);

      const scenarioFilter = failures.length > 0
        ? '<div class="report-actions"><button type="button" data-report-toggle-failures>' + escapeHtml(state.reportModalFailuresOnly ? '전체 시나리오' : '실패 시나리오만') + '</button></div>'
        : '';
      const scenarioList = visibleScenarios.length === 0
        ? '<div class="empty">' + escapeHtml(state.reportModalFailuresOnly ? '실패 시나리오 없음' : '테스트한 시나리오 없음') + '</div>'
        : '<div class="report-scenario-list">' + visibleScenarios.map(renderReportScenario).join('') + '</div>';

      els.reportModalBody.innerHTML =
        renderReportPicker(reportId) +
        '<div class="report-file-card">' +
          '<div class="report-file-label">실행 요약</div>' +
          '<div class="row">' +
            '<span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span>' +
            '<span class="pill">' + escapeHtml(formatReportRatio(scenarioSummary.passed, scenarioSummary.total, 'scenarios') || 'scenarios -') + '</span>' +
            '<span class="pill">' + escapeHtml(formatReportRatio(stepSummary.passed, stepSummary.total, 'steps') || 'steps -') + '</span>' +
            '<span class="pill">' + escapeHtml(formatDurationMs(summary.durationMs || 0)) + '</span>' +
          '</div>' +
        '</div>' +
        renderReportExplanation(report, reportId, failures) +
        renderReportFailureSummary(failures) +
        '<div class="report-section-head"><h3>테스트한 시나리오</h3>' + scenarioFilter + '</div>' +
        scenarioList;
    }

    function renderReportModalActions(reportId, failures) {
      const selectedId = reportId || '';
      els.reportModalActions.innerHTML =
        '<span class="report-action-group">' +
          '<a href="/api/report/html?report=' + encodeURIComponent(selectedId) + '" target="_blank" rel="noreferrer">새 탭</a>' +
          '<a href="/api/report/download?format=html&report=' + encodeURIComponent(selectedId) + '">HTML 다운로드</a>' +
          '<a href="/api/report/download?format=json&report=' + encodeURIComponent(selectedId) + '">JSON 다운로드</a>' +
          '<button type="button" data-copy-report-failures' + (failures.length === 0 ? ' disabled' : '') + '>실패 복사</button>' +
        '</span>';
    }

    function renderReportPicker(reportId) {
      if (state.reports.length <= 1) return '';
      return '<div class="report-picker-card">' +
        '<div><div class="report-picker-title">리포트 선택</div><div class="muted">다른 실행 결과 보기</div></div>' +
        '<select class="report-modal-select" data-report-picker aria-label="리포트 선택">' + state.reports.map((report) => (
          '<option value="' + escapeHtml(report.id) + '"' + (report.id === reportId ? ' selected' : '') + '>' + escapeHtml(formatReportPickerLabel(report)) + '</option>'
        )).join('') + '</select>' +
      '</div>';
    }

    function formatReportPickerLabel(report) {
      const status = report.error ? 'failed' : report.result || 'unknown';
      const title = report.suiteName || report.suiteKey || report.fileName;
      return [
        formatStatusLabel(status),
        title,
        formatReportDate(report.generatedAt),
      ].filter(Boolean).join(' · ');
    }

    function renderDetail() {
      const detail = state.detail;
      els.runSummaryTitle.textContent = '최근 실행 결과';
      els.runValuesToggle.style.display = '';
      els.detailTitle.textContent = formatScenarioListLabel(detail);
      setStatus(els.detailStatus, state.lastRun.get(detail.id) || 'not run');
      const descriptionText = formatScenarioDescription(detail);
      const description = descriptionText
        ? '<div class="scenario-description">' + escapeHtml(descriptionText) + '</div>'
        : '';
      els.scenarioSummary.innerHTML =
        '<div class="stack" style="gap: 6px;">' +
          description +
          '<div class="row"><span class="pill">시나리오</span><span class="pill">' + escapeHtml(formatStepCount(detail.stepCount)) + '</span></div>' +
          renderExecutionConfig(detail) +
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
      els.detailBody.innerHTML = '<div><h3>시나리오 실행 단계</h3><div class="steps">' + steps + '</div></div>';
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

    function renderExecutionConfig(detail) {
      const config = state.executionConfig || {};
      const configuredModules = Array.isArray(config.modules) ? config.modules : [];
      const targetNames = Array.isArray(detail && detail.targetModules) && detail.targetModules.length > 0
        ? detail.targetModules
        : Array.isArray(detail && detail.modules) ? detail.modules : [];
      const targets = targetNames.map((name) => configuredModules.find((module) => module.name === name) || { name: name });
      const targetRows = targets.map((module) => {
        return '<div class="execution-target">' +
          '<span class="execution-target-module">' + escapeHtml(module.name || '-') + '</span>' +
          '<span class="execution-target-url">' + escapeHtml(module.baseUrl || 'baseUrl 확인 중') + '</span>' +
        '</div>';
      }).join('') || '<div class="muted">대상 모듈 미결정</div>';

      return '<div class="execution-config">' +
        '<div class="execution-config-title">실행 대상</div>' +
        targetRows +
      '</div>';
    }

    function renderSuiteDetail() {
      const detail = state.detail;
      els.runSummaryTitle.textContent = '최근 실행 결과';
      els.runValuesToggle.style.display = '';
      els.detailTitle.textContent = detail.name;
      setStatus(els.detailStatus, state.lastSuiteRun.get(detail.id) || 'not run');
      const description = detail.description && detail.description.trim()
        ? '<div class="scenario-description">' + escapeHtml(detail.description.trim()) + '</div>'
        : '';
      els.scenarioSummary.innerHTML =
        '<div class="stack" style="gap: 6px;">' +
          description +
          '<div class="row"><span class="pill">스위트</span><span class="pill">' + escapeHtml(formatScenarioCount(detail.scenarioCount)) + '</span></div>' +
        '</div>';
      const scenarios = detail.scenarios.map((suiteScenario, index) => {
        const title = suiteScenario.name || suiteScenario.id;
        const meta = [
          suiteScenario.stepCount === undefined ? '' : formatStepCount(suiteScenario.stepCount)
        ].filter(Boolean).join(' · ');
        return '<div class="suite-scenario">' +
          '<div class="suite-scenario-head">' +
            '<div class="suite-scenario-name">' + escapeHtml((index + 1) + '. ' + title) + '</div>' +
            '<span class="pill' + (suiteScenario.error ? ' bad' : '') + '">' + escapeHtml(suiteScenario.error ? '오류' : '준비됨') + '</span>' +
          '</div>' +
          '<div class="muted">' + escapeHtml(meta) + '</div>' +
          (suiteScenario.error ? '<div class="error">' + escapeHtml(suiteScenario.error) + '</div>' : '') +
        '</div>';
      }).join('');
      els.detailBody.className = 'section-content stack';
      els.detailBody.innerHTML = '<div><h3>스위트 포함 시나리오</h3><div class="suite-scenario-list">' + scenarios + '</div></div>';
    }

    function renderReportScenario(reportScenario) {
      const status = reportScenario.result || 'unknown';
      const title = reportScenario.name || reportScenario.key || 'scenario';
      const steps = Array.isArray(reportScenario.steps) ? reportScenario.steps : [];
      const failedStep = steps.find(reportStepHasFailure);
      const requestStep = pickReportScenarioRequestStep(steps, failedStep);
      const request = requestStep ? [requestStep.method, requestStep.path].filter(Boolean).join(' ') : '';
      const passedSteps = steps.filter((step) => !reportStepHasFailure(step)).length;
      const meta = [
        request,
        steps.length === 0 ? '' : passedSteps + '/' + steps.length + ' steps',
        typeof reportScenario.durationMs === 'number' ? formatDurationMs(reportScenario.durationMs) : ''
      ].filter(Boolean).join(' · ');
      return '<div class="report-scenario' + statusTone(status) + '">' +
        '<div class="report-scenario-head">' +
          '<div><div class="report-scenario-name">' + escapeHtml(title) + '</div><div class="muted">' + escapeHtml(meta) + '</div></div>' +
          '<span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span>' +
        '</div>' +
        (failedStep ? '<div class="report-scenario-failure">' + escapeHtml(formatReportStepFailure(failedStep)) + '</div>' : '') +
      '</div>';
    }

    function pickReportScenarioRequestStep(steps, failedStep) {
      if (failedStep && (failedStep.method || failedStep.path)) return failedStep;
      for (let index = steps.length - 1; index >= 0; index -= 1) {
        const step = steps[index];
        if (step && (step.method || step.path)) return step;
      }
      return null;
    }

    function formatReportStepFailure(step) {
      const response = step.response || {};
      const condition = step.condition || {};
      const extracts = Array.isArray(step.extracts) ? step.extracts : [];
      const failures = [
        step.error || '',
        condition.passed === false ? 'condition: ' + (condition.expression || '') : '',
        ...extracts.filter((extract) => extract && extract.passed === false).map((extract) => 'extract: ' + (extract.name || '') + (extract.error ? ' - ' + extract.error : ''))
      ].filter(Boolean);
      return [
        '실패 step ' + (step.id || 'step'),
        [step.method, step.path].filter(Boolean).join(' '),
        response.status === undefined ? '' : 'actual HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : ''),
        condition.expression ? 'expected ' + condition.expression : '',
        failures.join(' · ')
      ].filter(Boolean).join(' · ');
    }

    function renderReportExplanation(report, reportId, failures) {
      const firstFailure = failures[0];
      if (!firstFailure) return '';
      const next = inferReportNextCheck(firstFailure);

      return '<div class="report-explanation-grid">' +
        renderReportExplanationCard('첫 실패', firstFailure.scenario + ' · ' + firstFailure.step, [firstFailure.request, 'actual ' + firstFailure.actual, 'expected ' + firstFailure.expected].filter(Boolean).join(' · ')) +
        renderReportExplanationCard('다음 확인', next.title, next.text) +
      '</div>';
    }

    function renderReportExplanationCard(label, title, text) {
      return '<div class="report-explanation-card">' +
        '<div class="report-explanation-label">' + escapeHtml(label) + '</div>' +
        '<div class="report-explanation-title">' + escapeHtml(title || '-') + '</div>' +
        '<div class="report-explanation-text">' + escapeHtml(text || '-') + '</div>' +
      '</div>';
    }

    function inferReportNextCheck(failure) {
      const expectedStatus = parseReportStatusCode(failure.expected);
      const actualStatus = parseReportStatusCode(failure.actual);

      if (expectedStatus !== undefined && actualStatus !== undefined && expectedStatus !== actualStatus) {
        return {
          title: 'status 기대값과 실제 응답 불일치',
          text: '시나리오 condition, OpenAPI 스펙, 백엔드 구현 중 어느 쪽이 맞는지 확인'
        };
      }

      if (failure.expected && failure.expected.startsWith('extract:')) {
        return {
          title: '응답 extract 실패',
          text: '응답 JSON 경로와 실제 응답 필드명 확인'
        };
      }

      if (failure.expected && failure.expected !== '-') {
        return {
          title: '조건식 실패',
          text: 'condition 표현식과 실제 응답 상태를 같이 확인'
        };
      }

      return {
        title: '실행 오류 확인',
        text: '대상 서버, URL, 인증, 네트워크 오류 메시지 확인'
      };
    }

    function parseReportStatusCode(value) {
      const match = String(value || '').match(/\\b(\\d{3})\\b/);
      return match ? Number(match[1]) : undefined;
    }

    function formatReportStepSource(source) {
      if (!source || typeof source !== 'object') return '';
      if (source.kind === 'direct') return '직접 정의';
      if (source.kind === 'use') return '시나리오 사용: ' + (source.reference || '');
      if (source.kind === 'include') return '파일 포함: ' + (source.reference || '');
      return source.kind || '';
    }

    function renderReportFailureSummary(failures) {
      if (failures.length === 0) {
        return '<div class="report-failure-summary ok"><div class="report-failure-title">모든 시나리오 통과</div><div class="muted">실패 step 없음</div></div>';
      }

      return '<div class="report-failure-summary">' +
        '<div class="report-failure-title">실패 원인 ' + failures.length + '개</div>' +
        '<div class="report-failure-list">' + failures.slice(0, 5).map((failure) => (
          '<div class="report-failure-item">' +
            '<div class="report-failure-main">' + escapeHtml(failure.scenario + ' · ' + failure.step) + '</div>' +
            '<div class="muted">' + escapeHtml([failure.source, failure.request, 'actual ' + failure.actual, 'expected ' + failure.expected].filter(Boolean).join(' · ')) + '</div>' +
          '</div>'
        )).join('') + '</div>' +
        (failures.length > 5 ? '<div class="muted">외 ' + (failures.length - 5) + '개 실패</div>' : '') +
      '</div>';
    }

    function collectReportFailures(report) {
      const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
      const failures = [];
      for (const scenario of scenarios) {
        const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
        for (const step of steps) {
          if (!reportStepHasFailure(step)) continue;
          const response = step.response || {};
          const condition = step.condition || {};
          failures.push({
            scenario: scenario.name || scenario.key || 'scenario',
            step: step.id || 'step',
            source: formatReportStepSource(step.source),
            request: [step.method, step.path].filter(Boolean).join(' '),
            actual: response.status === undefined ? '-' : 'HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : ''),
            expected: condition.expression || step.error || '-'
          });
        }
      }
      return failures;
    }

    function reportScenarioHasFailure(reportScenario) {
      if ((reportScenario.result || '').toUpperCase() === 'FAIL') return true;
      const steps = Array.isArray(reportScenario.steps) ? reportScenario.steps : [];
      return steps.some(reportStepHasFailure);
    }

    function reportStepHasFailure(step) {
      if (!step) return false;
      if ((step.result || '').toUpperCase() === 'FAIL') return true;
      if (step.error) return true;
      if (step.condition && step.condition.passed === false) return true;
      const extracts = Array.isArray(step.extracts) ? step.extracts : [];
      return extracts.some((extract) => extract && extract.passed === false);
    }

    function orderReportScenarios(scenarios) {
      return scenarios.slice().sort((left, right) => Number(reportScenarioHasFailure(right)) - Number(reportScenarioHasFailure(left)));
    }

    async function checkServers() {
      setStatus(els.runStatus, 'checking');
      els.serverList.innerHTML = '<div class="empty">서버 확인 중...</div>';
      els.serverCheckedAt.textContent = '확인 중';
      try {
        const result = await fetchJson('/api/check-servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        state.executionConfig = {
          configPath: result.configPath || state.executionConfig.configPath || '',
          defaultModule: result.defaultModule || state.executionConfig.defaultModule || '',
          moduleOption: result.moduleOption || '',
          modules: Array.isArray(result.modules) ? result.modules : []
        };
        state.serverSummary = summarizeServerResult(result);
        updateServerStatusSummary();
        els.serverConfigMeta.textContent = formatExecutionConfigMeta(state.executionConfig);
        els.serverCheckedAt.textContent = formatServerStatusSummaryText(state.serverSummary) + ' · ' + new Date(result.checkedAt).toLocaleTimeString();
        els.serverList.innerHTML = result.modules.map((module) => {
          const snapshot = module.snapshot || { status: 'missing', error: 'snapshot unknown' };
          const serverMeta = formatServerMeta(module);
          const snapshotMeta = formatSnapshotMeta(snapshot);
          const openApiMeta = module.openapi ? 'OpenAPI: ' + module.openapi : '';
          return '<div class="server"><strong>' + escapeHtml(module.name) + '</strong><div class="server-lines"><div>' + escapeHtml(module.baseUrl || 'baseUrl 미설정') + '</div><div class="muted">' + escapeHtml(serverMeta) + '</div>' + (openApiMeta ? '<div class="muted">' + escapeHtml(openApiMeta) + '</div>' : '') + '<div class="muted">' + escapeHtml(snapshotMeta) + '</div></div><span class="pill' + statusTone(module.status) + '">' + escapeHtml(formatStatusLabel(module.status)) + '</span></div>';
        }).join('');
        if (state.selectedKind === 'scenario' && state.selected) await selectScenario(state.selected);
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

    function formatExecutionConfigMeta(config) {
      return [
        config.configPath || 'config 경로 없음',
        config.moduleOption ? '--module ' + config.moduleOption : config.defaultModule ? 'default ' + config.defaultModule : ''
      ].filter(Boolean).join(' · ');
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

    function findSuiteName(id) {
      const suite = state.suites.find((candidate) => candidate.id === id);
      return suite ? suite.name : id;
    }

    function formatRunHistoryTime(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
    }

    function getScenarioRuns(scenarioId) {
      return state.runsByScenario.get(scenarioId) || {};
    }

    function getSuiteRuns(suiteId) {
      return state.runsBySuite.get(suiteId) || {};
    }

    function saveScenarioRun(item) {
      const runs = Object.assign({}, getScenarioRuns(item.scenario));
      runs[item.command] = item;
      state.runsByScenario.set(item.scenario, runs);
    }

    function saveSuiteRun(item) {
      const runs = Object.assign({}, getSuiteRuns(item.suite));
      runs[item.command] = item;
      state.runsBySuite.set(item.suite, runs);
    }

    function findRunById(runId) {
      if (!runId) return null;
      for (const runs of state.runsByScenario.values()) {
        for (const item of [runs.validate, runs.test]) {
          if (item && item.id === runId) return item;
        }
      }
      for (const runs of state.runsBySuite.values()) {
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

    function getLatestSuiteRun(suiteId) {
      const runs = getSuiteRuns(suiteId);
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
      return formatDurationMs(durationMs);
    }

    function formatDurationMs(durationMs) {
      if (durationMs < 1000) return durationMs + 'ms';
      if (durationMs < 10000) return (durationMs / 1000).toFixed(1) + 's';
      return Math.round(durationMs / 1000) + 's';
    }

    function formatReportDate(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatReportRatio(passed, total, label) {
      if (typeof passed !== 'number' || typeof total !== 'number') return '';
      return passed + '/' + total + ' ' + label;
    }

    function stripAnsi(value) {
      return String(value).replace(/\u001b\[[0-9;]*m/g, '');
    }

    function readActiveOutputText() {
      const activeItem = findRunById(state.activeOutputRunId);
      if (activeItem && activeItem.text) return stripAnsi(activeItem.text);
      return stripAnsi(els.output.textContent || '');
    }

    function updateCopyLogButton() {
      els.copyLogBtn.disabled = readActiveOutputText().trim().length === 0;
    }

    async function copyText(value) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          return;
        } catch (_error) {
          // Fall through to the textarea copy path for browsers without clipboard permission.
        }
      }

      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('클립보드에 복사하지 못했습니다.');
    }

    async function copyExecutionLog() {
      const text = readActiveOutputText();
      if (!text.trim()) {
        setHint('복사할 실행 로그가 없습니다.', 'warn');
        updateCopyLogButton();
        return;
      }

      try {
        await copyText(text);
        setHint('실행 로그를 복사했습니다.', '');
      } catch (error) {
        setHint(error instanceof Error ? error.message : String(error), 'bad');
      }
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

    function formatStepResultMeta(step, showTargetModule) {
      const parts = [];
      if (showTargetModule && step.targetModule) parts.push('module ' + step.targetModule);
      const api = ((step.method || '') + ' ' + (step.path || '')).trim();
      if (api) parts.push(api);
      else if (step.operationId) parts.push('operationId ' + step.operationId);
      if (step.input && step.input.name) parts.push('입력 ' + step.input.name);
      if (typeof step.responseStatus === 'number') parts.push('HTTP ' + step.responseStatus);
      if (typeof step.durationMs === 'number') parts.push(Math.round(step.durationMs) + 'ms');
      return parts.join(' · ');
    }

    function formatBodyValue(value) {
      if (typeof value !== 'string') return formatJsonValue(value);
      const text = String(value);
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch (_error) {
        return text;
      }
    }

    function formatJsonValue(value) {
      return JSON.stringify(value, null, 2);
    }

    function renderStepValueBlock(title, value) {
      if (!value) return '';
      return '<div class="run-step-value">' +
        '<div class="run-step-value-title">' + escapeHtml(title) + '</div>' +
        '<pre class="run-step-value-code">' + escapeHtml(value) + '</pre>' +
      '</div>';
    }

    function hasRunStepValues(step) {
      return Boolean(step && (step.url || step.request || step.response || step.expectedResponse));
    }

    function renderRunStepValues(step, preview) {
      const values = formatRunStepValues(step);
      const body = [
        renderStepValueBlock(preview ? '요청 (예정)' : '요청', values.request),
        renderStepValueBlock(values.expected ? '응답 (예상 · OpenAPI)' : '응답', values.response)
      ].filter(Boolean).join('');

      return body ? '<div class="run-step-values">' + body + '</div>' : '';
    }

    function formatRunStepValues(step) {
      const request = step.request || {};
      const response = step.response || step.expectedResponse;
      const expected = !step.response && Boolean(step.expectedResponse);
      const requestParts = [];
      if (step.url) requestParts.push('url: ' + step.url);
      if (request.headers) requestParts.push('headers:\n' + formatJsonValue(request.headers));
      if (request.query) requestParts.push('query:\n' + formatJsonValue(request.query));
      if (request.pathParams) requestParts.push('pathParams:\n' + formatJsonValue(request.pathParams));
      if (request.body !== undefined) requestParts.push('body:\n' + formatBodyValue(request.body));
      if (request.multipart) requestParts.push('multipart:\n' + formatJsonValue(request.multipart));

      const responseParts = [];
      if (response) {
        const statusText = response.statusText ? ' ' + response.statusText : '';
        responseParts.push('status: ' + response.status + statusText);
        if (response.contentType) responseParts.push('content-type: ' + response.contentType);
        if (expected && response.source) responseParts.push('source: ' + response.source);
        if (response.headers) responseParts.push('headers:\n' + formatJsonValue(response.headers));
        if (response.body !== undefined) responseParts.push('body:\n' + formatBodyValue(response.body));
      }

      return {
        request: requestParts.join('\n\n'),
        response: responseParts.join('\n\n'),
        expected
      };
    }

    function formatRunStepValuesText(step) {
      const values = formatRunStepValues(step);
      return [
        values.request ? 'request values:\n' + values.request : '',
        values.response ? (values.expected ? 'expected response values:\n' : 'response values:\n') + values.response : ''
      ].filter(Boolean).join('\n\n');
    }

    function formatRunStepAssertionsText(step) {
      const lines = [];
      if (step.condition) {
        lines.push('check: ' + (step.condition.passed ? 'PASS' : 'FAIL') + ' ' + step.condition.expression);
      }
      for (const extract of step.extracts || []) {
        let message = 'extract: ' + (extract.passed ? 'PASS ' : 'FAIL ') + extract.name;
        if (extract.path) message += ' (' + extract.path + ')';
        if (extract.error) message += ' - ' + extract.error;
        lines.push(message);
      }
      if (step.error) lines.push('error: ' + step.error);
      return lines.join('\n');
    }

    function formatRunStepCopyText(item, step) {
      const index = typeof step.index === 'number' ? step.index + 1 : '';
      const title = (index ? index + '. ' : '') + step.id;
      const lines = [
        'scenario: ' + (item.scenarioName || item.scenario),
        'command: ' + item.command,
        'run status: ' + formatStatusLabel(item.status),
        'step: ' + title,
        'step status: ' + formatStatusLabel(step.status || 'unknown')
      ];
      const source = formatStepSource(step.source);
      const api = ((step.method || '') + ' ' + (step.path || '')).trim();
      if (source) lines.push('source: ' + source);
      if (api) lines.push('request: ' + api);
      if (step.input && step.input.name) {
        lines.push('input: ' + step.input.name + ' (' + step.input.source + ', ' + (step.input.provided ? 'provided' : 'missing') + ')');
      }
      if (typeof step.responseStatus === 'number') lines.push('response: HTTP ' + step.responseStatus);
      if (typeof step.durationMs === 'number') lines.push('duration: ' + Math.round(step.durationMs) + 'ms');

      return [
        lines.join('\n'),
        formatRunStepAssertionsText(step),
        state.showRunValues ? formatRunStepValuesText(step) : ''
      ].filter(Boolean).join('\n\n') + '\n';
    }

    function renderRunStepResults(item) {
      if (!item.stepResults || item.stepResults.length === 0) return '';
      const showTargetModule = new Set(item.stepResults.map((step) => step.targetModule).filter(Boolean)).size > 1;

      return '<div class="run-step-results">' + item.stepResults.map((step) => {
        const index = typeof step.index === 'number' ? step.index + 1 : '';
        const title = (index ? index + '. ' : '') + step.id;
        const status = step.status || 'unknown';
        return '<div class="run-step-result">' +
          '<div class="run-step-result-row">' +
            '<span class="run-step-result-main">' +
              '<span class="run-step-result-title">' + escapeHtml(title) + ' <span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span></span>' +
              '<span class="run-step-result-meta">' + escapeHtml(formatStepResultMeta(step, showTargetModule)) + '</span>' +
            '</span>' +
            '<span class="run-step-result-actions">' +
              (item.preview ? '' : '<button class="run-step-copy" type="button" data-copy-run-step data-run-id="' + escapeHtml(item.id) + '" data-step-index="' + escapeHtml(String(step.index)) + '">복사</button>') +
              '<span class="pill run-step-result-source">' + escapeHtml(formatStepSource(step.source)) + '</span>' +
            '</span>' +
          '</div>' +
          (state.showRunValues ? renderRunStepValues(step, Boolean(item.preview || step.preview)) : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function buildScenarioPreviewSteps(detail) {
      if (!detail || !Array.isArray(detail.steps)) return [];
      return detail.steps.map((step, index) => ({
        index,
        id: step.id,
        status: 'not run',
        preview: true,
        source: step.source,
        targetModule: step.targetModule,
        operationId: step.operationId,
        method: step.method,
        path: step.path,
        request: step.request,
        expectedResponse: step.expectedResponse,
        input: step.input,
        extracts: []
      }));
    }

    function mergeRunStepResults(plannedSteps, resultSteps) {
      const merged = new Map((plannedSteps || []).map((step) => [step.index, step]));
      for (const step of resultSteps || []) {
        merged.set(step.index, { ...(merged.get(step.index) || {}), ...step, preview: false });
      }
      return Array.from(merged.values()).sort((left, right) => left.index - right.index);
    }

    function renderScenarioPreview(steps) {
      if (steps.length === 0) return '';
      return '<div class="run-result run-result-test">' +
        '<div class="run-result-title-row">' +
          '<div class="run-result-heading">' +
            '<div class="run-result-kind">시나리오 실행</div>' +
            '<div class="run-result-title">실행 예정 엔드포인트</div>' +
          '</div>' +
          '<span class="pill">미실행</span>' +
        '</div>' +
        renderRunStepResults({ id: '', preview: true, stepResults: steps }) +
      '</div>';
    }

    function renderRunInputPrompt(item) {
      const pending = item && item.pendingInput;
      if (!pending) return '';
      const label = pending.label || pending.name;
      const type = pending.sensitive ? 'password' : 'text';
      const index = typeof pending.index === 'number' ? pending.index + 1 : '';
      const position = index ? index + '/' + pending.totalSteps + ' · ' : '';
      return '<div class="run-input-prompt">' +
        '<div>' +
          '<div class="run-input-title">' + escapeHtml(label) + '</div>' +
          '<div class="run-input-meta">' + escapeHtml(position + pending.id + ' · ' + pending.name) + '</div>' +
        '</div>' +
        '<form class="run-input-form" data-run-id="' + escapeHtml(item.id) + '" data-input-name="' + escapeHtml(pending.name) + '">' +
          '<input name="value" type="' + type + '" autocomplete="off" autofocus placeholder="' + escapeHtml(label) + '">' +
          '<button class="blue" type="submit">계속</button>' +
        '</form>' +
      '</div>';
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
      const target = item.suite ? '스위트' : '시나리오';
      const command = item.command === 'validate' ? '검증' : item.command === 'test' ? '실행' : formatCommandLabel(item.command);
      if (item.status === 'passed') return target + ' ' + command + ' 통과';
      if (item.status === 'failed') return target + ' ' + command + ' 실패';
      if (item.status === 'running') return target + ' ' + command + ' 중';
      return target + ' ' + command + ' ' + formatStatusLabel(item.status);
    }

    function formatRunResultKind(item) {
      const target = item.suite ? '스위트' : '시나리오';
      if (item.command === 'validate') return target + ' 검증';
      if (item.command === 'test') return target + ' 실행';
      return target + ' ' + formatCommandLabel(item.command);
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
            '<div class="run-result-kind">' + escapeHtml(formatRunResultKind(item)) + '</div>' +
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
        renderRunInputPrompt(item) +
        renderRunStepResults(item) +
        renderSuiteRunResult(item) +
      '</div>';
    }

    function renderSuiteRunResult(item) {
      const result = item.suiteResult;
      if (!result || !Array.isArray(result.scenarios)) return '';

      return '<div class="suite-result-list">' + result.scenarios.map((scenario) => {
        const status = scenario.status || 'unknown';
        const title = scenario.scenarioName || scenario.scenarioKey;
        const meta = [
          [scenario.method, scenario.path].filter(Boolean).join(' '),
          scenario.passedSteps + '/' + scenario.totalSteps + ' steps',
          formatDurationMs(scenario.durationMs || 0)
        ].filter(Boolean).join(' · ');
        const failure = scenario.failedStep
          ? formatSuiteFailure(scenario.failedStep)
          : scenario.error || '';
        return '<div class="suite-result-scenario">' +
          '<div class="suite-result-scenario-head">' +
            '<div class="suite-result-scenario-name">' + escapeHtml(title) + '</div>' +
            '<span class="pill' + statusTone(status) + '">' + escapeHtml(formatStatusLabel(status)) + '</span>' +
          '</div>' +
          '<div class="muted">' + escapeHtml(meta) + '</div>' +
          (failure ? '<div class="error">' + escapeHtml(failure) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function renderSuiteReportShortcut(items) {
      if (state.selectedKind !== 'suite') return '';
      const reportItem = items.find((item) => item && item.suiteResult && reportIdFromPath(item.suiteResult.reportPath));
      if (!reportItem) return '';
      const result = reportItem.suiteResult;
      const reportId = reportIdFromPath(result.reportPath);
      const scenarioCount = Array.isArray(result.scenarios) ? result.scenarios.length : 0;
      return '<div class="report-shortcut">' +
        '<div>' +
          '<div class="report-shortcut-title">최근 스위트 종합 리포트</div>' +
          '<div class="report-shortcut-meta">' + escapeHtml([formatStatusLabel(result.status), scenarioCount ? scenarioCount + '개 시나리오' : '', result.reportPath].filter(Boolean).join(' · ')) + '</div>' +
        '</div>' +
        '<button type="button" data-open-report="' + escapeHtml(reportId) + '">종합 리포트</button>' +
      '</div>';
    }

    function reportIdFromPath(reportPath) {
      if (!reportPath) return '';
      return String(reportPath).split(/[\\\\/]/).filter(Boolean).pop() || '';
    }

    function formatSuiteFailure(failedStep) {
      const parts = ['실패 step ' + failedStep.id];
      const request = [failedStep.method, failedStep.path].filter(Boolean).join(' ');
      if (request) parts.push(request);
      if (failedStep.responseStatus !== undefined) parts.push('HTTP ' + failedStep.responseStatus);
      if (failedStep.condition) parts.push(failedStep.condition);
      if (failedStep.error) parts.push(failedStep.error);
      return parts.join(' · ');
    }

    function runHasValues(item) {
      return Boolean(item && item.command === 'test' && (item.stepResults || []).some(hasRunStepValues));
    }

    function updateRunValuesToggle(items, previewSteps) {
      const hasValues = items.some(runHasValues) || (previewSteps || []).some(hasRunStepValues);
      els.runValuesToggle.disabled = !hasValues;
      els.runValuesToggle.textContent = state.showRunValues ? '요청/응답 숨김' : '요청/응답 보기';
      els.runValuesToggle.title = hasValues
        ? '요청/응답 값 표시를 전환합니다.'
        : '표시할 요청/응답 값이 없습니다.';
    }

    function renderRunSummary() {
      if (!state.selected) {
        updateRunValuesToggle([]);
        els.runSummary.innerHTML = '<div class="muted">' + (state.selectedKind === 'suite' ? '이 스위트 실행 기록 없음' : '이 시나리오 실행 기록 없음') + '</div>';
        return;
      }

      const runs = state.selectedKind === 'suite'
        ? getSuiteRuns(state.selected)
        : getScenarioRuns(state.selected);
      const items = [runs.validate, runs.test].filter(Boolean);
      const previewSteps = state.selectedKind === 'scenario' && !runs.test
        ? buildScenarioPreviewSteps(state.detail)
        : [];
      updateRunValuesToggle(items, previewSteps);
      const preview = previewSteps.length > 0
        ? renderScenarioPreview(previewSteps)
        : '';
      if (items.length === 0) {
        els.runSummary.innerHTML = preview || '<div class="muted">' + (state.selectedKind === 'suite' ? '이 스위트 실행 기록 없음' : '이 시나리오 실행 기록 없음') + '</div>';
        return;
      }

      els.runSummary.innerHTML = renderSuiteReportShortcut(items) + preview + items.map(renderRunResult).join('');
    }

    function clearRunOutput() {
      state.activeOutputRunId = null;
      resetOutput();
      setStatus(els.runStatus, 'idle');
      renderRunSummary();
    }

    async function runCommand(command) {
      if (state.selectedKind === 'suite') {
        await runSuiteCommand(command);
        return;
      }
      const runScenario = state.selected;
      if (!runScenario) return;
      setStatus(els.runStatus, 'running');
      state.activeOutputRunId = null;
      resetOutput();
      let result;
      try {
        result = await fetchJson('/api/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: command, scenario: runScenario, showValues: command === 'test' })
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
        stepResults: command === 'test' ? buildScenarioPreviewSteps(state.detail) : [],
        pendingInput: null
      };
      saveScenarioRun(runItem);
      state.activeOutputRunId = result.runId;
      state.lastRun.set(runScenario, 'running');
      if (state.selectedKind === 'scenario' && state.selected === runScenario) {
        setStatus(els.detailStatus, 'running');
      }
      renderCurrentList();
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
        if (state.selectedKind === 'scenario' && state.selected === runScenario) {
          renderRunSummary();
        }
      });
      events.addEventListener('test-result', (event) => {
        const data = JSON.parse(event.data);
        runItem.stepResults = mergeRunStepResults(runItem.stepResults, Array.isArray(data.steps) ? data.steps : []);
        if (state.selectedKind === 'scenario' && state.selected === runScenario) {
          renderRunSummary();
        }
      });
      events.addEventListener('input-request', (event) => {
        runItem.pendingInput = JSON.parse(event.data);
        if (state.selectedKind === 'scenario' && state.selected === runScenario) {
          renderRunSummary();
          focusRunInput(result.runId);
          setHint('입력값 대기 중입니다.', 'warn');
        }
      });
      events.addEventListener('input-submitted', () => {
        runItem.pendingInput = null;
        if (state.selectedKind === 'scenario' && state.selected === runScenario) {
          renderRunSummary();
          updateRunHint();
        }
      });
      events.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        runItem.status = data.status;
        runItem.finishedAt = new Date().toISOString();
        runItem.exitCode = data.exitCode;
        runItem.pendingInput = null;
        state.lastRun.set(runScenario, data.status);
        if (state.activeOutputRunId === result.runId) {
          setStatus(els.runStatus, data.status);
        }
        if (state.selectedKind === 'scenario' && state.selected === runScenario) {
          setStatus(els.detailStatus, data.status);
          renderRunSummary();
        }
        renderCurrentList();
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
          if (state.selectedKind === 'scenario' && state.selected === runScenario) {
            setStatus(els.detailStatus, 'failed');
            renderRunSummary();
          }
          renderCurrentList();
          updateRunHint();
        }
        events.close();
      };
    }

    async function runSuiteCommand(command) {
      const runSuite = state.selected;
      if (!runSuite) return;
      setStatus(els.runStatus, 'running');
      state.activeOutputRunId = null;
      resetOutput();
      let result;
      try {
        result = await fetchJson('/api/run-suite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: command, suite: runSuite, showValues: command === 'test' })
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
        suite: runSuite,
        suiteName: findSuiteName(runSuite),
        scenario: runSuite,
        scenarioName: findSuiteName(runSuite),
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        html: '',
        text: '',
        stepResults: [],
        suiteResult: null,
        pendingInput: null
      };
      saveSuiteRun(runItem);
      state.activeOutputRunId = result.runId;
      state.lastSuiteRun.set(runSuite, 'running');
      if (state.selectedKind === 'suite' && state.selected === runSuite) {
        setStatus(els.detailStatus, 'running');
      }
      renderCurrentList();
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
        if (state.selectedKind === 'suite' && state.selected === runSuite) {
          renderRunSummary();
        }
      });
      events.addEventListener('suite-result', (event) => {
        runItem.suiteResult = JSON.parse(event.data);
        if (state.selectedKind === 'suite' && state.selected === runSuite) {
          renderRunSummary();
        }
      });
      events.addEventListener('input-request', (event) => {
        runItem.pendingInput = JSON.parse(event.data);
        if (state.selectedKind === 'suite' && state.selected === runSuite) {
          renderRunSummary();
          focusRunInput(result.runId);
          setHint('입력값 대기 중입니다.', 'warn');
        }
      });
      events.addEventListener('input-submitted', () => {
        runItem.pendingInput = null;
        if (state.selectedKind === 'suite' && state.selected === runSuite) {
          renderRunSummary();
          updateRunHint();
        }
      });
      events.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        runItem.status = data.status;
        runItem.finishedAt = new Date().toISOString();
        runItem.exitCode = data.exitCode;
        runItem.pendingInput = null;
        state.lastSuiteRun.set(runSuite, data.status);
        if (state.activeOutputRunId === result.runId) {
          setStatus(els.runStatus, data.status);
        }
        if (state.selectedKind === 'suite' && state.selected === runSuite) {
          setStatus(els.detailStatus, data.status);
          renderRunSummary();
        }
        void loadReports().catch(() => {});
        renderCurrentList();
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
          state.lastSuiteRun.set(runSuite, 'failed');
          if (state.activeOutputRunId === result.runId) {
            appendOutputHtml(escapeHtml('\nEvent stream disconnected.\n'));
            setStatus(els.runStatus, 'failed');
          }
          if (state.selectedKind === 'suite' && state.selected === runSuite) {
            setStatus(els.detailStatus, 'failed');
            renderRunSummary();
          }
          renderCurrentList();
          updateRunHint();
        }
        events.close();
      };
    }

    function focusRunInput(runId) {
      const forms = Array.from(els.runSummary.querySelectorAll('.run-input-form'));
      const form = forms.find((candidate) => candidate.getAttribute('data-run-id') === String(runId));
      const input = form ? form.querySelector('input[name="value"]') : null;
      if (input) input.focus();
    }

    async function submitRunInput(event) {
      const form = event.target && event.target.closest ? event.target.closest('.run-input-form') : null;
      if (!form) return;
      event.preventDefault();
      const runId = form.getAttribute('data-run-id') || '';
      const name = form.getAttribute('data-input-name') || '';
      const input = form.querySelector('input[name="value"]');
      const button = form.querySelector('button');
      const value = input ? input.value : '';
      if (input) input.disabled = true;
      if (button) button.disabled = true;

      try {
        await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/input', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, value: value })
        });
        const item = findRunById(runId);
        if (item) item.pendingInput = null;
        renderRunSummary();
        updateRunHint();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (input) input.disabled = false;
        if (button) button.disabled = false;
        setHint(message, 'bad');
        focusRunInput(runId);
      }
    }

    async function copyRunStep(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-copy-run-step]') : null;
      if (!button) return;
      event.preventDefault();

      const runId = button.getAttribute('data-run-id') || '';
      const stepIndex = button.getAttribute('data-step-index') || '';
      const item = findRunById(runId);
      const step = item ? (item.stepResults || []).find((candidate) => String(candidate.index) === stepIndex) : null;
      if (!item || !step) {
        setHint('복사할 step 결과를 찾을 수 없습니다.', 'bad');
        return;
      }

      try {
        await copyText(formatRunStepCopyText(item, step));
        setHint('step 내용을 복사했습니다.', '');
      } catch (error) {
        setHint(error instanceof Error ? error.message : String(error), 'bad');
      }
    }

    async function handleReportAction(event) {
      const openReportButton = event.target && event.target.closest ? event.target.closest('[data-open-report]') : null;
      if (openReportButton) {
        event.preventDefault();
        const reportId = openReportButton.getAttribute('data-open-report');
        if (!reportId) return;
        try {
          await loadReports();
          await openReportModal(reportId);
          setHint('리포트를 열었습니다.', '');
        } catch (error) {
          setHint(error instanceof Error ? error.message : String(error), 'bad');
        }
        return;
      }

      const toggleButton = event.target && event.target.closest ? event.target.closest('[data-report-toggle-failures]') : null;
      if (toggleButton) {
        event.preventDefault();
        state.reportModalFailuresOnly = !state.reportModalFailuresOnly;
        renderReportModal();
        return;
      }

      const copyButton = event.target && event.target.closest ? event.target.closest('[data-copy-report-failures]') : null;
      if (!copyButton) return;
      event.preventDefault();
      if (!state.reportModalReport) return;
      const failures = collectReportFailures(state.reportModalReport);
      if (failures.length === 0) {
        setHint('복사할 실패 요약이 없습니다.', 'warn');
        return;
      }

      try {
        await copyText(formatReportFailuresText(state.reportModalReport, failures));
        setHint('실패 요약을 복사했습니다.', '');
      } catch (error) {
        setHint(error instanceof Error ? error.message : String(error), 'bad');
      }
    }

    async function handleReportSelectionChange(event) {
      const select = event.target && event.target.closest ? event.target.closest('[data-report-picker]') : null;
      if (!select) return;
      const reportId = select.value || '';
      if (!reportId || reportId === state.reportModalReportId) return;
      try {
        await openReportModal(reportId);
        setHint('리포트를 열었습니다.', '');
      } catch (error) {
        setHint(error instanceof Error ? error.message : String(error), 'bad');
      }
    }

    function formatReportFailuresText(report, failures) {
      const suite = report.suite || {};
      const summary = report.summary || {};
      const scenarioSummary = summary.scenarios || {};
      const stepSummary = summary.steps || {};
      const lines = [
        'suite: ' + (suite.key || suite.name || ''),
        'result: ' + (report.result || ''),
        'scenarios: ' + formatReportRatio(scenarioSummary.passed, scenarioSummary.total, 'scenarios'),
        'steps: ' + formatReportRatio(stepSummary.passed, stepSummary.total, 'steps'),
        '',
        'failures:'
      ];
      for (const failure of failures) {
        lines.push('- ' + failure.scenario + ' / ' + failure.step);
        if (failure.source) lines.push('  source: ' + failure.source);
        lines.push('  request: ' + (failure.request || '-'));
        lines.push('  actual: ' + failure.actual);
        lines.push('  expected: ' + failure.expected);
      }
      return lines.join('\n') + '\n';
    }

    els.searchInput.addEventListener('input', renderCurrentList);
    els.scenarioTabBtn.addEventListener('click', () => switchListMode('scenario'));
    els.suiteTabBtn.addEventListener('click', () => switchListMode('suite'));
    els.reportsBtn.addEventListener('click', openLatestReportModal);
    els.collapseGroupsBtn.addEventListener('click', collapseAllScenarioGroups);
    els.expandGroupsBtn.addEventListener('click', expandAllScenarioGroups);
    els.checkServersBtn.addEventListener('click', checkServers);
    els.reconnectBtn.addEventListener('click', reconnectUi);
    els.runValuesToggle.addEventListener('click', () => {
      state.showRunValues = !state.showRunValues;
      renderRunSummary();
    });
    els.runSummary.addEventListener('submit', submitRunInput);
    els.runSummary.addEventListener('click', copyRunStep);
    els.runSummary.addEventListener('click', handleReportAction);
    els.reportModalBody.addEventListener('click', handleReportAction);
    els.reportModalBody.addEventListener('change', handleReportSelectionChange);
    els.reportModalActions.addEventListener('click', handleReportAction);
    els.reportModalCloseBtn.addEventListener('click', closeReportModal);
    els.reportModal.addEventListener('click', (event) => {
      if (event.target === els.reportModal) closeReportModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.reportModal.hidden) closeReportModal();
    });
    els.validateBtn.addEventListener('click', () => runCommand('validate'));
    els.testBtn.addEventListener('click', () => runCommand('test'));
    els.copyLogBtn.addEventListener('click', copyExecutionLog);
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
