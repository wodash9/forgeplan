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
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- advanced React Flow canvas
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

The current editor uses a simple HTML/CSS canvas to validate the domain-to-UI flow before introducing React Flow.

## Next phase candidate

ForgePlan 4.0 — Local API boundary or React Flow canvas upgrade.
