import type { Command, ElevatorSnapshot } from '../../shared/contracts.js';

interface ElevatorPanelProps {
  elevator: ElevatorSnapshot;
  disabled: boolean;
  onCommand: (command: Command) => Promise<void>;
}

export function ElevatorPanel({ elevator, disabled, onCommand }: ElevatorPanelProps) {
  const moving = elevator.nextFloor !== null && elevator.direction !== 'idle';
  const unavailable = disabled || elevator.door !== 'open';

  return (
    <section className="elevator-panel" role="group" aria-label={`Elevator ${elevator.id} status`}>
      <div className="panel-heading">
        <div className="panel-car-id" aria-hidden="true">{elevator.id}</div>
        <div>
          <h3>Elevator {elevator.id}</h3>
          <p className="panel-floor">Floor <strong>{elevator.floor}</strong></p>
        </div>
        <span className={`status-pill status-${elevator.held ? 'held' : elevator.door === 'open' ? 'open' : moving ? 'moving' : 'idle'}`}>
          {elevator.held ? 'Held open' : elevator.door === 'open' ? 'Doors open' : moving ? `Moving ${elevator.direction}` : 'Idle'}
        </span>
      </div>
      <p className="car-status">
        {moving
          ? `Moving ${elevator.direction} toward floor ${elevator.nextFloor} (${Math.round(elevator.progress * 100)}% of this floor).`
          : elevator.held ? 'Doors are held open.' : elevator.door === 'open' ? 'Doors are open.' : 'Stopped with doors closed.'}
      </p>
      <div className="destination-heading">
        <span>Choose destination</span>
        <span>{elevator.door === 'open' ? 'Doors open' : 'Open doors to select'}</span>
      </div>
      <div className="destination-grid" aria-label={`Elevator ${elevator.id} destinations`}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((floor) => (
          <button
            className="destination-button"
            type="button"
            aria-label={`Elevator ${elevator.id} go to Floor ${floor}`}
            key={floor}
            disabled={unavailable || floor === elevator.floor}
            onClick={() => { void onCommand({ type: 'destination', elevatorId: elevator.id, floor }); }}
          >
            {floor}
          </button>
        ))}
      </div>
      {elevator.destinations.length > 0 && (
        <p className="next-stops">Selected stops: {elevator.destinations.join(', ')}.</p>
      )}
      <div className="door-controls">
        <button
          className="door-button door-hold"
          type="button"
          aria-label={`Elevator ${elevator.id} hold door`}
          disabled={disabled || elevator.door !== 'open' || elevator.held}
          onClick={() => { void onCommand({ type: 'holdDoor', elevatorId: elevator.id }); }}
        >
          Hold door
        </button>
        <button
          className="door-button door-close"
          type="button"
          aria-label={`Elevator ${elevator.id} close door`}
          disabled={disabled || elevator.door !== 'open'}
          onClick={() => { void onCommand({ type: 'closeDoor', elevatorId: elevator.id }); }}
        >
          Close door
        </button>
      </div>
    </section>
  );
}
