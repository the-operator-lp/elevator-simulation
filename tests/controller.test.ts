import { describe, expect, it } from 'vitest';
import { SimulationController } from '../server/controllers/simulationController.js';
import { ElevatorSystem } from '../server/elevator/ElevatorSystem.js';

describe('SimulationController', () => {
  it('returns the current snapshot for a state request', () => {
    const controller = new SimulationController(new ElevatorSystem());

    expect(controller.getState()).toMatchObject({
      status: 200,
      body: {
        revision: 0,
        elevators: [
          { id: 'A', floor: 1 },
          { id: 'B', floor: 2 },
          { id: 'C', floor: 10 },
        ],
        calls: [],
      },
    });
  });

  it('executes a valid command and returns the updated snapshot', () => {
    const controller = new SimulationController(new ElevatorSystem());

    expect(controller.executeCommand({ type: 'hallCall', floor: 5, direction: 'up' })).toMatchObject({
      status: 200,
      body: {
        result: { ok: true },
        state: {
          revision: 1,
          calls: [{ floor: 5, direction: 'up', assignedTo: 'B' }],
        },
      },
    });
  });

  it('rejects malformed command payloads without executing them', () => {
    const controller = new SimulationController(new ElevatorSystem());

    expect(controller.executeCommand({ type: 'hallCall', floor: 11, direction: 'up' })).toEqual({
      status: 400,
      body: { error: 'Invalid command.' },
    });
  });

  it('returns model validation errors and the current snapshot', () => {
    const controller = new SimulationController(new ElevatorSystem());

    expect(controller.executeCommand({ type: 'destination', elevatorId: 'A', floor: 4 })).toMatchObject({
      status: 400,
      body: {
        result: { ok: false, error: 'Destinations can be selected only while the doors are open.' },
        state: { revision: 0, calls: [] },
      },
    });
  });
});
