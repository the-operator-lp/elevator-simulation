# Backend MVC and Frontend Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the backend into model, controller, and view responsibilities and organize frontend files by technical layer without changing user-visible behavior or the HTTP API.

**Architecture:** Keep the elevator domain classes as models. Add a controller that validates command payloads and invokes the system, and a JSON view that writes response status, headers, and bodies. Keep `server/http.ts` as the transport/router and static file server. On the client, place React components, hooks, and API services in their corresponding layer directories.

**Tech Stack:** Node.js 22, TypeScript, native `node:http`, React 19, Vitest, Playwright.

**Spec:** This plan implements the approved refactor request from the conversation; no separate spec file exists.

## Global Constraints

- Preserve all simulation rules, UI behavior, and accessibility.
- Preserve the HTTP paths, methods, status codes, headers, and response shapes.
- Add no dependencies.
- Preserve `createServer(system, clientDirectory?)`.

## Review Focus

- Invalid JSON, malformed commands, and oversized request bodies retain their existing error status and response shapes; pin with controller and HTTP tests.
- Unknown routes, unsupported methods, and static-file path traversal retain their current behavior; pin with existing HTTP tests.
- Client polling, reconnect handling, and command updates remain intact after file moves; pin with client and browser tests.
- Backend snapshots remain detached from mutable model state; pin with existing system tests.
- Destination and hall-call behavior remains unchanged; pin with existing elevator and system tests.

---

### Task 1: Separate backend MVC responsibilities

**Files:**
- Create: `server/controllers/simulationController.ts`
- Create: `server/views/jsonView.ts`
- Modify: `server/http.ts`
- Create: `tests/controller.test.ts`
- Test: `tests/http.test.ts`, `tests/system.test.ts`

**Interfaces:**
- Consumes: `ElevatorSystem.snapshot(): SimulationSnapshot` and `ElevatorSystem.execute(command: Command): CommandResult`.
- Produces: `SimulationController.getState(): ControllerResponse` and `SimulationController.executeCommand(value: unknown): ControllerResponse`, where `ControllerResponse` is `{ status: number; body: unknown }`; `renderJson(response: ServerResponse, status: number, value: unknown): void` writes the JSON response.

- [ ] Write controller tests first for valid state, valid command, invalid command, and command rejection; assert exact status and response body.
- [ ] Run `npm test -- tests/controller.test.ts`; expected: fail because the new controller module does not exist.
- [ ] Implement the controller, keeping command parsing and simulation invocation out of the router.
- [ ] Implement `renderJson` in the view layer; preserve `Cache-Control: no-store` and the current JSON content type.
- [ ] Delegate `/api/state` and `/api/commands` from `server/http.ts` to the controller and view; leave request-body size/JSON parsing errors and static serving behavior intact.
- [ ] Run `npm test -- tests/controller.test.ts tests/http.test.ts tests/system.test.ts`; expected: all targeted tests pass.
- [ ] Run `npm test` and `npm run typecheck`; expected: all tests and both TypeScript checks pass.

### Task 2: Organize frontend by technical layer

**Files:**
- Move: `client/api.ts` to `client/services/simulationApi.ts`
- Move: `client/useSimulation.ts` to `client/hooks/useSimulation.ts`
- Keep: `client/components/Building.tsx`, `client/components/ElevatorPanel.tsx`, `client/App.tsx`, and `client/styles.css`
- Modify: `client/App.tsx`, `client/hooks/useSimulation.ts`, `client/services/simulationApi.ts`, and imports affected by the moves
- Test: `tests/client.test.tsx`, `tests/e2e/simulator.spec.ts`

**Interfaces:**
- Consumes: backend task's unchanged shared contracts in `shared/contracts.ts`.
- Produces: the existing `getState`, `sendCommand`, and `useSimulation` exports at the new technical-layer paths; `App` remains the application composition point.

- [ ] Update the client test imports for the new hook and service module paths and add a focused service behavior test for the valid `getState` response.
- [ ] Run `npm test -- tests/client.test.tsx`; expected: fail because the new module paths do not yet exist.
- [ ] Move the API module and hook into their layer directories, fix relative imports, and update `App.tsx` imports without changing behavior.
- [ ] Run `npm test -- tests/client.test.tsx`; expected: client tests pass.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`; expected: all pass.
