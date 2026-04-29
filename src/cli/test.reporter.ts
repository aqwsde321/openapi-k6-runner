import type {
  ScenarioExecutionReporter,
  ScenarioExecutionResult,
  ScenarioStartEvent,
  StepEndEvent,
  StepRequestEvent,
  StepStartEvent,
} from '../executor/scenario.executor.js';

const DEFAULT_RESPONSE_BODY_LIMIT = 2000;
const FIELD_WIDTH = 8;
const DEFAULT_LIVE_INTERVAL_MS = 250;

type WritableLike = {
  write(chunk: string): unknown;
};

export interface ScenarioConsoleReporterOptions {
  color?: boolean;
  live?: boolean;
  liveIntervalMs?: number;
  responseBodyLimit?: number;
}

interface AnsiColors {
  bold(value: string): string;
  dim(value: string): string;
  grey(value: string): string;
  cyan(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  red(value: string): string;
}

interface LiveState {
  lastLength: number;
  timer: ReturnType<typeof setInterval>;
}

export function createScenarioConsoleReporter(
  stream: WritableLike,
  options: ScenarioConsoleReporterOptions = {},
): ScenarioExecutionReporter {
  const colors = createAnsiColors(options.color === true);
  const live = options.live === true;
  const liveIntervalMs = options.liveIntervalMs ?? DEFAULT_LIVE_INTERVAL_MS;
  const responseBodyLimit = options.responseBodyLimit ?? DEFAULT_RESPONSE_BODY_LIMIT;
  let liveState: LiveState | undefined;

  return {
    onScenarioStart(event) {
      writeScenarioStart(stream, event, colors);
    },
    onStepStart(event) {
      writeStepStart(stream, event, colors);
    },
    onStepRequest(event) {
      liveState = writeStepRequest(stream, event, colors, live, liveIntervalMs);
    },
    onStepEnd(event) {
      finishLiveState(stream, liveState);
      liveState = undefined;
      writeStepEnd(stream, event, colors, responseBodyLimit);
    },
    onScenarioEnd(result) {
      finishLiveState(stream, liveState);
      liveState = undefined;
      writeScenarioEnd(stream, result, colors);
    },
  };
}

function writeScenarioStart(stream: WritableLike, event: ScenarioStartEvent, colors: AnsiColors): void {
  stream.write(formatField('scenario', colors.bold(colors.cyan(maskText(event.scenario, event.secretValues))), 5, colors));
  stream.write(formatField('base url', colors.cyan(maskText(event.baseUrl, event.secretValues)), 5, colors));
  stream.write(formatField('steps', colors.cyan(String(event.totalSteps)), 5, colors));
  stream.write('\n');
}

function writeStepStart(stream: WritableLike, event: StepStartEvent, colors: AnsiColors): void {
  stream.write(`     [${event.index + 1}/${event.totalSteps}] ${event.id}\n`);
  stream.write(formatField('request', `${colors.cyan(event.method)} ${event.path}`, 6, colors));
}

function writeStepRequest(
  stream: WritableLike,
  event: StepRequestEvent,
  colors: AnsiColors,
  live: boolean,
  liveIntervalMs: number,
): LiveState | undefined {
  stream.write(formatField('url', colors.dim(maskText(event.url, event.secretValues)), 6, colors));

  if (!live) {
    stream.write(formatField('state', colors.cyan('→ running'), 6, colors));
    return undefined;
  }

  const startedAt = Date.now();
  const state: LiveState = {
    lastLength: 0,
    timer: setInterval(() => {
      writeLiveState(stream, state, startedAt, colors);
    }, liveIntervalMs),
  };

  writeLiveState(stream, state, startedAt, colors);
  return state;
}

function writeStepEnd(
  stream: WritableLike,
  event: StepEndEvent,
  colors: AnsiColors,
  responseBodyLimit: number,
): void {
  const { result } = event;
  const hasAssertions = result.condition !== undefined || result.extracts.length > 0;

  if (result.response !== undefined) {
    stream.write(formatField(
      'status',
      `${formatStatusMark(result, colors)} ${colorStepStatus(result, formatStatus(result.response), colors)}  ${colors.cyan(formatDuration(result.durationMs))}`,
      6,
      colors,
    ));
  } else {
    stream.write(formatField('result', `${colors.red('✗ ERROR')}  ${colors.cyan(formatDuration(result.durationMs))}`, 6, colors));
  }

  if (result.response !== undefined && (hasAssertions || !result.passed)) {
    stream.write(formatField('result', formatOutcome(result.passed, colors), 6, colors));
  }

  if (result.condition !== undefined) {
    stream.write(formatField(
      'checks',
      `${formatCheckMark(result.condition.passed, colors)} ${result.condition.expression}`,
      6,
      colors,
    ));
  }

  for (const extract of result.extracts) {
    const name = extract.name.padEnd(extractNameWidth(result));
    const message = extract.passed
      ? `${formatCheckMark(true, colors)} ${name}`
      : `${formatCheckMark(false, colors)} ${name} (${maskText(extract.error ?? 'unknown error', event.secretValues)})`;
    stream.write(formatField('extract', message, 6, colors));
  }

  if (result.error !== undefined) {
    stream.write(formatField('error', `${formatCheckMark(false, colors)} ${colors.red(maskText(result.error, event.secretValues))}`, 6, colors));
  }

  if (!result.passed && result.response?.body) {
    stream.write(formatField('body', '', 6, colors));
    stream.write(`${indentBody(truncateText(maskText(result.response.body, event.secretValues), responseBodyLimit))}\n`);
  }

  stream.write('\n');
}

function writeScenarioEnd(stream: WritableLike, result: ScenarioExecutionResult, colors: AnsiColors): void {
  const passedSteps = result.steps.filter((step) => step.passed).length;

  stream.write(formatField('summary', formatOutcome(result.passed, colors), 5, colors));
  stream.write(formatField('steps', colors.cyan(`${passedSteps}/${result.steps.length} passed`), 5, colors));
  stream.write(formatField('duration', colors.cyan(formatDuration(result.durationMs)), 5, colors));
}

function formatField(label: string, value: string, indent = 5, colors?: AnsiColors): string {
  return `${formatFieldLine(label, value, indent, colors)}\n`;
}

function formatFieldLine(label: string, value: string, indent = 5, colors?: AnsiColors): string {
  const paddedLabel = label.padStart(FIELD_WIDTH);
  const formattedLabel = colors === undefined ? paddedLabel : colors.grey(paddedLabel);

  return `${' '.repeat(indent)}${formattedLabel}: ${value}`;
}

function formatStatus(response: { status: number; statusText: string }): string {
  return response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)}ms`;
}

function formatLiveDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatOutcome(passed: boolean, colors: AnsiColors): string {
  return passed ? colors.green('✓ PASS') : colors.red('✗ FAIL');
}

function formatCheckMark(passed: boolean, colors: AnsiColors): string {
  return passed ? colors.green('✓') : colors.red('✗');
}

function formatStatusMark(result: StepEndEvent['result'], colors: AnsiColors): string {
  const status = result.response?.status;

  if (status === undefined) {
    return colors.red('✗');
  }

  if (result.condition !== undefined) {
    return formatCheckMark(result.condition.passed, colors);
  }

  if (status >= 200 && status < 300) {
    return colors.green('✓');
  }

  if (status >= 400) {
    return colors.red('✗');
  }

  return colors.yellow('→');
}

function colorStatus(status: number, value: string, colors: AnsiColors): string {
  if (status >= 200 && status < 300) {
    return colors.cyan(value);
  }

  if (status >= 400) {
    return colors.red(value);
  }

  return colors.yellow(value);
}

function colorStepStatus(result: StepEndEvent['result'], value: string, colors: AnsiColors): string {
  if (result.condition !== undefined) {
    return result.condition.passed ? colors.green(value) : colors.red(value);
  }

  return result.response === undefined ? colors.red(value) : colorStatus(result.response.status, value, colors);
}

function writeLiveState(
  stream: WritableLike,
  state: LiveState,
  startedAt: number,
  colors: AnsiColors,
): void {
  const line = formatFieldLine(
    'state',
    `${colors.cyan('→ running')} ${colors.cyan(formatLiveDuration(Date.now() - startedAt))}`,
    6,
    colors,
  );
  const length = visibleLength(line);
  const padding = ' '.repeat(Math.max(0, state.lastLength - length));

  stream.write(`\r${line}${padding}`);
  state.lastLength = length;
}

function finishLiveState(stream: WritableLike, state: LiveState | undefined): void {
  if (state === undefined) {
    return;
  }

  clearInterval(state.timer);
  stream.write('\n');
}

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function extractNameWidth(result: { extracts: Array<{ name: string }> }): number {
  return Math.max(1, ...result.extracts.map((extract) => extract.name.length));
}

function indentBody(value: string): string {
  return value
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function truncateText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...<truncated ${value.length - limit} chars>` : value;
}

function maskText(value: string, secretValues: string[]): string {
  return secretValues
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((text, secret) => text.split(secret).join('***'), value);
}

function createAnsiColors(enabled: boolean): AnsiColors {
  return {
    bold: (value) => colorize(value, '1', enabled),
    dim: (value) => colorize(value, '2', enabled),
    grey: (value) => colorize(value, '90', enabled),
    cyan: (value) => colorize(value, '36', enabled),
    green: (value) => colorize(value, '32', enabled),
    yellow: (value) => colorize(value, '33', enabled),
    red: (value) => colorize(value, '91', enabled),
  };
}

function colorize(value: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}
