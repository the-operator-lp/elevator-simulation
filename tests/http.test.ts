import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ElevatorSystem } from '../server/elevator/ElevatorSystem.js';
import { createServer } from '../server/http.js';

let server: Server;
let baseUrl: string;
const servers: Server[] = [];

async function start(clientDirectory?: string): Promise<void> {
  server = createServer(new ElevatorSystem(), clientDirectory);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function get(path = '/api/state'): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function post(body: string | unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (active) => {
    active.closeAllConnections();
    await new Promise<void>((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
  }));
});

describe('HTTP API', () => {
  it('returns an uncached snapshot and accepts a hall call', async () => {
    const before = await get();
    expect(before.status).toBe(200);
    expect(before.headers.get('cache-control')).toContain('no-store');
    expect((await before.json()).elevators).toHaveLength(3);

    const response = await post({ type: 'hallCall', floor: 5, direction: 'up' });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual({ ok: true });
  });

  it('coalesces simultaneous duplicate requests before the clock advances', async () => {
    const bodies = Array.from({ length: 6 }, () => ({ type: 'hallCall', floor: 5, direction: 'up' }));
    const responses = await Promise.all(bodies.map(post));
    expect(responses.map((response) => response.status)).toEqual(Array<number>(6).fill(200));
    expect((await (await get()).json()).calls).toHaveLength(1);
  });

  it('returns 400 and preserves state for invalid commands and JSON', async () => {
    const invalidBodies = [
      '{',
      'null',
      '[]',
      { type: 'explode' },
      { type: 'destination', elevatorId: 'X', floor: 4 },
      { type: 'hallCall', floor: 4, direction: 'sideways' },
      { type: 'hallCall', floor: 11, direction: 'up' },
      { type: 'destination', elevatorId: 'A', floor: 4 },
    ];
    const before = await (await get()).json();
    for (const body of invalidBodies) {
      expect((await post(body)).status).toBe(400);
      expect(await (await get()).json()).toEqual(before);
    }
  });

  it('rejects a command body above eight KiB', async () => {
    const response = await post({ type: 'hallCall', floor: 5, direction: 'up', extra: 'x'.repeat(9000) });
    expect(response.status).toBe(413);
    expect(await (await get()).json()).toMatchObject({ elevators: expect.any(Array), calls: [] });
  });

  it('returns distinct errors for unknown routes and unsupported methods', async () => {
    expect((await get('/api/missing')).status).toBe(404);
    expect((await get('/api/commands')).status).toBe(405);
    const wrongMethod = await fetch(`${baseUrl}/api/state`, { method: 'POST', body: '' });
    expect(wrongMethod.status).toBe(405);
    expect((await post({ type: 'hallCall', floor: 5, direction: 'up' })).headers.get('content-type')).toContain('application/json');
  });

  it('serves built assets and does not expose files outside the client directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'elevator-http-'));
    const site = join(parent, 'site');
    await mkdir(join(site, 'assets'), { recursive: true });
    await writeFile(join(site, 'index.html'), '<main>simulator</main>');
    await writeFile(join(site, 'assets', 'app.js'), 'window.simulator = true;');
    await writeFile(join(parent, 'secret.txt'), 'private');
    await start(site);
    try {
      expect(await (await get('/')).text()).toContain('simulator');
      const asset = await get('/assets/app.js');
      expect(asset.headers.get('content-type')).toContain('javascript');
      expect(await asset.text()).toContain('window.simulator');
      const traversal = await get('/%2e%2e/secret.txt');
      expect(await traversal.text()).not.toContain('private');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
