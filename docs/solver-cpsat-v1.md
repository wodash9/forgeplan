# ForgePlan CP-SAT V1

> Historical note: this document describes the first generic CP-SAT adapter. The current PFG production layer is documented in `docs/solver-pfg-cpsat-v2.md`.

ForgePlan now has a first local CP-SAT integration through Google OR-Tools. The integration keeps the product local-first: the TypeScript domain builds a Solver IR, the Node boundary sends it to a local Python OR-Tools worker through stdin/stdout, and the result comes back as a ForgePlan `Schedule` for the API, CLI, storage and Gantt layer.

## Sources used for constraints

Local OptiPlan/PFG material in Etharlia was used as the source of truth:

- `raw/documents/OptiPlan/PFG_Buenaventura_Martinez_Capell.pdf`
- `raw/documents/OptiPlan/Problem.md`
- `raw/documents/OptiPlan/constraints_formulation.md`
- `raw/documents/OptiPlan/MODEL_IMPROVEMENT_STEPS.md`

The full PFG model includes batching, dosing levels, intermediate silos, granulators, final silos, dispatch lines, inventory reservoirs, cleaning/changeovers and lexicographic objectives. ForgePlan V1 intentionally implements the smallest useful CP-SAT layer first.

## Implemented in ForgePlan V1

Covered constraints:

- One fixed interval variable per Solver IR operation.
- Operation duration: `end = start + duration`.
- Earliest start per order: `start >= earliestStart`.
- Route precedence: downstream operation starts after upstream operation ends.
- Unary resource capacity: `NoOverlap` for all operations assigned to the same resource.
- Horizon-bounded starts and ends.
- Order completion as max end of the order operations.
- Tardiness variable per order: `tardiness >= completion - dueTime` and `tardiness >= 0`.
- Late-order boolean per order.
- Makespan as max end over all operations.

Optimization objective for `cp_sat` scenarios:

```text
minimize lateOrders * horizon * 1000
       + totalTardiness * 100
       + makespan
```

This is a weighted single-pass approximation of the OptiPlan/PFG lexicographic intent: first avoid late orders, then reduce total tardiness, then compact the schedule.

## Platform integration points

- CLI: `node scripts/forgeplan-solve.mjs <plant.json> --strategy cp_sat --time-limit 5 --workers 4 --python <python-with-ortools>`
- Backend API: set `FORGEPLAN_PYTHON_BINARY=/path/to/python-with-ortools` before `npm run server`, then `POST /api/solve/cp-sat` or `POST /api/solve/cp_sat`
- Plant API shortcut: `POST /api/plants/:plantId/solve` with `{ "strategy": "cp_sat" }`
- Schedules returned by CP-SAT are persisted through the same SQLite LocalStore path as mock schedules.
- The API stores scenario settings with `strategy: "cp_sat"`, `timeLimitSeconds` and `workers`.
- Runtime settings are bounded for local availability: `timeLimitSeconds <= 300`, `workers <= 16`.
- Solve-created scenarios are unique per run; if an existing `scenarioId` is supplied, its strategy/options must match the requested solve.

## Explicitly not implemented yet

These PFG/OptiPlan constraints remain future layers:

- Splitting orders into production batches/lots.
- Multi-level dosing stage and dosing-level `NoOverlap`.
- Cleaning/changeover times between products.
- Intermediate silo assignment and compatibility.
- Intermediate inventory reservoir / stock conservation.
- Granulator assignment rather than fixed resource route.
- Final silo assignment and compatibility.
- Dispatch-line assignment and shared dispatch resources.
- Sequence-dependent setup times.
- True multi-pass lexicographic solve with hints/warm start.
- Decomposed solver flow for large instances.

## Verification note

A CP-SAT smoke test was run with a temporary local OR-Tools virtual environment at `/tmp/forgeplan-ortools-venv`, using:

```bash
node scripts/forgeplan-solve.mjs fixtures/minimal-valid-plant.json \
  --strategy cp_sat \
  --time-limit 5 \
  --workers 2 \
  --python /tmp/forgeplan-ortools-venv/bin/python
```

Result: `optimal`, one scheduled operation, makespan `30`, no tardiness.
