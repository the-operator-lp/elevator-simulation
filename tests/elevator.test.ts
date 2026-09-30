import { describe, expect, it } from 'vitest';
import { Elevator } from '../server/elevator/Elevator.js';

function reach(car: Elevator, floor: number, limit = 500) {
  for (let ticks = 0; ticks < limit; ticks += 1) {
    if (car.snapshot().floor === floor && car.snapshot().nextFloor === null) return;
    car.tick();
  }
  throw new Error(`Elevator ${car.snapshot().id} did not reach floor ${floor} within ${limit} ticks`);
}

describe('Elevator', () => {
  it('starts within building bounds, idle, with closed doors', () => {
    const car = new Elevator('A', 1);
    expect(car.snapshot()).toMatchObject({ floor: 1, door: 'closed', direction: 'idle' });
  });

  it('serves an up call at the current floor and accepts a passenger destination', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    expect(car.tick()).toEqual([{ floor: 1, direction: 'up' }]);
    expect(car.snapshot().door).toBe('open');
    expect(car.selectDestination(10)).toEqual({ ok: true });
  });

  it('moves exactly one floor in ten ticks and never moves with the door open', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    expect(car.selectDestination(2)).toEqual({ ok: true });
    car.closeDoor();
    const moved: number[] = [];
    for (let tick = 0; tick < 10; tick += 1) {
      car.tick();
      const state = car.snapshot();
      moved.push(state.floor);
      if (state.nextFloor !== null) expect(state.door).toBe('closed');
    }
    expect(moved.slice(0, 9)).toEqual(Array<number>(9).fill(1));
    expect(moved[9]).toBe(2);
  });

  it('takes an up pickup while going up and holds a down pickup until after reversal', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    car.selectDestination(10);
    car.closeDoor();
    car.addPickup({ floor: 5, direction: 'up' });
    car.addPickup({ floor: 5, direction: 'down' });

    let upPickup: number | undefined;
    let floor10: number | undefined;
    let downPickup: number | undefined;
    for (let tick = 0; tick < 500 && downPickup === undefined; tick += 1) {
      const served = car.tick();
      if (served.some((call) => call.floor === 5 && call.direction === 'up')) upPickup = tick;
      if (car.snapshot().floor === 10 && floor10 === undefined) floor10 = tick;
      if (served.some((call) => call.floor === 5 && call.direction === 'down')) downPickup = tick;
    }

    expect(upPickup).toBeDefined();
    expect(floor10).toBeDefined();
    expect(downPickup).toBeDefined();
    if (upPickup === undefined || floor10 === undefined || downPickup === undefined) {
      throw new Error('Expected the car to serve both calls and reach floor 10.');
    }
    expect(upPickup).toBeLessThan(floor10);
    expect(floor10).toBeLessThan(downPickup);
  });

  it('opens for a compatible down call at the turnaround floor after reversing', () => {
    const car = new Elevator('A', 8);
    car.addPickup({ floor: 8, direction: 'up' });
    car.tick();
    car.selectDestination(10);
    car.closeDoor();
    car.addPickup({ floor: 10, direction: 'down' });
    reach(car, 10);
    expect(car.snapshot().door).toBe('open');
    expect(car.snapshot().direction).toBe('down');
  });

  it('keeps an explicitly held door open beyond the normal dwell', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    car.holdDoor();
    car.selectDestination(2);
    for (let ticks = 0; ticks < 100; ticks += 1) car.tick();
    expect(car.snapshot()).toMatchObject({ floor: 1, door: 'open', held: true });
  });

  it('closes a held door immediately and resumes queued movement', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    car.holdDoor();
    car.selectDestination(2);
    expect(car.closeDoor()).toEqual({ ok: true });
    expect(car.snapshot()).toMatchObject({ door: 'closed', held: false });
    reach(car, 2);
  });

  it('automatically closes an unheld door after twenty ticks', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    for (let ticks = 0; ticks < 20; ticks += 1) car.tick();
    expect(car.snapshot().door).toBe('closed');
  });

  it('eventually reaches destinations queued behind the current sweep', () => {
    const car = new Elevator('A', 5);
    car.addPickup({ floor: 5, direction: 'up' });
    car.tick();
    car.selectDestination(8);
    car.closeDoor();
    car.addPickup({ floor: 3, direction: 'down' });
    reach(car, 3);
    expect(car.snapshot().door).toBe('open');
  });

  it.each([0, 11, 1.5, Number.NaN])('rejects invalid destination %s without changing state', (floor) => {
    const car = new Elevator('A', 1);
    const before = car.snapshot();
    expect(car.selectDestination(floor).ok).toBe(false);
    expect(car.snapshot()).toEqual(before);
  });

  it('rejects destination selection before a passenger boards', () => {
    const car = new Elevator('A', 1);
    const before = car.snapshot();
    expect(car.selectDestination(10).ok).toBe(false);
    expect(car.snapshot()).toEqual(before);
  });

  it('rejects door controls while the car is moving without changing state', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    car.selectDestination(2);
    car.closeDoor();
    car.tick();
    const before = car.snapshot();
    expect(car.holdDoor().ok).toBe(false);
    expect(car.closeDoor().ok).toBe(false);
    expect(car.snapshot()).toEqual(before);
  });

  it('estimates pickup time without mutating its state', () => {
    const car = new Elevator('A', 1);
    car.addPickup({ floor: 1, direction: 'up' });
    car.tick();
    car.selectDestination(4);
    car.closeDoor();
    const before = car.snapshot();
    expect(car.estimatePickupMs({ floor: 6, direction: 'up' })).toBeGreaterThan(0);
    expect(car.snapshot()).toEqual(before);
  });
});
