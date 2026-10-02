import { Building } from './components/Building.js';
import { ElevatorPanel } from './components/ElevatorPanel.js';
import { useSimulation } from './hooks/useSimulation.js';
import './styles.css';

export function App() {
  const { state, connected, error, send } = useSimulation();
  const disabled = !connected;

  return (
    <main className="app-shell" data-revision={state?.revision ?? ''}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {!state ? (
        <div className="loading-panel" role="status">Connecting to the simulator…</div>
      ) : (
        <>
          <div className="control-layout">
            <Building state={state} disabled={disabled} onCommand={send} />
            <aside className="elevator-panels" aria-label="Elevator controls">
              {state.elevators.map((elevator) => (
                <ElevatorPanel elevator={elevator} disabled={disabled} onCommand={send} key={elevator.id} />
              ))}
            </aside>
          </div>
          <footer className="app-footer">Simulation state is maintained by the Node.js server.</footer>
        </>
      )}
    </main>
  );
}
