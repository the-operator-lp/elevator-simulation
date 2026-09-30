// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../client/App.js';
import type { Command, ElevatorSnapshot, SimulationSnapshot } from '../shared/contracts.js';

function car(id: 'A' | 'B' | 'C', floor: number): ElevatorSnapshot {
  return {
    id,
    floor,
    nextFloor: null,
    progress: 0,
    direction: 'idle',
    door: 'closed',
    held: false,
    destinations: [],
    pickups: [],
  };
}

function state(revision = 1): SimulationSnapshot {
  return {
    instanceId: 'instance-one',
    revision,
    elevators: [car('A', 1), car('B', 2), car('C', 10)],
    calls: [],
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('elevator controls', () => {
  it('renders ten floors, three cars, and only valid boundary call buttons', async () => {
    installFetch(async () => json(state()));
    render(<App />);
    await screen.findByRole('button', { name: 'Floor 1 up' });
    for (let floor = 1; floor <= 10; floor += 1) {
      expect(screen.getByRole('listitem', { name: `Floor ${floor}` })).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText(/Elevator [ABC] status/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Floor 1 down' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Floor 10 up' })).not.toBeInTheDocument();
  });

  it('sends the shared hall call and displays its assigned elevator', async () => {
    let sent: Command | undefined;
    const updated = {
      ...state(2),
      calls: [{ floor: 5, direction: 'up' as const, sequence: 1, assignedTo: 'B' as const }],
    };
    installFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        sent = JSON.parse(String(init.body)) as Command;
        return json({ result: { ok: true }, state: updated });
      }
      return json(state());
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Floor 5 up' }));
    await waitFor(() => expect(sent).toEqual({ type: 'hallCall', floor: 5, direction: 'up' }));
    expect(await screen.findByText('Assigned to Elevator B')).toBeInTheDocument();
  });

  it('enables destination selection only with open doors and sends the selected floor', async () => {
    const open = state(3);
    open.elevators[0] = { ...car('A', 1), door: 'open', direction: 'up' };
    let sent: Command | undefined;
    installFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        sent = JSON.parse(String(init.body)) as Command;
        return json({ result: { ok: true }, state: open });
      }
      return json(open);
    });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Elevator A go to Floor 10' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elevator B go to Floor 10' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Elevator A go to Floor 10' }));
    await waitFor(() => expect(sent).toEqual({ type: 'destination', elevatorId: 'A', floor: 10 }));
  });

  it('shows held-door controls and sends immediate close requests', async () => {
    const open = state(3);
    open.elevators[0] = { ...car('A', 1), door: 'open', held: true, direction: 'up' };
    let sent: Command | undefined;
    installFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        sent = JSON.parse(String(init.body)) as Command;
        return json({ result: { ok: true }, state: open });
      }
      return json(open);
    });
    render(<App />);
    const close = await screen.findByRole('button', { name: 'Elevator A close door' });
    expect(screen.getByText('Held open')).toBeInTheDocument();
    fireEvent.click(close);
    await waitFor(() => expect(sent).toEqual({ type: 'closeDoor', elevatorId: 'A' }));
  });

  it('shows server-side validation errors without losing the current snapshot', async () => {
    installFetch(async (_url, init) => init?.method === 'POST'
      ? json({ result: { ok: false, error: 'Choose a different floor.' }, state: state() }, 400)
      : json(state()));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Floor 5 up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a different floor.');
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '1');
  });

  it('disables controls after connection loss and does not retry a failed command', async () => {
    vi.useFakeTimers();
    let gets = 0;
    let posts = 0;
    installFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        throw new Error('connection dropped');
      }
      gets += 1;
      if (gets === 2) throw new Error('server offline');
      return json(state());
    });
    render(<App />);
    await flush();
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Floor 5 up' }));
    await flush();
    expect(posts).toBe(1);
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/connection lost/i);
    expect(posts).toBe(1);
  });

  it('re-enables controls when a later poll confirms the server is back', async () => {
    vi.useFakeTimers();
    let gets = 0;
    installFetch(async () => {
      gets += 1;
      if (gets === 2) throw new Error('server offline');
      return json(state(gets));
    });
    render(<App />);
    await flush();
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeDisabled();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '1');

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(screen.getByRole('button', { name: 'Floor 5 up' })).toBeEnabled();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '3');
  });

  it('cancels its scheduled polling when unmounted', async () => {
    vi.useFakeTimers();
    let gets = 0;
    installFetch(async () => { gets += 1; return json(state(gets)); });
    const app = render(<App />);
    await flush();
    expect(gets).toBe(1);
    app.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(gets).toBe(1);
  });

  it('keeps a newer command snapshot when an older poll response arrives late', async () => {
    vi.useFakeTimers();
    let releasePoll: ((response: Response) => void) | undefined;
    let gets = 0;
    const newer = state(6);
    const fetch = installFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        return json({ result: { ok: true }, state: newer });
      }
      gets += 1;
      if (gets === 1) return json(state(4));
      return new Promise<Response>((resolve) => { releasePoll = resolve; });
    });
    render(<App />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByRole('button', { name: 'Floor 5 up' }));
    await flush();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '6');
    await act(async () => { releasePoll?.(json(state(5))); await Promise.resolve(); });
    await flush();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '6');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('accepts a restarted server instance and ignores late snapshots from the retired one', async () => {
    vi.useFakeTimers();
    let releaseOldPoll: ((response: Response) => void) | undefined;
    let gets = 0;
    installFetch(async () => {
      gets += 1;
      if (gets === 1) return json(state(10));
      if (gets === 2) return json({ ...state(0), instanceId: 'instance-two' });
      return new Promise<Response>((resolve) => { releaseOldPoll = resolve; });
    });
    render(<App />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '0');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    await act(async () => { releaseOldPoll?.(json(state(11))); await Promise.resolve(); });
    await flush();
    expect(screen.getByRole('main')).toHaveAttribute('data-revision', '0');
    expect(screen.getByText('instance-two')).toBeInTheDocument();
  });
});
