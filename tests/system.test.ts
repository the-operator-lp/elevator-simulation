import { describe, expect, it } from 'vitest';
import { Elevator } from '../server/elevator/Elevator.js';
import { DispatchStrategy } from '../server/elevator/DispatchStrategy.js';
import { EtaDispatchStrategy } from '../server/elevator/EtaDispatchStrategy.js';
import { ElevatorSystem } from '../server/elevator/ElevatorSystem.js';
import type { Direction, ElevatorId, HallCall } from '../shared/contracts.js';

function command(system: ElevatorSystem, type: 'hallCall', floor: number, direction: Direction) {
  return system.execute({ type, floor, direction });
}

function board(system: ElevatorSystem, id: ElevatorId, floor: number, direction: Direction) {
  expect(command(system, 'hallCall', floor, direction).ok).toBe(true);
  system.tick();
  expect(system.snapshot().elevators.find((car) => car.id === id)?.door).toBe('open');
}

class AlwaysB extends DispatchStrategy {
  choose(): ElevatorId {
    return 'B';
  }
}

class AlwaysA extends DispatchStrategy {
  choose(): ElevatorId {
    return 'A';
  }
}

describe('ElevatorSystem', () => {
  it('starts with three elevators on the illustrated floors', () => {
    const system = new ElevatorSystem();
    expect(system.snapshot().elevators.map((car) => car.floor)).toEqual([1, 2, 10]);
    expect(system.snapshot().elevators).toHaveLength(3);
  });

  it('coalesces duplicate calls without adding a second pending request or revision', () => {
    const system = new ElevatorSystem();
    expect(command(system, 'hallCall', 5, 'up')).toEqual({ ok: true });
    const revision = system.snapshot().revision;
    expect(command(system, 'hallCall', 5, 'up')).toEqual({ ok: true });
    expect(system.snapshot().calls).toHaveLength(1);
    expect(system.snapshot().revision).toBe(revision);
  });

  it('keeps up and down calls at one floor as separate requests', () => {
    const system = new ElevatorSystem();
    command(system, 'hallCall', 5, 'up');
    command(system, 'hallCall', 5, 'down');
    expect(system.snapshot().calls.map((call) => call.direction).sort()).toEqual(['down', 'up']);
  });

  it('chooses the nearest car by ETA and has the strategy break equal ETAs by ID', () => {
    const system = new ElevatorSystem();
    command(system, 'hallCall', 9, 'down');
    expect(system.snapshot().calls[0]?.assignedTo).toBe('C');

    const strategy = new EtaDispatchStrategy();
    const tiedCars = [new Elevator('C', 2), new Elevator('B', 2), new Elevator('A', 2)];
    expect(strategy.choose({ floor: 3, direction: 'up' }, tiedCars)).toBe('A');
  });

  it('allows a polymorphic dispatch policy to select a different elevator', () => {
    const system = new ElevatorSystem(new AlwaysB());
    command(system, 'hallCall', 5, 'up');
    expect(system.snapshot().calls[0]?.assignedTo).toBe('B');
  });

  it('sends a floor-5 up call to an up-bound car instead of the closer wrong-way car', () => {
    const system = new ElevatorSystem();
    board(system, 'A', 1, 'up');
    system.execute({ type: 'destination', elevatorId: 'A', floor: 8 });
    system.execute({ type: 'closeDoor', elevatorId: 'A' });
    board(system, 'B', 2, 'down');
    system.execute({ type: 'destination', elevatorId: 'B', floor: 1 });
    system.execute({ type: 'closeDoor', elevatorId: 'B' });

    command(system, 'hallCall', 5, 'up');
    expect(system.snapshot().calls.at(-1)?.assignedTo).toBe('A');
  });

  it('advances all three cars during the same five ticks', () => {
    const system = new ElevatorSystem();
    command(system, 'hallCall', 1, 'up');
    command(system, 'hallCall', 2, 'up');
    command(system, 'hallCall', 10, 'down');
    system.tick();
    for (const [id, floor] of [['A', 5], ['B', 8], ['C', 6]] as const) {
      expect(system.execute({ type: 'destination', elevatorId: id, floor })).toEqual({ ok: true });
      system.execute({ type: 'closeDoor', elevatorId: id });
    }
    for (let tick = 0; tick < 5; tick += 1) system.tick();
    expect(system.snapshot().elevators.map((car) => car.floor)).toEqual([2, 3, 9]);
  });

  it('leaves a call pending while all cars are held and dispatches it when one is released', () => {
    const system = new ElevatorSystem();
    board(system, 'A', 1, 'up');
    board(system, 'B', 2, 'up');
    board(system, 'C', 10, 'down');
    for (const id of ['A', 'B', 'C'] as const) system.execute({ type: 'holdDoor', elevatorId: id });
    command(system, 'hallCall', 5, 'up');
    expect(system.snapshot().calls.at(-1)?.assignedTo).toBeNull();
    system.execute({ type: 'closeDoor', elevatorId: 'A' });
    expect(system.snapshot().calls.at(-1)?.assignedTo).toBe('A');
  });

  it.each([
    { floor: 1, direction: 'down' as const },
    { floor: 10, direction: 'up' as const },
  ])('rejects an impossible boundary call without mutating the state: $floor/$direction', (call) => {
    const system = new ElevatorSystem();
    const before = system.snapshot();
    expect(system.execute({ type: 'hallCall', ...call }).ok).toBe(false);
    expect(system.snapshot()).toEqual(before);
  });

  it('preserves the opposite floor-5 call until after the car reaches floor 10', () => {
    const system = new ElevatorSystem(new AlwaysA());
    command(system, 'hallCall', 1, 'up');
    system.tick();
    system.execute({ type: 'destination', elevatorId: 'A', floor: 10 });
    system.execute({ type: 'closeDoor', elevatorId: 'A' });
    command(system, 'hallCall', 5, 'up');
    command(system, 'hallCall', 5, 'down');

    let upServed = false;
    let floor10Reached = false;
    for (let tick = 0; tick < 500 && !floor10Reached; tick += 1) {
      system.tick();
      const snapshot = system.snapshot();
      const pendingDown = snapshot.calls.some((call) => call.floor === 5 && call.direction === 'down');
      if (upServed && pendingDown) expect(snapshot.elevators[0]?.floor).toBeGreaterThanOrEqual(5);
      upServed ||= snapshot.calls.some((call) => call.floor === 5 && call.direction === 'up') === false;
      floor10Reached = snapshot.elevators[0]?.floor === 10;
    }

    expect(upServed).toBe(true);
    expect(floor10Reached).toBe(true);
    expect(system.snapshot().calls.some((call) => call.floor === 5 && call.direction === 'down')).toBe(true);
    for (let tick = 0; tick < 500 && system.snapshot().calls.length > 0; tick += 1) system.tick();
    expect(system.snapshot().calls).toEqual([]);
  });

  it('completes a finite workload and returns snapshots that cannot mutate system state', () => {
    const system = new ElevatorSystem();
    board(system, 'A', 1, 'up');
    system.execute({ type: 'destination', elevatorId: 'A', floor: 3 });
    system.execute({ type: 'closeDoor', elevatorId: 'A' });
    for (let tick = 0; tick < 500; tick += 1) {
      system.tick();
      const car = system.snapshot().elevators[0];
      if (car?.destinations.length === 0 && car.door === 'open') break;
    }
    const snapshot = system.snapshot();
    snapshot.calls.push({ floor: 4, direction: 'up', sequence: 999, assignedTo: 'A' });
    snapshot.elevators[0]?.destinations.push(9);
    expect(system.snapshot().calls).toEqual([]);
    expect(system.snapshot().elevators[0]?.destinations).toEqual([]);
  });

  it('exposes the strategy contract for calls without assigning when a policy has no car', () => {
    class NoCar extends DispatchStrategy {
      choose(_call: HallCall, _cars: readonly Elevator[]): ElevatorId | null {
        return null;
      }
    }
    const system = new ElevatorSystem(new NoCar());
    command(system, 'hallCall', 5, 'up');
    expect(system.snapshot().calls[0]?.assignedTo).toBeNull();
  });
});
