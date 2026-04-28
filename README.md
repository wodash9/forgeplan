# ForgePlan

ForgePlan is a local-first platform for modeling production plants, validating feasibility, and eventually optimizing production schedules.

This repository currently contains **Phase 1.0: Domain Kernel + Local JSON Fixture**.

## Current scope

Included:

- TypeScript domain types
- Zod schemas
- plant validation helpers
- SQLite local store using `node:sqlite`
- append-only event log
- React + Vite visual plant editor MVP
- React Flow / XYFlow node canvas
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- advanced custom node asset library
- local HTTP API
- real solver
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

## Local store

`ForgePlanLocalStore` persists plants, scenarios, schedules, and events in a local SQLite database.

Current tables:

- `metadata`
- `plants`
- `scenarios`
- `schedules`
- `events`

## Web editor

Run the local visual editor:

```bash
npm run dev
```

The current editor uses React Flow / XYFlow for the node canvas, edges, selection, pan/zoom controls, and node dragging while keeping the canonical ForgePlan `Plant` model as the source of truth.

## Next phase candidate

ForgePlan 4.0 — Local API boundary or a richer React Flow editor pass with custom nodes, drag/drop palette, and interactive connection creation.
