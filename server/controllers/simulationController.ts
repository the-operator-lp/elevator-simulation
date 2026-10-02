import {
  isFloor,
  isValidHallCall,
  type Command,
  type ElevatorId,
  type HallCall,
  type SimulationSnapshot,
} from '../../shared/contracts.js';
import type { ElevatorSystem } from '../elevator/ElevatorSystem.js';

export interface ControllerResponse {
  status: number;
  body: unknown;
}

export class SimulationController {
  constructor(private readonly system: ElevatorSystem) {}

  getState(): ControllerResponse {
    return { status: 200, body: this.system.snapshot() };
  }

  executeCommand(value: unknown): ControllerResponse {
    const command = parseCommand(value);
    if (!command) return { status: 400, body: { error: 'Invalid command.' } };

    const result = this.system.execute(command);
    const status = result.ok ? 200 : 400;
    return { status, body: { result, state: this.system.snapshot() } };
  }
}

function isElevatorId(value: unknown): value is ElevatorId {
  return value === 'A' || value === 'B' || value === 'C';
}

function parseCommand(value: unknown): Command | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;

  if (body.type === 'hallCall'
    && typeof body.floor === 'number'
    && (body.direction === 'up' || body.direction === 'down')) {
    const call: HallCall = { floor: body.floor, direction: body.direction };
    return isValidHallCall(call) ? { type: 'hallCall', ...call } : null;
  }

  if (body.type === 'destination'
    && isElevatorId(body.elevatorId)
    && typeof body.floor === 'number'
    && isFloor(body.floor)) {
    return { type: 'destination', elevatorId: body.elevatorId, floor: body.floor };
  }

  if ((body.type === 'holdDoor' || body.type === 'closeDoor')
    && isElevatorId(body.elevatorId)) {
    return { type: body.type, elevatorId: body.elevatorId };
  }
  return null;
}
