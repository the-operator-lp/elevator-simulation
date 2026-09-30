import { Building } from './components/Building.js';
import { ElevatorPanel } from './components/ElevatorPanel.js';
import { useSimulation } from './useSimulation.js';
import './styles.css';

export function App() {
  const { state, connected, error, send } = useSimulation();
  const disabled = !connected;

  return (
    <main className="app-shell" data-revision={state?.revision ?? ''}>
      <header className="app-header">
        <div>
          <p className="eyebrow">OFFICE BUILDING · LIVE SIMULATION</p>
          <h1>Elevator Simulator</h1>
          <p className="app-intro">Three independent cars. Ten floors. Shared calls and passenger controls.</p>
        </div>
        <div className={`connection-status ${connected ? 'is-connected' : 'is-disconnected'}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {connected ? 'Connected' : 'Connection lost'}
        </div>
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}
      {!state ? (
        <div className="loading-panel" role="status">Connecting to the simulator…</div>
      ) : (
        <>
          <div className="simulation-meta">
            <span>Server instance <code>{state.instanceId}</code></span>
            <span>Snapshot revision <strong>{state.revision}</strong></span>
          </div>
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
