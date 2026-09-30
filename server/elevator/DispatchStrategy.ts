import type { ElevatorId, HallCall } from '../../shared/contracts.js';
import type { Elevator } from './Elevator.js';

export abstract class DispatchStrategy {
  abstract choose(call: HallCall, cars: readonly Elevator[]): ElevatorId | null;
}
