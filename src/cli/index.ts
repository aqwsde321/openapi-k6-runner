#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type WritableLike = {
  write(chunk: string): unknown;
};

export interface CliContext {
  cwd?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}

export interface GenerateOptions {
  scenario: string;
  openapi: string;
  write: string;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  baseUrl?: string;
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

async function loadBaseUrl(cwd: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, '.env'), 'utf8');
    const parsed = parseDotEnv(raw);
    const baseUrl = parsed.BASE_URL?.trim();
    return baseUrl || undefined;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }

    throw error;
  }
}

function renderPlaceholderScript(result: GenerateResult): string {
  const baseUrlLiteral = JSON.stringify(result.baseUrl ?? '');

  return [
    "import http from 'k6/http';",
    '',
    `const BASE_URL = __ENV.BASE_URL || ${baseUrlLiteral};`,
    '',
    'export default function () {',
    '  // P-01 placeholder: Scenario/OpenAPI parsing is implemented in later phases.',
    `  // scenario: ${result.scenarioPath}`,
    `  // openapi: ${result.openapiPath}`,
    '',
    '  if (!BASE_URL) {',
    "    throw new Error('BASE_URL is not configured.');",
    '  }',
    '',
    '  http.get(BASE_URL);',
    '}',
    '',
  ].join('\n');
}

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const result: GenerateResult = {
    outputPath: path.resolve(cwd, options.write),
    scenarioPath: path.resolve(cwd, options.scenario),
    openapiPath: path.resolve(cwd, options.openapi),
    baseUrl: await loadBaseUrl(cwd),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, renderPlaceholderScript(result), 'utf8');

  return result;
}

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

export function createProgram(context: CliContext = {}): Command {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const program = new Command();

  program
    .name('openapi-k6')
    .description('Generate k6 scripts from OpenAPI specs and Scenario DSL files.')
    .version('0.1.0')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
    });

  program
    .command('generate')
    .description('Generate a k6 script placeholder for the configured scenario.')
    .requiredOption('-s, --scenario <path>', 'Scenario DSL file path')
    .requiredOption('-o, --openapi <path>', 'OpenAPI spec file path')
    .requiredOption('-w, --write <path>', 'Output k6 script path')
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  return program;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  context: CliContext = {},
): Promise<void> {
  const program = createProgram(context);
  await program.parseAsync(argv, { from: 'user' });
}

async function main(): Promise<void> {
  try {
    await runCli();
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (fileURLToPath(import.meta.url) === entryPath) {
  void main();
}
