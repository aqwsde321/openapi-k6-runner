import { spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeLine, type WritableLike } from './display.js';

export interface K6RunResult {
  logPath?: string;
  reportPath?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export async function runK6Script(options: {
  cwd: string;
  loadTestDir: string;
  scenarioName: string;
  scriptPath: string;
  runtimeEnv: Record<string, string | undefined>;
  k6Args: string[];
  log: boolean;
  trace: boolean;
  report: boolean;
  openDashboard: boolean;
  stdout: WritableLike;
  stderr: WritableLike;
}): Promise<K6RunResult> {
  const env = toProcessEnv(options.runtimeEnv);
  const logsDir = path.join(options.loadTestDir, 'logs');
  const logPath = options.log ? path.join(logsDir, `${options.scenarioName}.log`) : undefined;
  let reportPath: string | undefined;

  if (options.trace) {
    env.OPENAPI_K6_TRACE = '1';
  }

  if (options.report) {
    env.K6_WEB_DASHBOARD = 'true';
    env.K6_WEB_DASHBOARD_PERIOD = env.K6_WEB_DASHBOARD_PERIOD ?? '1s';
    env.K6_WEB_DASHBOARD_EXPORT = env.K6_WEB_DASHBOARD_EXPORT ??
      path.join(logsDir, `${options.scenarioName}-report.html`);
    reportPath = env.K6_WEB_DASHBOARD_EXPORT;
    await fs.mkdir(resolveChildOutputDir(options.cwd, reportPath), { recursive: true });
    writeLine(options.stdout, `Writing k6 HTML report to ${reportPath}`);
  }

  if (options.openDashboard) {
    env.K6_WEB_DASHBOARD = 'true';
    env.K6_WEB_DASHBOARD_OPEN = 'true';
  }

  if (logPath !== undefined) {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    writeLine(options.stdout, `Writing k6 output to ${logPath}`);
  }

  const result = await spawnK6({
    cwd: options.cwd,
    env,
    args: ['run', ...options.k6Args, options.scriptPath],
    logPath,
    stdout: options.stdout,
    stderr: options.stderr,
  });

  return {
    ...(logPath === undefined ? {} : { logPath }),
    ...(reportPath === undefined ? {} : { reportPath }),
    exitCode: result.exitCode,
    signal: result.signal,
  };
}

function toProcessEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function resolveChildOutputDir(cwd: string, filePath: string): string {
  const directory = path.dirname(filePath);
  return path.isAbsolute(directory) ? directory : path.resolve(cwd, directory);
}

async function spawnK6(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: string[];
  logPath?: string;
  stdout: WritableLike;
  stderr: WritableLike;
}): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const logStream = options.logPath === undefined ? undefined : createWriteStream(options.logPath);
    const child = spawn('k6', options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      void closeLogStream(logStream).finally(() => reject(formatK6SpawnError(error)));
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.stdout.write(text);
      logStream?.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.stderr.write(text);
      logStream?.write(chunk);
    });
    child.on('error', rejectOnce);
    logStream?.on('error', rejectOnce);
    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      void closeLogStream(logStream)
        .then(() => resolve({ exitCode, signal }))
        .catch(reject);
    });
  });
}

async function closeLogStream(stream: WriteStream | undefined): Promise<void> {
  if (stream === undefined || stream.closed || stream.destroyed) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}

function formatK6SpawnError(error: unknown): Error {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    return new Error('k6 executable was not found. Install k6 and make sure it is available on PATH.');
  }

  return error instanceof Error ? error : new Error(String(error));
}
