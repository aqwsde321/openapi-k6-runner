import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { UI_HTML } from './html.js';

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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
