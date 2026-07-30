import { readFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UI_HTML } from './html.js';

const DEFAULT_UI_APP_DIR = fileURLToPath(new URL('./app/', import.meta.url));
const UI_ASSET_PREFIX = '/ui-assets/';
const UI_APP_CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

export async function readUiJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;

    if (totalLength > 1024 * 1024) {
      throw new Error('request body is too large');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function writeUiHtml(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
  });
  response.end(UI_HTML);
}

export async function writeUiAppFile(
  response: ServerResponse,
  pathname: string,
  appDir = DEFAULT_UI_APP_DIR,
): Promise<boolean> {
  const relativePath = resolveUiAppRelativePath(pathname);

  if (relativePath === undefined) {
    return false;
  }

  const contentType = UI_APP_CONTENT_TYPES.get(path.extname(relativePath));

  if (contentType === undefined) {
    return false;
  }

  const root = path.resolve(appDir);
  const filePath = path.resolve(root, relativePath);
  const nestedPath = path.relative(root, filePath);

  if (nestedPath === '..' || nestedPath.startsWith(`..${path.sep}`) || path.isAbsolute(nestedPath)) {
    return false;
  }

  let body: Buffer;

  try {
    body = await readFile(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT') ||
        isNodeErrorCode(error, 'ENOTDIR') ||
        isNodeErrorCode(error, 'EISDIR')) {
      return false;
    }

    throw error;
  }

  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': relativePath === 'index.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
  return true;
}

export function writeUiJson(response: ServerResponse, statusCode: number, data: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  });
  response.end(JSON.stringify(data));
}

export function normalizeUiHost(value: string | undefined): string {
  const host = value?.trim() ?? '127.0.0.1';

  if (!host) {
    throw new Error('--host must not be empty');
  }

  return host;
}

export function parseUiPort(value: string | undefined): number {
  if (value === undefined) {
    return 3766;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }

  return port;
}

export async function listenUiServer(
  server: Server,
  host: string,
  port: number,
  explicitPort: boolean,
): Promise<number> {
  const maxAttempts = explicitPort || port === 0 ? 1 : 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = port === 0 ? 0 : port + attempt;

    try {
      return await listenUiServerOnce(server, host, candidatePort);
    } catch (error) {
      if (explicitPort || !isNodeErrorCode(error, 'EADDRINUSE')) {
        throw error;
      }
    }
  }

  throw new Error(`No available port found starting at ${port}`);
}

export function closeUiServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function listenUiServerOnce(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address() as AddressInfo;
      resolve(address.port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function resolveUiAppRelativePath(pathname: string): string | undefined {
  if (pathname === '/' || pathname === '/index.html' ||
      pathname === '/next' || pathname === '/next/' || pathname === '/next/index.html') {
    return 'index.html';
  }

  if (!pathname.startsWith(UI_ASSET_PREFIX)) {
    return undefined;
  }

  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(pathname.slice(UI_ASSET_PREFIX.length)).replaceAll('\\', '/');
  } catch {
    return undefined;
  }

  const segments = decodedPath.split('/');

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return undefined;
  }

  return segments.join(path.sep);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
