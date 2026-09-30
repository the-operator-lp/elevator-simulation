import type { ElevatorId, HallCall } from '../../shared/contracts.js';
import { DispatchStrategy } from './DispatchStrategy.js';
import type { Elevator } from './Elevator.js';

export class EtaDispatchStrategy extends DispatchStrategy {
  override choose(call: HallCall, cars: readonly Elevator[]): ElevatorId | null {
    const eligible = cars
      .map((car) => ({ id: car.snapshot().id, eta: car.estimatePickupMs(call) }))
      .filter(({ eta }) => Number.isFinite(eta))
      .sort((left, right) => left.eta - right.eta || left.id.localeCompare(right.id));
    return eligible[0]?.id ?? null;
  }
}
