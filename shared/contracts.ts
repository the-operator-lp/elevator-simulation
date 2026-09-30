export type Direction = 'up' | 'down';
export type ElevatorId = 'A' | 'B' | 'C';

export type Command =
  | { type: 'hallCall'; floor: number; direction: Direction }
  | { type: 'destination'; elevatorId: ElevatorId; floor: number }
  | { type: 'holdDoor' | 'closeDoor'; elevatorId: ElevatorId };

export type CommandResult = { ok: true } | { ok: false; error: string };

export interface HallCall {
  floor: number;
  direction: Direction;
}

export interface ElevatorSnapshot {
  id: ElevatorId;
  floor: number;
  nextFloor: number | null;
  progress: number;
  direction: Direction | 'idle';
  door: 'open' | 'closed';
  held: boolean;
  destinations: number[];
  pickups: HallCall[];
}

export interface PendingCall extends HallCall {
  sequence: number;
  assignedTo: ElevatorId | null;
}

export interface SimulationSnapshot {
  instanceId: string;
  revision: number;
  elevators: ElevatorSnapshot[];
  calls: PendingCall[];
}

export const MIN_FLOOR = 1;
export const MAX_FLOOR = 10;
export const TICK_MS = 100;
export const FLOOR_TRAVEL_TICKS = 10;
export const DOOR_DWELL_TICKS = 20;

export function isFloor(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_FLOOR && value <= MAX_FLOOR;
}

export function isValidHallCall(call: HallCall): boolean {
  return isFloor(call.floor)
    && (call.direction === 'up' || call.direction === 'down')
    && !(call.floor === MIN_FLOOR && call.direction === 'down')
    && !(call.floor === MAX_FLOOR && call.direction === 'up');
}
