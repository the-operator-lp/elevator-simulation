import {
  MAX_FLOOR,
  MIN_FLOOR,
  type Command,
  type ElevatorSnapshot,
  type SimulationSnapshot,
} from '../../shared/contracts.js';

interface BuildingProps {
  state: SimulationSnapshot;
  disabled: boolean;
  onCommand: (command: Command) => Promise<void>;
}

const IDS = ['A', 'B', 'C'] as const;

export function Building({ state, disabled, onCommand }: BuildingProps) {
  const elevators: Record<string, ElevatorSnapshot> = Object.fromEntries(
    state.elevators.map((elevator) => [elevator.id, elevator]),
  );
  const cars = IDS.map((id) => elevators[id]).filter((car): car is ElevatorSnapshot => car !== undefined);

  return (
    <section className="building-panel" aria-labelledby="building-heading">
      <div className="section-heading">
        <div>
          <h2 id="building-heading">Building schematic</h2>
          <p>Shared floor calls are assigned to the fastest available car.</p>
        </div>
        <span className="floor-count">10 floors</span>
      </div>
      <div className="building-column-head" aria-hidden="true">
        <span>Floor / call</span>
        {IDS.map((id) => <span className="shaft-heading" key={id}>Elevator {id}</span>)}
      </div>
      <div className="building-map">
        <ol className="floor-list" aria-label="Building floors">
          {Array.from({ length: MAX_FLOOR - MIN_FLOOR + 1 }, (_, index) => MAX_FLOOR - index).map((floor) => {
            const floorCalls = state.calls.filter((call) => call.floor === floor);
            return (
              <li className="floor-row" aria-label={`Floor ${floor}`} key={floor}>
                <div className="floor-actions">
                  <strong className="floor-number">{floor}</strong>
                  <div className="hall-buttons">
                    {floor > MIN_FLOOR && (
                      <HallButton floor={floor} direction="down" active={floorCalls.some((call) => call.direction === 'down')} disabled={disabled} onCommand={onCommand} />
                    )}
                    {floor < MAX_FLOOR && (
                      <HallButton floor={floor} direction="up" active={floorCalls.some((call) => call.direction === 'up')} disabled={disabled} onCommand={onCommand} />
                    )}
                  </div>
                  {floorCalls.length > 0 && (
                    <div className="call-assignments">
                      {floorCalls.map((call) => (
                        <span className="call-indicator" data-direction={call.direction} key={`${call.floor}-${call.direction}`}>
                          {call.direction === 'up' ? '↑' : '↓'} {call.direction === 'up' ? 'Up call' : 'Down call'} ·{' '}
                          <span className="call-assignment-label">{call.assignedTo
                            ? `Assigned to Elevator ${call.assignedTo}`
                            : 'Queued'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {IDS.map((id) => <div className="shaft-cell" key={id} aria-hidden="true" />)}
              </li>
            );
          })}
        </ol>
        <div className="shaft-overlay" aria-hidden="true">
          {IDS.map((id) => (
            <div className="shaft-track" key={id}>
              {cars.filter((car) => car.id === id).map((car) => {
                const position = car.floor + (car.direction === 'up'
                  ? car.progress
                  : car.direction === 'down' ? -car.progress : 0);
                const top = ((MAX_FLOOR - position + 0.5) / (MAX_FLOOR - MIN_FLOOR + 1)) * 100;
                return (
                  <span
                    className="car-marker"
                    data-door={car.door}
                    data-direction={car.direction}
                    key={car.id}
                    style={{ top: `${top}%` }}
                    title={`Elevator ${car.id}: floor ${car.floor}${car.direction === 'idle' ? '' : `, moving ${car.direction}`}`}
                  >
                    <span className="car-marker-id">{car.id}</span>
                    {car.direction !== 'idle' && <span className="car-marker-arrow">{car.direction === 'up' ? '↑' : '↓'}</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="building-legend" aria-label="Building status legend">
        <span><i className="legend-dot legend-car" />Car position</span>
        <span><i className="legend-dot legend-call" />Assigned hall call</span>
      </div>
    </section>
  );
}

function HallButton({
  floor,
  direction,
  active,
  disabled,
  onCommand,
}: {
  floor: number;
  direction: 'up' | 'down';
  active: boolean;
  disabled: boolean;
  onCommand: (command: Command) => Promise<void>;
}) {
  const call = { floor, direction } as const;
  return (
    <button
      className="hall-button"
      type="button"
      aria-label={`Floor ${floor} ${direction}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => { void onCommand({ type: 'hallCall', ...call }); }}
    >
      <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
      <span>{direction}</span>
    </button>
  );
}
