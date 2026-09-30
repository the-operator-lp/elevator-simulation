# Elevator Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a demonstrable elevator simulator with three independently moving elevators serving ten floors, correct directional pickups, passenger destinations, and door controls.

**Architecture:** A single Node.js process owns an in-memory simulation and advances all elevators on one clock. A React client sends commands and renders authoritative snapshots; deterministic domain classes have no network or timer dependencies. This is one integrated application and one implementation plan.

**Tech Stack:** Proposed baseline: TypeScript, Node.js built-in HTTP server, React, Vite, Vitest, React Testing Library, and Playwright; npm with a committed lockfile. Choose mutually compatible stable versions at setup and record the Node version in `.nvmrc` and `package.json`; the PDF specifies no versions.

**Spec:** [`../specs/nodejs-interview-test.pdf`](../specs/nodejs-interview-test.pdf), both pages including the diagram. Read it alongside this plan. A local copy preserves the original requirements; assumptions below are implementation decisions, not additional PDF requirements.

## Global Constraints

- “Node.js as the backend and React.js as the frontend.”
- “3 elevators working in parallel in an office that has 10 floors.”
- “allocate elevators efficiently to minimize wait times and maximize efficiency.”
- “A going elevator only stops at the floor, which has the same direction.” Apply this to hall calls; an already-boarded passenger's destination remains a required stop.
- “Once the elevator arrives, the user can click the other floors as the destination.”
- “keep the elevator door open” and “close the door immediately.”
- “encapsulation, inheritance, and polymorphism.”
- “a very simplistic UI” is sufficient, but it “must be React.js based.”
- “7 days” preparation and “45 minutes” to present the strategy; the actual start date is not supplied.
- “The candidate is prohibited from disclosing any information related to the test to any third party.” Keep artifacts local; publishing or inviting reviewers is a separate user-directed action.

## Review Focus

1. Repeated hall calls and simultaneous clients must create one pending floor/direction request, not dispatch duplicate cars (Tasks 2–3).
2. An opposite-direction call must survive being passed and be served after reversal, including a call at the turnaround floor (Tasks 1–2).
3. Invalid floors, impossible boundary directions, and premature destination selections must fail without changing state (Tasks 1 and 3).
4. Holding or closing doors during movement, or holding through multiple ticks, must never permit movement with open doors (Tasks 1 and 4).
5. A lost connection or out-of-order response must not make the UI invent progress or replay passenger commands (Tasks 3–4).

---

## Decisions and assumptions

- Floors are integers 1–10; elevator IDs are `A`, `B`, `C`, initially at 1, 2, 10 as illustrated. All start idle with closed doors. The illustration is not treated as a required pixel-perfect design.
- Hall requests are shared by floor and direction. Repeated buttons beside each shaft, if rendered, submit the same shared request; the backend chooses the car. This reconciles the diagram with the explicit allocation requirement.
- Destination selection is per elevator, enabled after it arrives and while its doors are open. Allow any other floor; destinations behind the current sweep wait for reversal. No passenger counts, capacity, authentication, persistence, or real elevator safety certification are in scope.
- Simulation step: 100 ms; one floor: 1,000 ms; automatic open dwell: 2,000 ms. Door opening and closing are immediate state transitions. A Hold button latches doors open until Close is clicked; a disconnected browser cannot release someone else's hold accidentally. These timings and latch semantics are assumptions.
- Use collective LOOK routing: keep serving compatible stops in the current direction, reverse when that sweep has no remaining work, and deadhead to a hall call if necessary. Do not open for an incompatible call while merely passing its floor. At a turnaround, change direction before opening for the opposite call. Never reverse between floors.
- Coalesce calls by `(floor, direction)`. Dispatch unassigned calls oldest-first; choose the smallest predicted pickup delay, then the lexically smallest elevator ID. Predict using a clone of each car with the new call added, advancing the same routing logic without future requests. Held cars are ineligible for new calls. Assignments remain stable; holding a car may delay its existing requests, which the UI must show. No claim of globally optimal scheduling or starvation freedom under infinite traffic.
- One HTTP command handler mutates state synchronously. The real-time clock uses elapsed monotonic time and a retained remainder to advance fixed steps; do not lose elapsed time when the event loop is delayed. All three cars advance each step.
- `GET /api/state` every 200 ms is sufficient for this small simulator. Use one outstanding poll at a time, snapshots with monotonic revisions, and no automatic POST retries. Development uses Vite's `/api` proxy; production serves the built client and API from the same Node process.
- Scope ends with local implementation, tests, browser demonstration, and presentation notes. Do not deploy, publish the PDF, create a remote repository, or send invitations as part of implementation.

## File structure

```text
package.json, package-lock.json, .nvmrc, .gitignore  scripts/runtime/reproducibility
tsconfig.json, tsconfig.server.json                strict TypeScript; Node ESM build
vite.config.ts, vitest.config.ts, playwright.config.ts
index.html                                        Vite HTML entry
shared/contracts.ts                               commands and JSON snapshots
server/elevator/Elevator.ts                        private car state and routing
server/elevator/DispatchStrategy.ts                abstract dispatch contract
server/elevator/EtaDispatchStrategy.ts             concrete pickup-time policy
server/elevator/ElevatorSystem.ts                  fleet, hall queue, commands
server/http.ts                                    HTTP validation and static files
server/main.ts                                    process, clock, shutdown
client/main.tsx, client/App.tsx, client/styles.css  app entry and layout
client/api.ts, client/useSimulation.ts             transport/poll lifecycle
client/components/Building.tsx                    ten rows and three shafts
client/components/ElevatorPanel.tsx               destinations and door controls
tests/elevator.test.ts, tests/system.test.ts        deterministic domain tests
tests/http.test.ts                                real ephemeral HTTP server tests
tests/client.test.tsx                             accessible controls and polling
tests/e2e/simulator.spec.ts                        browser scenarios
README.md, docs/presentation.md                    startup, choices, demo outline
```

Tests may share a fixture in `tests/helpers.ts` for ticking until a predicate or constructing a system. Give any wait helper a fixed upper bound and a useful failure message; no wall-clock sleeps in domain tests. Keep implementation bodies out of this plan.

## Shared interfaces

Define these once in Task 1; later tasks use the same names. All snapshots contain copies, never live collections.

```ts
type Direction = 'up' | 'down';
type ElevatorId = 'A' | 'B' | 'C';
type Command =
  | { type: 'hallCall'; floor: number; direction: Direction }
  | { type: 'destination'; elevatorId: ElevatorId; floor: number }
  | { type: 'holdDoor' | 'closeDoor'; elevatorId: ElevatorId };
type CommandResult = { ok: true } | { ok: false; error: string };
interface HallCall { floor: number; direction: Direction }
interface ElevatorSnapshot {
  id: ElevatorId; floor: number; nextFloor: number | null;
  progress: number; // 0..1 toward nextFloor; zero when stationary
  direction: Direction | 'idle'; door: 'open' | 'closed'; held: boolean;
  destinations: number[]; pickups: HallCall[];
}
interface PendingCall extends HallCall {
  sequence: number; assignedTo: ElevatorId | null;
}
interface SimulationSnapshot {
  instanceId: string; revision: number;
  elevators: ElevatorSnapshot[]; calls: PendingCall[];
}
```

`floor` remains the last reached integer floor during transit. Domain constructors and commands reject non-integers or values outside 1–10. HTTP accepts `unknown` and validates before creating typed commands; no unchecked casts to bypass validation.

### Task 1: A deterministic elevator with directional stops and doors

**Files:** Create root package/config files except Playwright configuration, `shared/contracts.ts`, `server/elevator/Elevator.ts`, and `tests/elevator.test.ts`.

**Interfaces:** Produces `Elevator(id: ElevatorId, initialFloor: number)` with `snapshot(): ElevatorSnapshot`, `addPickup(call: HallCall): void`, `selectDestination(floor: number): CommandResult`, `holdDoor(): CommandResult`, `closeDoor(): CommandResult`, `tick(): HallCall[]`, and `estimatePickupMs(call: HallCall): number`. Each tick is 100 ms and returns newly served hall calls. Estimation clones state, cannot mutate the original, and returns `Infinity` for a held car.

- [ ] **Step 1: Create the runnable test harness.** Configure strict TypeScript, Node ESM, Vite, and Vitest; add `test`, `typecheck`, `dev`, `build`, and `start` scripts with explicit commands. `test` excludes `tests/e2e`; `build` produces `dist/server` and `dist/client`; `start` runs the compiled server. Configure server ESM imports to work after compilation. If still outside Git, initialize a repository with runtime/build artifacts ignored. Install and lock the proposed dependencies needed by this plan.
- [ ] **Step 2: Write failing cases in `tests/elevator.test.ts`.** Use the following named assertions; every scenario advances `tick()` explicitly:
  ```ts
  // initial_bounds: new Elevator('A', 1)
  expect(car.snapshot()).toMatchObject({ floor: 1, door: 'closed', direction: 'idle' });
  // board_at_1: addPickup({floor: 1, direction: 'up'}), tick, selectDestination(10)
  expect(car.selectDestination(10)).toEqual({ ok: true });
  // directional_pickup: boarded destination 10, add floor-5 up and down calls
  expect(firstFloor5Service).toEqual([{ floor: 5, direction: 'up' }]);
  expect(floor10ReachedBeforeFloor5DownService).toBe(true);
  // door_hold: hold while open, queue a destination, advance 100 ticks
  expect(car.snapshot()).toMatchObject({ floor: 1, door: 'open', held: true });
  // immediate_close: close held door before advancing another tick
  expect(car.snapshot()).toMatchObject({ door: 'closed', held: false });
  // invalid_floor and premature_destination: table includes 0, 11, 1.5, NaN
  expect(result.ok).toBe(false); expect(after).toEqual(before);
  // transit_controls: call holdDoor/closeDoor while nextFloor is non-null
  expect(result.ok).toBe(false); expect(after).toEqual(before);
  // estimate_is_pure and bounded: finite queued trip; compare snapshots
  expect(Number.isFinite(eta)).toBe(true); expect(after).toEqual(before);
  ```
  Also assert one floor takes exactly 10 ticks, dwell lasts 20 ticks, every moving snapshot has closed doors, floor-10 down pickup opens after reversal, and a destination behind the sweep is eventually reached. Resolve test variables from recorded snapshots/returned service events, not hardcoded booleans.
- [ ] **Step 3: Run the tests red.** `npm test -- tests/elevator.test.ts` must fail because `Elevator` is absent or behavior is missing, not because the test runner is broken.
- [ ] **Step 4: Implement the declared interfaces in `Elevator.ts`.** Encapsulate mutable state with private fields, deduplicate stops, implement the routing and timings above, and ensure estimation terminates when its marked call is served. Internal clone simulation has no new arrivals; document why finite non-held work terminates. Reject invalid commands before mutation; choosing the current floor while open succeeds as a no-op.
- [ ] **Step 5: Run the focused tests green.** `npm test -- tests/elevator.test.ts` and `npm run typecheck` must exit 0. Uncreated later entry points must not be part of the current typecheck input.
- [ ] **Step 6: Commit the task.** Stage only the listed created files and lockfile; commit as `feat: add deterministic elevator domain`.

### Task 2: Coordinate the three-car fleet and allocation

**Files:** Create `server/elevator/DispatchStrategy.ts`, `server/elevator/EtaDispatchStrategy.ts`, `server/elevator/ElevatorSystem.ts`, `tests/system.test.ts`.

**Interfaces:** Consumes Task 1. Produces abstract `DispatchStrategy.choose(call: HallCall, cars: readonly Elevator[]): ElevatorId | null`; `EtaDispatchStrategy extends DispatchStrategy` overrides it. Produces `ElevatorSystem(strategy?: DispatchStrategy)`, `execute(command: Command): CommandResult`, `tick(): void`, and `snapshot(): SimulationSnapshot`. Default policy is `EtaDispatchStrategy`. Each system generates an immutable `instanceId` using Node's `randomUUID()`. The system increments revision once for a successful state-changing command or tick; rejections and duplicate/no-op commands do not increment it.

- [ ] **Step 1: Write failing cases in `tests/system.test.ts`.** Assert these outcomes through the declared interfaces:
  ```ts
  expect(system.snapshot().elevators.map(e => e.floor)).toEqual([1, 2, 10]);
  expect(system.snapshot().elevators).toHaveLength(3);
  // two identical floor-5 up commands, before advancing time
  expect(system.snapshot().calls).toHaveLength(1);
  // separate up/down requests at floor 5
  expect(system.snapshot().calls.map(c => c.direction).sort()).toEqual(['down', 'up']);
  // car A at 1, B at 2, C at 10: floor 9 down
  expect(system.snapshot().calls[0].assignedTo).toBe('C');
  // inject a test subclass of DispatchStrategy choosing B
  expect(system.snapshot().calls[0].assignedTo).toBe('B');
  // finite workload after sufficient bounded ticks
  expect(system.snapshot().calls).toEqual([]);
  ```
  Add explicit scenarios for three cars progressing during the same ten ticks, equal ETA choosing A, a closer wrong-way car losing to a faster eligible car, held cars excluded, all-held calls remaining pending until release, boundary directions rejected (1/down and 10/up), and one served call disappearing without dropping the other direction. Use a forced-A test strategy to replay the PDF's 1→10 / floor-5 example without another car masking the direction rule.
- [ ] **Step 2: Run red.** `npm test -- tests/system.test.ts` must fail on missing fleet behavior.
- [ ] **Step 3: Implement fleet coordination.** Construct A/B/C at the specified floors, validate commands, dispatch oldest-first on acceptance and after ticks, assign a call to only one car, and remove it only on the matching car's service event. Queue assignments before advancement consistently. Demonstrate inheritance via the policy base class and polymorphism via injected strategies; avoid dummy elevator subclasses with identical behavior.
- [ ] **Step 4: Run green.** `npm test -- tests/elevator.test.ts tests/system.test.ts` and `npm run typecheck` must exit 0. Confirm snapshots cannot mutate internal state by modifying a returned snapshot and comparing a fresh one.
- [ ] **Step 5: Commit.** Stage this task's files; commit as `feat: coordinate elevator dispatch and hall requests`.

### Task 3: Expose the simulation through HTTP and run its clock

**Files:** Create `server/http.ts`, `server/main.ts`, `tests/http.test.ts`; update `package.json` and `tsconfig.server.json` to include the server entry point.

**Interfaces:** Consumes Task 2. Produces `createServer(system: ElevatorSystem, clientDirectory?: string): import('node:http').Server`. `GET /api/state` returns `SimulationSnapshot`; `POST /api/commands` accepts `Command` and returns `{ result: CommandResult, state: SimulationSnapshot }`. Success is 200; malformed/invalid commands are 400, unsupported method 405, unknown API route 404, body above 8 KiB 413. Responses to API calls disable caching. Port defaults to 3001 and is configurable through `PORT`.

- [ ] **Step 1: Write failing HTTP cases.** Start a real ephemeral server with a test-owned system (no automatic clock); use `fetch`:
  ```ts
  expect((await state()).elevators).toHaveLength(3);
  expect((await post({ type: 'hallCall', floor: 5, direction: 'up' })).status).toBe(200);
  // Promise.all of duplicate POSTs before advancing simulation
  expect((await state()).calls).toHaveLength(1);
  expect((await post({ type: 'hallCall', floor: 11, direction: 'up' })).status).toBe(400);
  expect(await state()).toEqual(beforeInvalidRequest);
  ```
  Add raw malformed JSON, null/array bodies, unknown command/elevator, wrong direction/type, oversized body, unknown route, and wrong-method assertions for the specified statuses. Close connections and server after each fixture. Test static index/assets from a temporary directory and reject directory traversal.
- [ ] **Step 2: Run red.** `npm test -- tests/http.test.ts` must fail on the missing server contract.
- [ ] **Step 3: Implement `http.ts`.** Validate at the boundary, process accepted commands synchronously, bound request size, serve production assets with correct MIME types, and keep all `/api/*` failures JSON rather than falling back to HTML.
- [ ] **Step 4: Implement `main.ts`.** Advance 100 ms fixed steps using accumulated monotonic elapsed time. Stop timer and server on SIGINT/SIGTERM; launching a fresh process resets to the initial state. Configure development startup to run server and Vite together and production static files relative to the compiled module, not the shell working directory.
- [ ] **Step 5: Verify.** `npm test -- tests/http.test.ts` and `npm run typecheck` exit 0. Launch the server, use `curl` to retrieve state and submit a valid call, and observe its revision/floor change on a later GET; stop the process cleanly.
- [ ] **Step 6: Commit.** Stage the listed files; commit as `feat: expose authoritative simulation API`.

### Task 4: Build the React control surface

**Files:** Create all `client/` files from the file map, `index.html`, `tests/client.test.tsx`; update Vite/Vitest configuration and package scripts as required for React/jsdom and the API proxy.

**Interfaces:** Consumes shared contracts and Task 3 HTTP endpoints. Produces `getState(signal?: AbortSignal): Promise<SimulationSnapshot>`, `sendCommand(command: Command): Promise<{ result: CommandResult; state: SimulationSnapshot }>`, and `useSimulation(): { state: SimulationSnapshot | null; connected: boolean; error: string | null; send: (command: Command) => Promise<void> }`. Components: `Building({ state, disabled, onCommand })` and `ElevatorPanel({ elevator, disabled, onCommand })`, using snapshot types and `(command: Command) => Promise<void>` callbacks.

- [ ] **Step 1: Write failing UI cases with mocked HTTP and fake timers.** Use accessible labels and assertions:
  ```ts
  expect(screen.getByRole('button', { name: 'Floor 1 up' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Floor 1 down' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Floor 10 up' })).toBeNull();
  // click Floor 5 up
  expect(sent).toEqual({ type: 'hallCall', floor: 5, direction: 'up' });
  // A arrives with open doors; click its Floor 10 destination
  expect(sent).toEqual({ type: 'destination', elevatorId: 'A', floor: 10 });
  expect(screen.getByRole('button', { name: 'Elevator A hold door' })).toBeDisabled(); // moving fixture
  ```
  Also assert 10 labeled rows, 3 labeled cars, queued call indicators, closed-door destination buttons disabled, open-door hold/close commands, and visible server validation errors. Simulate a failed poll: controls disable, last snapshot remains with a disconnected message, and no POST is retried. On recovery a new state enables controls. Deliver an older GET after a newer POST and assert the newer revision remains displayed. A new `instanceId` with revision zero must replace the previous server's state; a late response from the retired instance must not replace it. Unmount cancels pending polling.
- [ ] **Step 2: Run red.** `npm test -- tests/client.test.tsx` must fail on missing client behavior.
- [ ] **Step 3: Implement transport and hook interfaces.** Poll sequentially every 200 ms and adopt only non-older revisions within the same `instanceId`. A changed instance resets revision comparison; keep retired instance IDs for the mounted hook's lifetime to reject late responses from an old process. Report command errors and refresh state after uncertain network failure; never replay the command automatically.
- [ ] **Step 4: Implement the components.** Render floors 10→1 with three shafts, visible direction/door/held state, shared floor call buttons and per-car destination/door panels. Use real buttons with text/accessible names and pending indicators. Apply supplied snapshot progress to position cars; CSS may smooth between snapshots but cannot advance domain state. Include a compact layout usable on narrow screens.
- [ ] **Step 5: Verify.** `npm test -- tests/client.test.tsx`, `npm run typecheck`, and `npm run build` exit 0. Start `npm run dev`, use a real browser to call a car, select a destination after arrival, hold and close doors, and inspect the console for errors.
- [ ] **Step 6: Commit.** Stage this task's files; commit as `feat: add React elevator controls and visualization`.

### Task 5: Prove the integrated behavior and prepare the handoff

**Files:** Create `playwright.config.ts`, `tests/e2e/simulator.spec.ts`, `README.md`, `docs/presentation.md`; update `package.json` with `test:e2e`.

**Interfaces:** Consumes the production build, HTTP contract, and accessible UI labels. Playwright starts a fresh production server per isolated scenario/worker on its own port; no test-only reset API is added to the product. Retain failure screenshots/traces locally and ignore generated artifacts in Git.

- [ ] **Step 1: Write browser acceptance tests.** Each case uses a fresh process and bounded waits:
  ```ts
  await expect(page.getByRole('button', { name: 'Floor 1 up' })).toBeVisible();
  // board A at 1, choose 10, issue floor-5 calls in both directions
  await expect(page.getByLabel('Elevator A status')).toContainText('Floor 10');
  // after holding A while open for longer than the normal dwell
  expect(afterHold.floor).toBe(beforeHold.floor);
  expect(afterHold.door).toBe('open');
  // after Close, queued destination is eventually reached
  await expect(page.getByLabel('Elevator A status')).toContainText('Floor 10');
  ```
  For an unambiguous direction-rule scenario, hold B at floor 2 and C at floor 10 before boarding A at 1, then request 10 and both floor-5 directions. Observe A serve 5/up, reach 10, then serve 5/down. Verify independent concurrent motion in another scenario, repeated clicks remaining one request, refresh retaining server state, and offline/reconnect showing truthful state. Use API snapshots as additional assertions alongside real UI actions, not as a substitute for them.
- [ ] **Step 2: Run the acceptance suite.** `npm run build && npm run test:e2e` must pass all scenarios. Any failure is fixed in its owning component, with a regression at the lowest useful layer; do not weaken the expected behavior.
- [ ] **Step 3: Write `README.md`.** Include prerequisites, clean install (`npm ci`), dev/production/test commands, endpoint examples, routing explanation, OOP examples linked to actual classes, timing/hold assumptions, state reset semantics, and known limitations (in-memory state, no capacity model, held assigned requests wait). Separate PDF requirements from implementation decisions. Document repository/invitation delivery as a user-controlled step.
- [ ] **Step 4: Write `docs/presentation.md`.** Prepare a 45-minute outline: requirements/assumptions 5 min, architecture and OOP 10 min, dispatch/state machine 10 min, live demo and tests 10 min, tradeoffs/questions 10 min. Include the PDF's floor-5 example, door hold/close, and three-car concurrency as repeatable demonstrations.
- [ ] **Step 5: Run the final evidence pass.** `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` must exit 0. Add lint only if configured; do not claim a nonexistent lint check passed. Personally exercise the production UI in a browser and record commands, outcomes, and any unavailable checks in the implementation handoff. Confirm no pending timers or browser console errors after shutdown.
- [ ] **Step 6: Commit.** Stage this task's files and any reviewed corrective edits; commit as `test: verify simulator flows and document interview demo`.

## Planning self-review and completion boundary

- Coverage: Tasks 1–2 implement movement, directional requests, efficient allocation, concurrency, and OOP; Tasks 3–4 implement Node/React delivery and controls; Task 5 provides acceptance evidence and presentation preparation.
- The five Review Focus risks have explicit tests assigned above. The original PDF, including arrow icons and starting positions, was visually inspected during planning.
- Interface names and snapshot fields are shared across tasks. HTTP tests use manual ticks; only the executable server owns the real clock.
- The starting workspace contains no application code and is not a Git repository; graph lookup returned no relevant implementation. All code paths in this plan are proposed creations.
- Planning validation is a document/spec review only. No application has been implemented and no application tests have run.
- Implementation is complete when the focused tests, production build, browser flows, and documented manual demonstration pass, or a concrete environment blocker is explicitly reported. Publishing and invitations are outside this local plan.
