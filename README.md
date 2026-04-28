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
- minimal valid/invalid JSON fixtures
- unit tests

Not included yet:

- frontend
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

## Next phase candidate

ForgePlan 3.0 — Visual plant editor MVP or local API boundary.
