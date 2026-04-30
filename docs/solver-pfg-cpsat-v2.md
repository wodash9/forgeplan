# ForgePlan PFG CP-SAT V2

ForgePlan now has a first end-to-end PFG/OptiPlan production solver layer on top of the local Google OR-Tools CP-SAT adapter.

The architecture remains local-first:

```text
Plant + Scenario
  -> TypeScript SolverModel / PFG Flow Model
  -> local Python OR-Tools worker over stdin/stdout JSON
  -> ForgePlan Schedule JSON
  -> CLI / API / SQLite / Gantt
```

## Sources used

The model is grounded in the local Etharlia/Obsidian OptiPlan material:

- `raw/documents/OptiPlan/PFG_Buenaventura_Martinez_Capell.pdf`
- `raw/documents/OptiPlan/Problem.md`
- `raw/documents/OptiPlan/constraints_formulation.md`
- `raw/documents/OptiPlan/MODEL_IMPROVEMENT_STEPS.md`

## Implemented constraints in this first PFG version

The TypeScript builder detects a PFG plant when nodes contain the documented `metadata.pfgStage` values:

- `dosification`
- `intermediate_storage`
- `granulation`
- `final_storage`
- `expedition`

It then adds `SolverModel.pfgFlow`, which the CP-SAT adapter solves with the richer PFG model instead of the older fixed-route V1 model.

Covered constraints:

- **Batch splitting**: each order is split into lots/batches of size at most the dosing line batch size.
- **Multi-level dosing**: each batch executes all dosing levels.
- **Dosing phase precedence**: level `l+1` starts after level `l` ends for the same batch.
- **Dosing level capacity**: `NoOverlap` per dosing level.
- **Within-order batch symmetry**: batches of the same order are processed in batch-index order.
- **Dosing cleaning/changeover**: pairwise reified changeover delays on the last dosing level when products differ.
- **Intermediate silo assignment**: every order is assigned to exactly one feasible intermediate silo.
- **Intermediate silo eligibility**: product compatibility, nominal capacity, direct dosing-line connection and reachable granulator checks.
- **Intermediate static packing cut**: assigned quantity cannot exceed silo remaining capacity.
- **No mixed products in intermediate silos**: different products cannot share the same intermediate silo in the same solve.
- **Batch availability**: a batch becomes available after last dosing level plus selected silo dump/transfer time.
- **Supply-ready/full-ready times**: order release into granulation is based on minimum start quantity and full batch availability.
- **Granulator assignment**: every order is assigned to exactly one feasible granulator.
- **Granulator compatibility**: selected intermediate silo must be connected to the selected granulator.
- **Granulator unary capacity**: optional intervals plus `NoOverlap` per granulator.
- **Granulator sequence-dependent setup**: pairwise reified setup delays when different products share a granulator.
- **Intermediate inventory reservoir**: event-based stock conservation using batch dumps and granulation consumption events.
- **Final silo assignment**: every order is assigned to exactly one feasible final silo.
- **Final silo eligibility**: product compatibility, nominal capacity and reachable dispatch checks.
- **Final static packing cut**: assigned finished quantity cannot exceed final silo capacity.
- **No mixed products in final silos**: different products cannot share the same final silo in the same solve.
- **Final fill/availability**: final-ready time is granulation end plus selected final silo transfer/fill time.
- **Final inventory reservoir**: event-based stock conservation from final-ready to dispatch-start.
- **Dispatch line assignment**: every order is assigned to exactly one dispatch line.
- **Dispatch compatibility**: selected final silo must be connected to selected dispatch line.
- **Dispatch release**: dispatch starts after final-ready.
- **Dispatch unary capacity**: optional intervals plus `NoOverlap` per dispatch line.
- **Dispatch sequence-dependent setup**: pairwise reified setup delays when different products share a dispatch line.
- **Tardiness and late-order KPIs**.
- **Makespan KPI**.
- **Weighted objective**: minimize late orders first, then total tardiness, then makespan.
- **On-time implication cuts**: minimum downstream duration cuts for orders marked on-time.
- **Resource-specific on-time cuts**: selected granulator/final silo/dispatch line variants of the due-date cuts.
- **Due-date capacity cuts**: global dosing/granulation/dispatch workload cuts at due checkpoints.
- **Restricted due-dominance symmetry**: interchangeable same-product/same-quantity/same-min-start orders are ordered by due date.

## Modeling assumptions

This is intentionally the first production-grade layer, not the final industrial solver.

Important assumptions inherited from the Obsidian notes:

- Each order uses exactly one intermediate silo and one final silo.
- Silo inventory is **event-based**, not fully time-indexed minute by minute.
- Static whole-order packing cuts are used as strengthening cuts.
- Product identity currently maps to `materialId` in ForgePlan orders.
- Changeover/setup defaults are conservative local defaults when no plant metadata overrides exist.
- Transfer times are taken from the selected enabled plant arcs for dosing-to-intermediate, intermediate-to-granulation, granulation-to-final and final-to-dispatch movement.
- The objective is still a single weighted CP-SAT solve, not the future true multi-pass lexicographic solver.
- The decomposed + warm-start pipeline from the OptiPlan notes is still future work.

## Verification command

With a local Python that has OR-Tools installed:

```bash
FORGEPLAN_TEST_PYTHON_BINARY=/tmp/forgeplan-ortools-venv/bin/python \
  npx vitest run test/ortoolsCpSatAdapter.test.ts -t "PFG default plant"
```

Manual CLI smoke:

```bash
npm run build
npm run solve -- fixtures/minimal-valid-plant.json --strategy cp_sat --time-limit 5 --workers 2 --python /tmp/forgeplan-ortools-venv/bin/python
```

For the PFG default plant, the richer solver path is exercised through `createDemoPlant()` in tests and returns operations across dosing, intermediate silo dump, granulation, final silo fill and dispatch.
