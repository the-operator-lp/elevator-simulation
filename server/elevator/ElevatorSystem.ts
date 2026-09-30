import { randomUUID } from 'node:crypto';
import {
  isFloor,
  isValidHallCall,
  type Command,
  type CommandResult,
  type ElevatorId,
  type ElevatorSnapshot,
  type HallCall,
  type PendingCall,
  type SimulationSnapshot,
} from '../../shared/contracts.js';
import { DispatchStrategy } from './DispatchStrategy.js';
import { Elevator } from './Elevator.js';
import { EtaDispatchStrategy } from './EtaDispatchStrategy.js';

const ELEVATOR_STARTS: readonly (readonly [ElevatorId, number])[] = [
  ['A', 1],
  ['B', 2],
  ['C', 10],
];

export class ElevatorSystem {
  readonly instanceId = randomUUID();
  readonly #cars: Elevator[] = ELEVATOR_STARTS.map(([id, floor]) => new Elevator(id, floor));
  readonly #calls: PendingCall[] = [];
  readonly #strategy: DispatchStrategy;
  #nextSequence = 1;
  #revision = 0;

  constructor(strategy: DispatchStrategy = new EtaDispatchStrategy()) {
    this.#strategy = strategy;
  }

  execute(command: Command): CommandResult {
    if (command.type === 'hallCall') return this.#requestPickup(command);

    const car = this.#cars.find((candidate) => candidate.snapshot().id === command.elevatorId);
    if (!car) return { ok: false, error: 'Unknown elevator.' };

    const before = JSON.stringify(car.snapshot());
    let result: CommandResult;
    if (command.type === 'destination') {
      result = car.selectDestination(command.floor);
    } else if (command.type === 'holdDoor') {
      result = car.holdDoor();
    } else if (command.type === 'closeDoor') {
      result = car.closeDoor();
    } else {
      return { ok: false, error: 'Unknown command.' };
    }

    if (!result.ok) return result;
    if (before !== JSON.stringify(car.snapshot())) this.#revision += 1;
    this.#dispatchPending();
    return result;
  }

  tick(): void {
    for (const car of this.#cars) {
      const id = car.snapshot().id;
      for (const served of car.tick()) {
        const index = this.#calls.findIndex((call) => call.assignedTo === id && this.#sameCall(call, served));
        if (index !== -1) this.#calls.splice(index, 1);
      }
    }
    this.#dispatchPending();
    this.#revision += 1;
  }

  snapshot(): SimulationSnapshot {
    return {
      instanceId: this.instanceId,
      revision: this.#revision,
      elevators: this.#cars.map((car) => car.snapshot()),
      calls: this.#calls.map((call) => ({ ...call })),
    };
  }

  #requestPickup(call: HallCall): CommandResult {
    if (!isValidHallCall(call)) return { ok: false, error: 'That direction is not available on this floor.' };
    if (this.#calls.some((pending) => this.#sameCall(pending, call))) return { ok: true };

    this.#calls.push({ ...call, sequence: this.#nextSequence, assignedTo: null });
    this.#nextSequence += 1;
    this.#dispatchPending();
    this.#revision += 1;
    return { ok: true };
  }

  #dispatchPending(): void {
    for (const call of this.#calls) {
      if (call.assignedTo !== null) continue;
      const selected = this.#strategy.choose(call, this.#cars);
      const car = this.#cars.find((candidate) => candidate.snapshot().id === selected);
      if (!car || !Number.isFinite(car.estimatePickupMs(call))) continue;
      car.addPickup(call);
      call.assignedTo = selected;
    }
  }

  #sameCall(left: HallCall, right: HallCall): boolean {
    return left.floor === right.floor && left.direction === right.direction;
  }
}
