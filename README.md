# ForgePlan

ForgePlan is a local-first platform for modeling production plants, validating feasibility, and eventually optimizing production schedules.

This repository currently contains the local-first ForgePlan foundation through **Phase 4.1: UI Solve Feedback**.

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
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- advanced custom node asset library
- local HTTP API
- real external solver
- CP-SAT
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

## Web editor

Run the local visual editor:

```bash
npm run dev
```

The current editor uses React Flow / XYFlow for the node canvas, edges, selection, pan/zoom controls, and node dragging while keeping the canonical ForgePlan `Plant` model as the source of truth.

Use **Run mock solve** to build a local solver model, run the deterministic mock solver, and preview status, KPIs, violations, and scheduled operations. This is UI plumbing only; it is not real optimization yet.

## Next phase candidate

ForgePlan 5.0 — OR-Tools CP-SAT local adapter, or ForgePlan 4.2 — richer schedule/Gantt visualization before adding the real solver.
