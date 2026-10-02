import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationController } from './controllers/simulationController.js';
import type { ElevatorSystem } from './elevator/ElevatorSystem.js';
import { renderJson } from './views/jsonView.js';

const BODY_LIMIT = 8 * 1024;
const DEFAULT_CLIENT_DIRECTORY = fileURLToPath(new URL('../../client/', import.meta.url));
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

export function createServer(system: ElevatorSystem, clientDirectory = DEFAULT_CLIENT_DIRECTORY): Server {
  const clientRoot = resolve(clientDirectory);
  const controller = new SimulationController(system);
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      renderJson(response, 400, { error: 'Invalid request path.' });
      return;
    }

    if (pathname === '/api/state') {
      if (request.method !== 'GET') {
        renderJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      const result = controller.getState();
      renderJson(response, result.status, result.body);
      return;
    }

    if (pathname === '/api/commands') {
      if (request.method !== 'POST') {
        renderJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      try {
        const body = await readJson(request);
        const result = controller.executeCommand(body);
        renderJson(response, result.status, result.body);
      } catch (error) {
        const bodyError = error instanceof RequestBodyError
          ? error
          : new RequestBodyError(400, 'Request body must contain valid JSON.');
        renderJson(response, bodyError.status, { error: bodyError.message });
      }
      return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      renderJson(response, 404, { error: 'API route not found.' });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      renderJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    await serveClient(request, response, pathname, clientRoot);
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new RequestBodyError(413, 'Request body exceeds 8 KiB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestBodyError(400, 'Request body must contain valid JSON.');
  }
}

async function serveClient(
  request: IncomingMessage,
  response: import('node:http').ServerResponse,
  pathname: string,
  clientRoot: string,
): Promise<void> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { 'Cache-Control': 'no-store' }).end('Invalid path');
    return;
  }

  const rootWithSeparator = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;
  let requestedPath = resolve(clientRoot, `.${decodedPath}`);
  if (!requestedPath.startsWith(rootWithSeparator) && requestedPath !== clientRoot) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
    return;
  }

  let filePath = await resolveRegularFile(requestedPath, clientRoot);
  if (!filePath && (pathname === '/' || extname(decodedPath) === '')) {
    filePath = await resolveRegularFile(resolve(clientRoot, 'index.html'), clientRoot);
  }
  if (!filePath) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function resolveRegularFile(filePath: string, clientRoot: string): Promise<string | null> {
  try {
    const [actualPath, actualRoot, details] = await Promise.all([
      realpath(filePath),
      realpath(clientRoot),
      stat(filePath),
    ]);
    const actualRootWithSeparator = actualRoot.endsWith(sep) ? actualRoot : `${actualRoot}${sep}`;
    if (!details.isFile() || (!actualPath.startsWith(actualRootWithSeparator) && actualPath !== actualRoot)) {
      return null;
    }
    return actualPath;
  } catch {
    return null;
  }
}
