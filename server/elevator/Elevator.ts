import {
  DOOR_DWELL_TICKS,
  FLOOR_TRAVEL_TICKS,
  MAX_FLOOR,
  MIN_FLOOR,
  TICK_MS,
  isFloor,
  isValidHallCall,
  type CommandResult,
  type Direction,
  type ElevatorId,
  type ElevatorSnapshot,
  type HallCall,
} from '../../shared/contracts.js';

const ELEVATOR_IDS: readonly ElevatorId[] = ['A', 'B', 'C'];
const ESTIMATE_LIMIT_TICKS = 20_000;

export class Elevator {
  readonly #id: ElevatorId;
  #floor: number;
  #direction: Direction | 'idle' = 'idle';
  #door: 'open' | 'closed' = 'closed';
  #held = false;
  #dwellTicks = 0;
  #travelTicks = 0;
  readonly #destinations = new Set<number>();
  #pickups: HallCall[] = [];

  constructor(id: ElevatorId, initialFloor: number) {
    if (!ELEVATOR_IDS.includes(id) || !isFloor(initialFloor)) {
      throw new RangeError('Elevator must have a valid ID and start between floors 1 and 10.');
    }
    this.#id = id;
    this.#floor = initialFloor;
  }

  snapshot(): ElevatorSnapshot {
    const nextFloor = this.#door === 'closed' && this.#direction !== 'idle'
      ? this.#floor + (this.#direction === 'up' ? 1 : -1)
      : null;
    return {
      id: this.#id,
      floor: this.#floor,
      nextFloor,
      progress: this.#door === 'closed' && nextFloor !== null
        ? this.#travelTicks / FLOOR_TRAVEL_TICKS
        : 0,
      direction: this.#direction,
      door: this.#door,
      held: this.#held,
      destinations: [...this.#destinations].sort((a, b) => a - b),
      pickups: this.#pickups.map((call) => ({ ...call })),
    };
  }

  addPickup(call: HallCall): void {
    if (!isValidHallCall(call)) {
      throw new RangeError('Hall call must be valid for a floor between 1 and 10.');
    }
    if (!this.#pickups.some((pending) => this.#sameCall(pending, call))) {
      this.#pickups.push({ ...call });
    }
  }

  selectDestination(floor: number): CommandResult {
    if (!isFloor(floor)) return { ok: false, error: 'Choose a floor between 1 and 10.' };
    if (this.#door !== 'open') return { ok: false, error: 'Destinations can be selected only while the doors are open.' };
    if (floor !== this.#floor) this.#destinations.add(floor);
    return { ok: true };
  }

  holdDoor(): CommandResult {
    if (this.#door !== 'open') return { ok: false, error: 'The doors can be held only while open.' };
    this.#held = true;
    return { ok: true };
  }

  closeDoor(): CommandResult {
    if (this.#door !== 'open') return { ok: false, error: 'The doors can be closed only while open.' };
    this.#held = false;
    this.#dwellTicks = 0;
    this.#door = 'closed';
    return { ok: true };
  }

  tick(): HallCall[] {
    if (this.#door === 'open') {
      if (this.#held) return [];
      this.#dwellTicks -= 1;
      if (this.#dwellTicks <= 0) this.#door = 'closed';
      return [];
    }

    this.#prepareDirection();
    const served = this.#serveCurrentFloor();
    if (this.#dwellTicks > 0 || this.#direction === 'idle') return served;

    this.#travelTicks += 1;
    if (this.#travelTicks === FLOOR_TRAVEL_TICKS) {
      this.#floor += this.#direction === 'up' ? 1 : -1;
      this.#travelTicks = 0;
      this.#prepareDirection();
    }
    return served;
  }

  estimatePickupMs(call: HallCall): number {
    if (this.#held) return Number.POSITIVE_INFINITY;
    const clone = this.#clone();
    clone.addPickup(call);
    for (let tick = 1; tick <= ESTIMATE_LIMIT_TICKS; tick += 1) {
      const served = clone.tick();
      if (served.some((candidate) => this.#sameCall(candidate, call))) return tick * TICK_MS;
    }
    return Number.POSITIVE_INFINITY;
  }

  #clone(): Elevator {
    const copy = new Elevator(this.#id, this.#floor);
    copy.#direction = this.#direction;
    copy.#door = this.#door;
    copy.#held = this.#held;
    copy.#dwellTicks = this.#dwellTicks;
    copy.#travelTicks = this.#travelTicks;
    copy.#pickups = this.#pickups.map((call) => ({ ...call }));
    for (const floor of this.#destinations) copy.#destinations.add(floor);
    return copy;
  }

  #prepareDirection(): void {
    if (this.#direction === 'up') {
      if (this.#floor === MAX_FLOOR) {
        this.#direction = this.#hasWork() ? 'down' : 'idle';
      } else if (!this.#hasWorkAhead('up') && !this.#hasOppositeCallAtCurrentFloor('up')) {
        this.#direction = this.#hasWork() ? 'down' : 'idle';
      }
    } else if (this.#direction === 'down') {
      if (this.#floor === MIN_FLOOR) {
        this.#direction = this.#hasWork() ? 'up' : 'idle';
      } else if (!this.#hasWorkAhead('down') && !this.#hasOppositeCallAtCurrentFloor('down')) {
        this.#direction = this.#hasWork() ? 'up' : 'idle';
      }
    }

    if (this.#direction !== 'idle' || !this.#hasWork()) return;

    const atCurrentFloor = this.#pickups.find((call) => call.floor === this.#floor);
    if (atCurrentFloor) {
      this.#direction = atCurrentFloor.direction;
      return;
    }

    const target = this.#allStops()
      .sort((left, right) => Math.abs(left - this.#floor) - Math.abs(right - this.#floor))[0];
    if (target !== undefined) this.#direction = target > this.#floor ? 'up' : 'down';
  }

  #serveCurrentFloor(): HallCall[] {
    const compatible = this.#direction === 'idle'
      ? []
      : this.#pickups.filter((call) => call.floor === this.#floor && call.direction === this.#direction);
    const destinationHere = this.#destinations.delete(this.#floor);
    if (compatible.length === 0 && !destinationHere) return [];

    this.#pickups = this.#pickups.filter((call) => !compatible.some((served) => this.#sameCall(served, call)));
    this.#door = 'open';
    this.#held = false;
    this.#dwellTicks = DOOR_DWELL_TICKS;
    return compatible.map((call) => ({ ...call }));
  }

  #hasWork(): boolean {
    return this.#destinations.size > 0 || this.#pickups.length > 0;
  }

  #allStops(): number[] {
    return [...this.#destinations, ...this.#pickups.map((call) => call.floor)];
  }

  #hasWorkAhead(direction: Direction): boolean {
    return this.#destinations.has(this.#floor)
      || [...this.#destinations].some((floor) => direction === 'up' ? floor > this.#floor : floor < this.#floor)
      || this.#pickups.some((call) => call.direction === direction
        && (direction === 'up' ? call.floor >= this.#floor : call.floor <= this.#floor));
  }

  #hasOppositeCallAtCurrentFloor(direction: Direction): boolean {
    return this.#pickups.some((call) => call.floor === this.#floor && call.direction !== direction);
  }

  #sameCall(left: HallCall, right: HallCall): boolean {
    return left.floor === right.floor && left.direction === right.direction;
  }
}
