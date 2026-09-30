import {
  isFloor,
  isValidHallCall,
  type Command,
  type CommandResult,
  type ElevatorId,
  type ElevatorSnapshot,
  type SimulationSnapshot,
} from '../shared/contracts.js';

const ELEVATOR_IDS: readonly ElevatorId[] = ['A', 'B', 'C'];

export async function getState(signal?: AbortSignal): Promise<SimulationSnapshot> {
  const response = await fetch('/api/state', {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(body, `Could not load simulator state (HTTP ${response.status}).`));
  if (!isSimulationSnapshot(body)) throw new Error('The server returned an invalid simulation snapshot.');
  return body;
}

export async function sendCommand(
  command: Command,
): Promise<{ result: CommandResult; state: SimulationSnapshot }> {
  const response = await fetch('/api/commands', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body: unknown = await readJson(response);
  if (!isRecord(body)) throw new Error(errorMessage(body, `Command failed (HTTP ${response.status}).`));
  if (!isCommandResult(body.result) || !isSimulationSnapshot(body.state)) {
    throw new Error(errorMessage(body, `Command failed (HTTP ${response.status}).`));
  }
  return { result: body.result, state: body.state };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
}

function errorMessage(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === 'string' && value.error.length > 0) return value.error;
  if (isRecord(value) && isRecord(value.result)
    && value.result.ok === false && typeof value.result.error === 'string') {
    return value.result.error;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandResult(value: unknown): value is CommandResult {
  return isRecord(value) && (value.ok === true
    || (value.ok === false && typeof value.error === 'string'));
}

function isElevatorSnapshot(value: unknown): value is ElevatorSnapshot {
  if (!isRecord(value)
    || !ELEVATOR_IDS.includes(value.id as ElevatorId)
    || typeof value.floor !== 'number' || !isFloor(value.floor)
    || !(value.nextFloor === null || (typeof value.nextFloor === 'number' && isFloor(value.nextFloor)))
    || typeof value.progress !== 'number' || value.progress < 0 || value.progress > 1
    || !(value.direction === 'up' || value.direction === 'down' || value.direction === 'idle')
    || !(value.door === 'open' || value.door === 'closed')
    || typeof value.held !== 'boolean'
    || !Array.isArray(value.destinations) || !value.destinations.every((floor) => typeof floor === 'number' && isFloor(floor))
    || !Array.isArray(value.pickups) || !value.pickups.every(isHallCall)) return false;
  return true;
}

function isHallCall(value: unknown): boolean {
  if (!isRecord(value) || typeof value.floor !== 'number'
    || (value.direction !== 'up' && value.direction !== 'down')) return false;
  return isValidHallCall({ floor: value.floor, direction: value.direction });
}

function isPendingCall(value: unknown): boolean {
  return isHallCall(value)
    && isRecord(value)
    && Number.isSafeInteger(value.sequence)
    && (value.assignedTo === null || ELEVATOR_IDS.includes(value.assignedTo as ElevatorId));
}

function isSimulationSnapshot(value: unknown): value is SimulationSnapshot {
  return isRecord(value)
    && typeof value.instanceId === 'string' && value.instanceId.length > 0
    && typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0
    && Array.isArray(value.elevators) && value.elevators.length === ELEVATOR_IDS.length
    && value.elevators.every(isElevatorSnapshot)
    && new Set(value.elevators.map((car) => isRecord(car) ? car.id : undefined)).size === ELEVATOR_IDS.length
    && Array.isArray(value.calls) && value.calls.every(isPendingCall);
}
