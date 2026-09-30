import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICK_MS } from '../shared/contracts.js';
import { ElevatorSystem } from './elevator/ElevatorSystem.js';
import { createServer } from './http.js';

const rawPort = process.env.PORT;
const port = rawPort === undefined ? 3001 : Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new RangeError('PORT must be an integer between 1 and 65535.');
}

const clientDirectory = import.meta.url.endsWith('.ts')
  ? resolve(import.meta.dirname, '../dist/client')
  : fileURLToPath(new URL('../../client/', import.meta.url));
const system = new ElevatorSystem();
const server = createServer(system, clientDirectory);
let previousTime = performance.now();
let remainderMs = 0;
const timer = setInterval(() => {
  const now = performance.now();
  remainderMs += now - previousTime;
  previousTime = now;
  while (remainderMs >= TICK_MS) {
    system.tick();
    remainderMs -= TICK_MS;
  }
}, TICK_MS);

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Elevator simulator API listening on port ${port}.\n`);
});

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
