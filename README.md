# ForgePlan

ForgePlan is a local-first platform for modeling production plants, validating feasibility, and eventually optimizing production schedules.

This repository currently contains the local-first ForgePlan foundation through **Phase 7: PFG CP-SAT production solver V2**, plus a planner-facing demo loop for showing orders, planning feedback, and bottleneck explanations.

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
- visible planner orders panel with editable demo demand
- planner-facing solve action and post-solve explanation of tardiness, bottleneck and next action
- simple Gantt/timeline schedule visualization
- local OR-Tools CP-SAT adapter for Node/Python environments
- PFG/OptiPlan CP-SAT production layer with batching, dosing levels, silos, inventory reservoirs, granulator assignment, final storage and dispatch constraints
- local solve CLI boundary for mock/CP-SAT schedules
- local HTTP API backed by SQLite for plants, scenarios, schedules, events and solve requests
- product catalog with simple BOM/dependency graph
- equipment production modes: continuous or batch
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- advanced custom node asset library
- fully decomposed/warm-start/true multi-pass lexicographic solver pipeline
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
- `wiki/development/forgeplan/forgeplan-5-1-local-solve-command-boundary.md`

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

Node-only solver integrations live behind separate imports so the browser bundle stays clean. `OrToolsCpSatAdapter` runs a local Python OR-Tools CP-SAT worker through stdin/stdout JSON. For generic plants it supports fixed-resource operations, no-overlap, route precedences, earliest starts, due-date tardiness KPIs, horizon, and a weighted late/tardiness/makespan objective. For PFG plants with `metadata.pfgStage`, it switches to the richer PFG/OptiPlan layer covering batch splitting, multi-level dosing, intermediate/final silo assignment, event-based inventory reservoirs, granulator assignment, dispatch assignment, sequence-dependent setup/changeover delays, due-date cuts and restricted due-dominance symmetry. It fails explicitly when Python or OR-Tools is unavailable; this repository does not install OR-Tools automatically. See `docs/solver-pfg-cpsat-v2.md` for the implemented PFG constraints and modeling assumptions.

Run a local solve from a built checkout:

```bash
npm run build
npm run solve -- fixtures/minimal-valid-plant.json --strategy mock
npm run solve -- fixtures/minimal-valid-plant.json --strategy cp_sat --time-limit 5 --workers 4
```

The command prints canonical `Schedule` JSON to stdout. `mock` is the safe default; `cp_sat` requires local Python OR-Tools. TypeScript build artifacts go to `dist/`; Vite web artifacts go to `dist-web/` so the local solve CLI remains available after web builds.

## Local HTTP API

Start the local API/server after building:

```bash
FORGEPLAN_PYTHON_BINARY=/path/to/python-with-ortools npm run server
```

Useful solve endpoints:

- `POST /api/solve/mock` with `{ "plantId": "..." }`
- `POST /api/solve/cp-sat` with `{ "plantId": "...", "timeLimitSeconds": 10, "workers": 4 }`
- `POST /api/plants/:plantId/solve` with `{ "strategy": "cp_sat" }`

Solve runtime settings are bounded for local availability: `timeLimitSeconds <= 300` and `workers <= 16`. Each solve without an explicit `scenarioId` creates a fresh immutable scenario so schedules keep accurate strategy/options provenance.

Schedules produced by either strategy are validated, stored in SQLite, and recorded in the append-only event log.

## Web editor

Run the local visual editor:

```bash
npm run dev
```

The current editor uses React Flow / XYFlow for the node canvas, edges, selection, pan/zoom controls, and node dragging while keeping the canonical ForgePlan `Plant` model as the source of truth.

The planner demo loop starts on **Planificación local de producción**. A planner can review and edit demo orders in **Pedidos a planificar**, choose **Demo mock** or **CP-SAT local**, click **Planificar pedidos**, and then inspect KPIs, a Gantt-style timeline, and **Qué ha pasado** with late orders, likely bottleneck, and next action. The default UI path is labelled **Solver demo** while it uses the deterministic mock solver.

Use **Planificar pedidos** in **Demo mock** mode to build a local solver model in the browser, run the deterministic mock solver, and preview status, KPIs, violations, scheduled operations, and a simple Gantt-style timeline. This is UI plumbing only; it is not real optimization yet.

To exercise **CP-SAT local** from the web UI, run the local API in another terminal and provide a Python with OR-Tools:

```bash
FORGEPLAN_PYTHON_BINARY=/path/to/python-with-ortools npm run server
npm run dev
```

The browser posts the current plant to `http://127.0.0.1:8787/api/plants` and then calls `POST /api/solve/cp-sat` with the selected `timeLimitSeconds` and `workers`. The solver remains local; no cloud service is called.

## Next phase candidate

ForgePlan next solver layer — harden the production solver with decomposed baseline, warm-start hints, true multi-pass lexicographic solving, calendars/maintenance windows and larger benchmark instances.
