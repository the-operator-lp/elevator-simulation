import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test as base, type Page } from '@playwright/test';
import type { ElevatorId, SimulationSnapshot } from '../../shared/contracts.js';

interface Simulator {
  readonly baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  const { port } = address;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
}

class LocalSimulator implements Simulator {
  readonly baseUrl: string;
  readonly #port: number;
  #child: ChildProcess | undefined;
  #output = '';

  constructor(port: number) {
    this.#port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async start(): Promise<void> {
    if (this.#child && this.#child.exitCode === null && this.#child.signalCode === null) return;
    this.#output = '';
    const child = spawn(process.execPath, [resolve(process.cwd(), 'dist/server/server/main.js')], {
      env: { ...process.env, PORT: String(this.#port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.#child = child;
    child.stdout?.on('data', (chunk: Buffer) => { this.#output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { this.#output += chunk.toString(); });

    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Production server exited before becoming ready. ${this.#output}`);
      }
      try {
        const response = await fetch(`${this.baseUrl}/api/state`);
        if (response.ok) return;
      } catch {
      }
      await delay(100);
    }
    await this.stop();
    throw new Error(`Production server did not become ready. ${this.#output}`);
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    if (await waitForExit(child, 3_000)) return;
    child.kill('SIGKILL');
    if (!(await waitForExit(child, 1_000))) {
      throw new Error(`Production server did not stop. ${this.#output}`);
    }
  }
}

const test = base.extend<{ simulator: Simulator }>({
  simulator: async ({}, use) => {
    const simulator = new LocalSimulator(await reservePort());
    await simulator.start();
    await use(simulator);
    await simulator.stop();
  },
});

async function readState(page: Page): Promise<SimulationSnapshot> {
  const response = await page.request.get(new URL('/api/state', page.url()).toString());
  expect(response.ok()).toBeTruthy();
  return await response.json() as SimulationSnapshot;
}

async function callFloor(page: Page, floor: number, direction: 'up' | 'down', times = 1): Promise<void> {
  const button = page.getByRole('button', { name: `Floor ${floor} ${direction}` });
  for (let count = 0; count < times; count += 1) await button.click();
}

function carById(state: SimulationSnapshot, id: ElevatorId) {
  const car = state.elevators.find((candidate) => candidate.id === id);
  if (!car) throw new Error(`Elevator ${id} is missing from the server snapshot.`);
  return car;
}

test('serves same-floor calls in their requested directions and keeps held doors open', async ({ page, simulator }) => {
  test.setTimeout(90_000);
  await page.goto(simulator.baseUrl);
  await expect(page.getByRole('button', { name: 'Floor 1 up' })).toBeVisible();

  await callFloor(page, 2, 'up');
  await expect(page.getByRole('group', { name: 'Elevator B status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator B hold door' }).click();
  await expect(page.getByRole('group', { name: 'Elevator B status' })).toContainText('Held open');

  await callFloor(page, 10, 'down');
  await expect(page.getByRole('group', { name: 'Elevator C status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator C hold door' }).click();
  await expect(page.getByRole('group', { name: 'Elevator C status' })).toContainText('Held open');

  await callFloor(page, 1, 'up');
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator A go to Floor 10' }).click();
  await page.getByRole('button', { name: 'Elevator A close door' }).click();
  await callFloor(page, 5, 'up', 3);
  await callFloor(page, 5, 'down');

  await expect.poll(async () => {
    const state = await readState(page);
    return state.calls.filter((call) => call.floor === 5 && call.direction === 'up').length;
  }).toBe(1);
  await expect.poll(async () => {
    const state = await readState(page);
    return state.calls.find((call) => call.floor === 5 && call.direction === 'up')?.assignedTo;
  }).toBe('A');

  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Floor 5');
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Doors open');
  await expect.poll(async () => {
    const state = await readState(page);
    return carById(state, 'A').direction;
  }).toBe('up');
  await page.getByRole('button', { name: 'Elevator A hold door' }).click();
  const beforeHold = carById(await readState(page), 'A');
  await delay(2_400);
  const afterHold = carById(await readState(page), 'A');
  expect(afterHold.floor).toBe(beforeHold.floor);
  expect(afterHold.door).toBe('open');
  expect(afterHold.held).toBe(true);
  expect((await readState(page)).calls).toContainEqual(expect.objectContaining({ floor: 5, direction: 'down', assignedTo: 'A' }));

  await page.getByRole('button', { name: 'Elevator A close door' }).click();
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Floor 10');
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Doors open');
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Floor 5');
  await expect.poll(async () => {
    const state = await readState(page);
    const car = carById(state, 'A');
    return car.floor === 5 && car.door === 'open' && car.direction === 'down';
  }).toBe(true);
});

test('deduplicates repeated calls, moves all three cars concurrently, and preserves server state after refresh', async ({ page, simulator }) => {
  await page.goto(simulator.baseUrl);
  await expect(page.getByRole('button', { name: 'Floor 1 up' })).toBeVisible();
  await callFloor(page, 1, 'up');
  await expect(page.getByRole('group', { name: 'Elevator A status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator A go to Floor 10' }).click();
  await page.getByRole('button', { name: 'Elevator A close door' }).click();

  await callFloor(page, 2, 'up');
  await expect(page.getByRole('group', { name: 'Elevator B status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator B go to Floor 8' }).click();
  await page.getByRole('button', { name: 'Elevator B close door' }).click();

  await callFloor(page, 10, 'down');
  await expect(page.getByRole('group', { name: 'Elevator C status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator C go to Floor 9' }).click();
  await page.getByRole('button', { name: 'Elevator C go to Floor 1', exact: true }).click();
  await page.getByRole('button', { name: 'Elevator C close door' }).click();

  await expect.poll(async () => {
    const state = await readState(page);
    return state.elevators.filter((car) => car.nextFloor !== null).length;
  }).toBe(3);

  await callFloor(page, 8, 'down', 3);
  await callFloor(page, 3, 'up');
  await expect.poll(async () => {
    const state = await readState(page);
    return state.calls.filter((call) => call.floor === 8 && call.direction === 'down').length;
  }).toBe(1);

  const beforeRefresh = await readState(page);
  const instanceId = beforeRefresh.instanceId;
  expect(carById(beforeRefresh, 'A').destinations).toContain(10);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Floor 1 up' })).toBeVisible();
  await expect.poll(async () => (await readState(page)).instanceId).toBe(instanceId);
  const afterRefresh = await readState(page);
  expect(carById(afterRefresh, 'A').destinations).toContain(10);
  expect(afterRefresh.calls.filter((call) => call.floor === 8 && call.direction === 'down')).toHaveLength(1);
});

test('keeps an assigned-call row at a fixed height on mobile', async ({ page, simulator }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(simulator.baseUrl);
  await expect(page.getByRole('button', { name: 'Floor 1 up' })).toBeVisible();
  const floor5 = page.getByRole('listitem', { name: 'Floor 5' });
  const floor5Height = await floor5.evaluate((row) => row.getBoundingClientRect().height);

  await callFloor(page, 2, 'up');
  await expect(page.getByRole('group', { name: 'Elevator B status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator B hold door' }).click();
  await callFloor(page, 10, 'down');
  await expect(page.getByRole('group', { name: 'Elevator C status' })).toContainText('Doors open');
  await page.getByRole('button', { name: 'Elevator C hold door' }).click();
  await callFloor(page, 5, 'up');
  await expect.poll(async () => {
    const state = await readState(page);
    return state.calls.find((call) => call.floor === 5 && call.direction === 'up')?.assignedTo;
  }).toBe('A');
  await callFloor(page, 5, 'down');

  const upCall = page.getByRole('button', { name: 'Floor 5 up' });
  const downCall = page.getByRole('button', { name: 'Floor 5 down' });
  await expect(upCall).toHaveAttribute('aria-pressed', 'true');
  await expect(downCall).toHaveAttribute('aria-pressed', 'true');
  await expect(upCall).toHaveText('↑up');
  await expect(downCall).toHaveText('↓down');
  await expect(upCall).not.toHaveAttribute('title', /.+/);
  await expect(downCall).not.toHaveAttribute('title', /.+/);
  const activeBackground = await upCall.evaluate((button) => getComputedStyle(button).backgroundColor);
  const idleBackground = await page.getByRole('button', { name: 'Floor 6 up' }).evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(activeBackground).not.toBe(idleBackground);
  await expect.poll(async () => floor5.evaluate((row) => row.getBoundingClientRect().height)).toBe(floor5Height);
});

test('matches building and elevator pane heights on desktop and stacks them on tablet', async ({ page, simulator }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(simulator.baseUrl);
  await expect(page.locator('.building-panel')).toBeVisible();
  const [buildingHeight, elevatorHeight] = await Promise.all([
    page.locator('.building-panel').evaluate((pane) => pane.getBoundingClientRect().height),
    page.locator('.elevator-panels').evaluate((pane) => pane.getBoundingClientRect().height),
  ]);
  expect(Math.abs(buildingHeight - elevatorHeight)).toBeLessThan(1);

  await page.setViewportSize({ width: 768, height: 900 });
  const [buildingBottom, elevatorsTop] = await Promise.all([
    page.locator('.building-panel').evaluate((pane) => pane.getBoundingClientRect().bottom),
    page.locator('.elevator-panels').evaluate((pane) => pane.getBoundingClientRect().top),
  ]);
  expect(buildingBottom).toBeLessThan(elevatorsTop);
});

test('animates car movement continuously between simulation updates', async ({ page, simulator }) => {
  await page.goto(simulator.baseUrl);
  const marker = page.locator('.shaft-track').nth(1).locator('.car-marker');
  await expect(marker).toBeVisible();
  await expect.poll(() => marker.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.transitionProperty}|${style.transitionDuration}|${style.transitionTimingFunction}`;
  })).toBe('top|0.1s|linear');
});

test('reports an offline server, then reconnects to a fresh in-memory instance', async ({ page, simulator }) => {
  await page.goto(simulator.baseUrl);
  await expect(page.getByRole('button', { name: 'Floor 5 up' })).toBeVisible();
  const firstState = await readState(page);
  await callFloor(page, 5, 'up');
  await expect.poll(async () => (await readState(page)).calls.some((call) => call.floor === 5 && call.direction === 'up')).toBe(true);
  await simulator.stop();

  await expect(page.getByRole('alert')).toContainText(/connection lost/i);
  await expect(page.getByRole('button', { name: 'Floor 5 up' })).toBeDisabled();
  const retainedRevision = await page.getByRole('main').getAttribute('data-revision');
  expect(retainedRevision).not.toBeNull();
  await delay(400);
  await expect(page.getByRole('main')).toHaveAttribute('data-revision', retainedRevision ?? '');

  await simulator.start();
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Floor 5 up' })).toBeEnabled();
  const restartedState = await readState(page);
  expect(restartedState.instanceId).not.toBe(firstState.instanceId);
  expect(restartedState.elevators.map((car) => car.floor)).toEqual([1, 2, 10]);
  expect(restartedState.calls).toEqual([]);
});
