import path from 'node:path';

export type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

export function formatDisplayPath(cwd: string, filePath: string): string {
  const relativePath = path.relative(cwd, filePath);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeCommandPath(relativePath);
  }

  return filePath;
}

export function normalizeCommandPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

export type InitStatus = 'success' | 'failure' | 'warning';

export function initStatusSymbol(stream: WritableLike, status: InitStatus): string {
  if (status === 'success') {
    return colorizeInit(stream, 32, '✓');
  }

  if (status === 'failure') {
    return colorizeInit(stream, 31, '✗');
  }

  return colorizeInit(stream, 33, '!');
}

export function writeInitStatus(
  stream: WritableLike,
  status: InitStatus,
  target: string,
  message: string,
): void {
  writeLine(stream, `  ${initStatusSymbol(stream, status)} ${target}  ${message}`);
}

function colorizeInit(stream: WritableLike, code: number, message: string): string {
  return shouldColorInitOutput(stream) ? `\u001b[${code}m${message}\u001b[0m` : message;
}

function shouldColorInitOutput(stream: WritableLike): boolean {
  return stream.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}
