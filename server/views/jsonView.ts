import type { ServerResponse } from 'node:http';

export function renderJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}
