import { useCallback, useEffect, useRef, useState } from 'react';
import { TICK_MS, type Command, type SimulationSnapshot } from '../shared/contracts.js';
import { getState, sendCommand } from './api.js';

export interface SimulationControls {
  state: SimulationSnapshot | null;
  connected: boolean;
  error: string | null;
  send: (command: Command) => Promise<void>;
}

export function useSimulation(): SimulationControls {
  const [state, setState] = useState<SimulationSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentInstance = useRef<string | null>(null);
  const currentSnapshot = useRef<SimulationSnapshot | null>(null);
  const retiredInstances = useRef(new Set<string>());

  const adopt = useCallback((next: SimulationSnapshot): boolean => {
    if (retiredInstances.current.has(next.instanceId)) return false;
    const previousInstance = currentInstance.current;
    if (previousInstance !== null && previousInstance !== next.instanceId) {
      retiredInstances.current.add(previousInstance);
    }
    const previousSnapshot = currentSnapshot.current;
    if (previousInstance === next.instanceId && previousSnapshot !== null
      && next.revision < previousSnapshot.revision) return false;
    currentInstance.current = next.instanceId;
    currentSnapshot.current = next;
    setState(next);
    return true;
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const poll = async (): Promise<void> => {
      controller = new AbortController();
      try {
        const snapshot = await getState(controller.signal);
        if (mounted) {
          adopt(snapshot);
          setConnected(true);
          setError((current) => current?.startsWith('Connection lost') ? null : current);
        }
      } catch (cause) {
        if (mounted && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setConnected(false);
          setError(`Connection lost. ${cause instanceof Error ? cause.message : 'Unable to reach the simulator.'}`);
        }
      } finally {
        controller = undefined;
        if (mounted) timer = setTimeout(() => { void poll(); }, TICK_MS);
      }
    };

    void poll();
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
    };
  }, [adopt]);

  const send = useCallback(async (command: Command): Promise<void> => {
    if (!connected) return;
    setError(null);
    try {
      const response = await sendCommand(command);
      adopt(response.state);
      setConnected(true);
      setError(response.result.ok ? null : response.result.error);
    } catch (cause) {
      setConnected(false);
      setError(`Connection lost; the command outcome is unknown and it will not be retried. ${cause instanceof Error ? cause.message : ''}`.trim());
    }
  }, [adopt, connected]);

  return { state, connected, error, send };
}
