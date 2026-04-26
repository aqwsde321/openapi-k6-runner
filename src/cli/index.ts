#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAst } from '../compiler/ast.builder.js';
import { generateK6Script } from '../compiler/k6.generator.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';

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

export interface SyncOptions {
  openapi: string;
  write: string;
  catalog: string;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  baseUrl: string;
}

export interface SyncResult {
  snapshotPath: string;
  catalogPath: string;
  openapiPath: string;
  operationCount: number;
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

function resolveOpenApiInput(cwd: string, value: string): string {
  if (isHttpUrl(value)) {
    return value;
  }

  return path.resolve(cwd, value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const scenarioPath = path.resolve(cwd, options.scenario);
  const openapiPath = resolveOpenApiInput(cwd, options.openapi);
  const scenario = await parseScenarioFile(scenarioPath);
  const registry = await parseOpenApiFile(openapiPath);
  const baseUrl = (await loadBaseUrl(cwd)) ?? registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error('BASE_URL is not configured and OpenAPI servers[0].url is missing.');
  }

  const ast = buildAst(scenario, registry);
  const script = generateK6Script(ast, { baseUrl });
  const result: GenerateResult = {
    outputPath: path.resolve(cwd, options.write),
    scenarioPath,
    openapiPath,
    baseUrl,
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, script, 'utf8');

  return result;
}

export async function runSyncCommand(
  options: SyncOptions,
  context: CliContext = {},
): Promise<SyncResult> {
  const cwd = resolveCwd(context);
  const openapiPath = resolveOpenApiInput(cwd, options.openapi);
  const snapshotPath = path.resolve(cwd, options.write);
  const catalogPath = path.resolve(cwd, options.catalog);
  const result = await syncOpenApiSnapshot({
    openapi: openapiPath,
    write: snapshotPath,
    catalog: catalogPath,
  });

  return {
    openapiPath,
    snapshotPath: result.snapshotPath,
    catalogPath: result.catalogPath,
    operationCount: result.operationCount,
  };
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
    .description('Generate a k6 script for the configured scenario.')
    .requiredOption('-s, --scenario <path>', 'Scenario DSL file path')
    .requiredOption('-o, --openapi <path>', 'OpenAPI spec file path')
    .requiredOption('-w, --write <path>', 'Output k6 script path')
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  program
    .command('sync')
    .description('Write an OpenAPI snapshot and endpoint catalog.')
    .requiredOption('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .requiredOption('-w, --write <path>', 'Output OpenAPI snapshot path')
    .requiredOption('-c, --catalog <path>', 'Output endpoint catalog path')
    .action(async (options: SyncOptions) => {
      const result = await runSyncCommand(options, context);
      writeLine(stdout, `Synced ${result.snapshotPath}`);
      writeLine(stdout, `Catalog ${result.catalogPath} (${result.operationCount} operations)`);
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
