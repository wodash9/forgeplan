# ForgePlan

ForgePlan is a local-first platform for modeling production plants, validating feasibility, and eventually optimizing production schedules.

This repository currently contains the local-first ForgePlan foundation through **Phase 5.0: OR-Tools CP-SAT Local Adapter**.

## Current scope

Included:

- TypeScript domain types
- Zod schemas
- plant validation helpers
- SQLite local store using `node:sqlite`
- append-only event log
- React + Vite visual plant editor MVP
- React Flow / XYFlow node canvas
- solver IR for scheduling model translation
- deterministic mock solver adapter
- UI solve feedback with mock schedule KPIs
- simple Gantt/timeline schedule visualization
- local OR-Tools CP-SAT adapter for Node/Python environments
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- advanced custom node asset library
- local HTTP API
- CP-SAT integration in the web UI
- advanced CP-SAT production features such as setups, batching, alternate machines, calendars, and cumulative capacity
- networking/cloud

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run build:web
```

## Fixtures

- `fixtures/minimal-valid-plant.json` — a small ready plant with one material, source, mixer, dispatch, route, and order.
- `fixtures/invalid-plant.json` — intentionally invalid data for schema/blocker tests.

## Obsidian specs

Specs live in Etharlia:

- `wiki/projects/forgeplan.md`
- `wiki/development/forgeplan/forgeplan-1-0-domain-kernel-local-fixture.md`
- `wiki/development/forgeplan/forgeplan-2-0-local-persistence-sqlite-event-log.md`
- `wiki/development/forgeplan/forgeplan-3-0-visual-plant-editor-mvp.md`
- `wiki/development/forgeplan/forgeplan-3-1-react-flow-node-canvas.md`
- `wiki/development/forgeplan/forgeplan-4-0-solver-ir-mock-solver.md`
- `wiki/development/forgeplan/forgeplan-4-1-ui-solve-feedback.md`
- `wiki/development/forgeplan/forgeplan-4-2-schedule-gantt-visualization.md`
- `wiki/development/forgeplan/forgeplan-5-0-ortools-cp-sat-local-adapter.md`

## Local store

`ForgePlanLocalStore` persists plants, scenarios, schedules, and events in a local SQLite database.

Current tables:

- `metadata`
- `plants`
- `scenarios`
- `schedules`
- `events`

## Solver IR

ForgePlan translates canonical `Plant + Scenario` data into a solver-neutral `SolverModel` with resources, operations, precedences, orders, horizon, time unit, and objective.

The `MockSolverAdapter` creates deterministic feasible/infeasible schedules for integration tests and UI plumbing. It does not optimize and should not be used for production decisions.

Node-only solver integrations live behind separate imports so the browser bundle stays clean. `OrToolsCpSatAdapter` runs a local Python OR-Tools CP-SAT worker through stdin/stdout JSON and supports fixed-resource operations, no-overlap, route precedences, horizon, and makespan minimization. It fails explicitly when Python or OR-Tools is unavailable; this repository does not install OR-Tools automatically.

## Web editor

Run the local visual editor:

```bash
npm run dev
```

The current editor uses React Flow / XYFlow for the node canvas, edges, selection, pan/zoom controls, and node dragging while keeping the canonical ForgePlan `Plant` model as the source of truth.

Use **Run mock solve** to build a local solver model, run the deterministic mock solver, and preview status, KPIs, violations, scheduled operations, and a simple Gantt-style timeline. This is UI plumbing only; it is not real optimization yet.

## Next phase candidate

ForgePlan 5.1 — CP-SAT solve command/API boundary, or ForgePlan 5.2 — richer CP-SAT model features such as setup times, alternate machines, batching, and cumulative capacity.
