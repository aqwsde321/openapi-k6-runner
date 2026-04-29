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

type WritableLike = {
  write(chunk: string): unknown;
};

export interface ScenarioConsoleReporterOptions {
  color?: boolean;
  responseBodyLimit?: number;
}

interface AnsiColors {
  bold(value: string): string;
  dim(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  red(value: string): string;
}

export function createScenarioConsoleReporter(
  stream: WritableLike,
  options: ScenarioConsoleReporterOptions = {},
): ScenarioExecutionReporter {
  const colors = createAnsiColors(options.color === true);
  const responseBodyLimit = options.responseBodyLimit ?? DEFAULT_RESPONSE_BODY_LIMIT;

  return {
    onScenarioStart(event) {
      writeScenarioStart(stream, event, colors);
    },
    onStepStart(event) {
      writeStepStart(stream, event);
    },
    onStepRequest(event) {
      writeStepRequest(stream, event, colors);
    },
    onStepEnd(event) {
      writeStepEnd(stream, event, colors, responseBodyLimit);
    },
    onScenarioEnd(result) {
      writeScenarioEnd(stream, result, colors);
    },
  };
}

function writeScenarioStart(stream: WritableLike, event: ScenarioStartEvent, colors: AnsiColors): void {
  stream.write(formatField('scenario', colors.bold(maskText(event.scenario, event.secretValues))));
  stream.write(formatField('base url', maskText(event.baseUrl, event.secretValues)));
  stream.write(formatField('steps', String(event.totalSteps)));
  stream.write('\n');
}

function writeStepStart(stream: WritableLike, event: StepStartEvent): void {
  stream.write(`     [${event.index + 1}/${event.totalSteps}] ${event.id}\n`);
  stream.write(formatField('request', `${event.method} ${event.path}`, 6));
}

function writeStepRequest(stream: WritableLike, event: StepRequestEvent, colors: AnsiColors): void {
  stream.write(formatField('url', colors.dim(maskText(event.url, event.secretValues)), 6));
  stream.write(formatField('state', colors.yellow('→ running'), 6));
}

function writeStepEnd(
  stream: WritableLike,
  event: StepEndEvent,
  colors: AnsiColors,
  responseBodyLimit: number,
): void {
  const { result } = event;

  if (result.response !== undefined) {
    stream.write(formatField(
      'result',
      `${formatOutcome(result.passed, colors)}  ${colorStatus(result.response.status, formatStatus(result.response), colors)}  ${colors.dim(formatDuration(result.durationMs))}`,
      6,
    ));
  } else {
    stream.write(formatField('result', `${colors.red('✗ ERROR')}  ${colors.dim(formatDuration(result.durationMs))}`, 6));
  }

  if (result.condition !== undefined) {
    stream.write(formatField(
      'checks',
      `${formatCheckMark(result.condition.passed, colors)} ${result.condition.expression}`,
      6,
    ));
  }

  for (const extract of result.extracts) {
    const name = extract.name.padEnd(extractNameWidth(result));
    const message = extract.passed
      ? `${formatCheckMark(true, colors)} ${name}`
      : `${formatCheckMark(false, colors)} ${name} (${maskText(extract.error ?? 'unknown error', event.secretValues)})`;
    stream.write(formatField('extract', message, 6));
  }

  if (result.error !== undefined) {
    stream.write(formatField('error', `${formatCheckMark(false, colors)} ${colors.red(maskText(result.error, event.secretValues))}`, 6));
  }

  if (!result.passed && result.response?.body) {
    stream.write(formatField('body', '', 6));
    stream.write(`${indentBody(truncateText(maskText(result.response.body, event.secretValues), responseBodyLimit))}\n`);
  }

  stream.write('\n');
}

function writeScenarioEnd(stream: WritableLike, result: ScenarioExecutionResult, colors: AnsiColors): void {
  const passedSteps = result.steps.filter((step) => step.passed).length;

  stream.write(formatField('summary', formatOutcome(result.passed, colors)));
  stream.write(formatField('steps', `${passedSteps}/${result.steps.length} passed`));
  stream.write(formatField('duration', formatDuration(result.durationMs)));
}

function formatField(label: string, value: string, indent = 5): string {
  return `${' '.repeat(indent)}${label.padStart(FIELD_WIDTH)}: ${value}\n`;
}

function formatStatus(response: { status: number; statusText: string }): string {
  return response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)}ms`;
}

function formatOutcome(passed: boolean, colors: AnsiColors): string {
  return passed ? colors.green('✓ PASS') : colors.red('✗ FAIL');
}

function formatCheckMark(passed: boolean, colors: AnsiColors): string {
  return passed ? colors.green('✓') : colors.red('✗');
}

function colorStatus(status: number, value: string, colors: AnsiColors): string {
  if (status >= 200 && status < 300) {
    return colors.green(value);
  }

  if (status >= 400) {
    return colors.red(value);
  }

  return colors.yellow(value);
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
    green: (value) => colorize(value, '32', enabled),
    yellow: (value) => colorize(value, '33', enabled),
    red: (value) => colorize(value, '31', enabled),
  };
}

function colorize(value: string, code: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}
