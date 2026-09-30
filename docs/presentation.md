# 45-minute interview walkthrough

Keep the running application at <http://localhost:3001> and the source tree open. A production build gives the interviewer the same static UI and API process used by the browser acceptance suite.

| Time | Topic | Talking points |
| --- | --- | --- |
| 0–5 min | Requirements and assumptions | Ten floors, three elevators, directional hall calls, car destinations, and hold/close controls. Call out that scheduling policy, duplicate-call handling, timings, initial car positions, and persistence are implementation choices. |
| 5–15 min | Architecture and OOP | Walk from shared contracts through `Elevator`, `ElevatorSystem`, and the `DispatchStrategy` / `EtaDispatchStrategy` pair, then the HTTP adapter and React client. Point to encapsulated car state, fleet ownership, and the injected policy boundary. |
| 15–25 min | Dispatch and state machine | Trace a hall call from validation through ETA assignment to a directional stop. Explain floor ticks, dwell, reversal, held-car availability, deduplication, and why the browser renders server snapshots rather than simulating movement. |
| 25–35 min | Live demo and tests | Reproduce the PDF's floor-1-to-10 trip with floor-5 up/down calls, hold and close the door, then show three cars moving concurrently. Finish with the automated checks and one reconnect case. |
| 35–45 min | Tradeoffs and questions | Discuss in-memory state, capacity/passenger modeling, dispatch policy, testing boundaries, accessibility/responsive choices, and what would change for persistence or multiple server instances. |

## Repeatable live demo

Build and start the production application in a terminal:

```sh
npm run build
npm start
```

Open <http://localhost:3001> in a browser. To isolate the floor-5 direction example, hold the two cars that would otherwise mask A's route:

1. Click **Floor 2 up**. When Elevator B opens, press **Hold door**.
2. Click **Floor 10 down**. When Elevator C opens, press **Hold door**.
3. Click **Floor 1 up**. When Elevator A opens, choose destination **10**, then press **Close door**.
4. While A is traveling, click **Floor 5 up** several times and click **Floor 5 down** once. The schematic shows one pending call per direction assigned to A.
5. When A opens at floor 5 in the up direction, press **Hold door**. Wait longer than two seconds and point out that it remains at floor 5 with the down call still queued. Press **Close door**; A continues to floor 10, reverses, and serves floor 5 down.

For a clean three-car concurrency run, stop the process with Ctrl-C and start `npm start` again; a new server process resets its in-memory state. Click **Floor 1 up**, choose **10** in Elevator A, and close its door. Then click **Floor 8 down** and **Floor 3 up**. A, C, and B respectively have work in their routes; the panels and schematic show all three moving. This run also shows that refreshing the page does not reset the server's state.

## Verification commands

Run the complete local evidence pass from a clean dependency install:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The Playwright scenarios launch production server processes on isolated local ports and cover the directional trip, hold duration, duplicate requests, concurrent cars, refresh, and offline/reconnect behavior. No server reset endpoint is exposed for tests.
