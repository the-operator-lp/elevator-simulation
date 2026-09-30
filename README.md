# Elevator Simulator

A local interview exercise implementation with a Node.js simulation API and a React control surface. The server owns the live simulation; refreshing the browser reconnects to that state.

## Run it

Prerequisites: Node.js 22.12 or newer and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>. The development command starts the API on port 3001 and Vite on port 5173. To run the production build instead:

```sh
npm run build
npm start
```

Then open <http://localhost:3001>. Set `PORT` to choose another API/production port, for example `PORT=3100 npm start`. The server validates the port range.

## Verify it

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The browser suite runs against the production build and starts an isolated server process for each scenario. It exercises directional service, deduplication, three-car movement, browser refresh, server loss, and reconnect. Install the Playwright Chromium browser once if the local browser cache is empty:

```sh
npx playwright install chromium
```

There is no configured lint script. Failed Playwright runs retain a screenshot and trace under the ignored `test-results/` directory; the HTML report is written to the ignored `playwright-report/` directory.

## HTTP API

`GET /api/state` returns the current server instance identifier, revision, all three elevator snapshots, and pending hall calls.

`POST /api/commands` accepts one JSON command. For example, request an upward pickup on floor 5:

```sh
curl -X POST http://localhost:3001/api/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"hallCall","floor":5,"direction":"up"}'
```

Other command types select a passenger destination while that elevator's doors are open, hold an open door, or close an open door. Invalid commands return an HTTP 400 response with an error. The server serves the production React application from `/` after `npm run build`.

## Model and dispatch

`server/elevator/Elevator.ts` owns one car's floor, direction, door, destinations, pickups, dwell, and movement ticks. `ElevatorSystem.ts` owns cars and pending calls, applies commands, advances the fleet, and removes a call when its assigned car serves the matching floor and direction. `DispatchStrategy.ts` defines the allocation contract; `EtaDispatchStrategy.ts` supplies the default policy by estimating each eligible car's time to serve the call. The strategy can be replaced through `ElevatorSystem` construction.

The shared contracts in `shared/contracts.ts` define commands, directions, IDs, snapshots, and timing constants. `server/http.ts` validates the network boundary. The React components render shared floor calls and individual car destination/door controls; `client/useSimulation.ts` polls the server and handles disconnects without pretending stale state is current.

## Requirements and implementation choices

The supplied interview brief calls for a ten-floor, three-elevator simulator, directional floor calls, passenger destination selection, door hold/close controls, and a floor-5 direction example during an elevator trip from floor 1 to floor 10. The interface follows the brief's building-schematic concept and displays the three cars and floor controls.

The brief leaves scheduling and runtime behavior open. This implementation starts cars A, B, and C at floors 1, 2, and 10; uses ETA-based dispatch; assigns each pending floor-and-direction call to one car; deduplicates repeated identical pending calls; and serves calls only when the elevator's travel direction matches the requested direction. A floor takes 10 simulation ticks (1 second) and normal open-door dwell is 20 ticks (2 seconds). Holding a door pauses dwell until Close is pressed. A held car is unavailable for new calls; calls already assigned to it wait. Selecting the current floor while aboard succeeds without adding a stop.

State is in memory for one server process. A browser refresh preserves the live run, while restarting the server creates a new instance and resets the cars, pending calls, and destinations. The simulator does not persist state or model elevator capacity, passengers, safety interlocks, or multiple server processes.

## Interview handoff

The 45-minute walkthrough and repeatable demo are in [docs/presentation.md](docs/presentation.md). This implementation and its evidence are local to this workspace. Choosing a repository, reviewing what it contains, granting access, and sending any repository invitation are user-controlled handoff steps.
