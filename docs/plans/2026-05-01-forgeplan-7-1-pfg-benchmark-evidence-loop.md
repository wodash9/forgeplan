# ForgePlan 7.1 PFG Benchmark Evidence Loop Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convert the current PFG CP-SAT V2 solver from “works on the demo plant” into an evidence-backed planning engine with repeatable benchmark fixtures, measurable KPIs, and a safe path toward decomposition, warm-starts, lexicographic solving and calendars.

**Architecture:** Keep the solver local-first and Node/Python-boundary safe. Add benchmark fixtures and a CLI/reporting harness around the existing `runLocalSolve()` / `OrToolsCpSatAdapter` path before changing the mathematical model. The first deliverable is observability and regression safety, not a bigger solver.

**Tech Stack:** TypeScript, Vitest, Node CLI scripts, existing OR-Tools CP-SAT Python worker, JSON fixtures, Markdown reports.

---

## Why this is the next step

ForgePlan already has:

- editable planner-facing UI;
- local HTTP API;
- SQLite persistence;
- CP-SAT adapter;
- PFG production layer with batching, silos, reservoirs, granulators, final storage and dispatch;
- green quality gates.

The risky next temptation is to jump directly into warm-starts, decomposition or calendars. That would be premature. First we need a repeatable evidence loop that answers:

- Does the solver still work when demand grows?
- Which scenarios become infeasible or slow?
- Are late orders/tardiness/makespan improving or regressing?
- Which constraints are actually exercised by tests and fixtures?
- Can we compare future solver strategies honestly?

---

## Scope

Implement Phase 7.1 only:

- Add realistic PFG benchmark fixtures.
- Add a benchmark runner CLI.
- Produce machine-readable JSON and human-readable Markdown summaries.
- Add tests that run without real OR-Tools by using fake/sample benchmark results.
- Add optional real CP-SAT smoke path when `FORGEPLAN_TEST_PYTHON_BINARY` is available.
- Document how to run and interpret the benchmark.

## Non-goals

Do not implement yet:

- true multi-pass lexicographic solving;
- warm-start hints;
- decomposed solver pipeline;
- calendars/maintenance windows;
- cloud execution;
- UI benchmark dashboard;
- automatic solver tuning.

---

## Task 1: Add benchmark fixture directory

**Objective:** Create a clear place for realistic PFG benchmark plants without mixing them with minimal schema fixtures.

**Files:**
- Create: `fixtures/benchmarks/README.md`
- Create: `fixtures/benchmarks/pfg-small.json`
- Create: `fixtures/benchmarks/pfg-tight-due-dates.json`
- Create: `fixtures/benchmarks/pfg-capacity-pressure.json`
- Test: `test/benchmarkFixtures.test.ts`

**Steps:**
1. Create `fixtures/benchmarks/README.md` explaining each fixture and expected purpose.
2. Create `pfg-small.json` as a serialized version of the current PFG demo plant.
3. Create `pfg-tight-due-dates.json` with the same plant structure but tighter due times to force tardiness pressure.
4. Create `pfg-capacity-pressure.json` with larger quantities/more orders to exercise batching, silo assignment and bottlenecks.
5. Add `test/benchmarkFixtures.test.ts` that loads every JSON in `fixtures/benchmarks`, parses it with `plantSchema`, and validates it with `validatePlant`.
6. Run:
   ```bash
   npx vitest run test/benchmarkFixtures.test.ts
   npm run typecheck
   ```

**Expected:** all benchmark fixtures are valid plants and future solver changes have stable inputs.

---

## Task 2: Add benchmark result types

**Objective:** Define stable TypeScript structures for benchmark summaries before writing the CLI.

**Files:**
- Create: `src/solver/benchmarkTypes.ts`
- Test: `test/benchmarkReport.test.ts`

**Suggested shape:**

```ts
export interface SolverBenchmarkCase {
  id: string;
  fixturePath: string;
  strategy: 'mock' | 'cp_sat';
  timeLimitSeconds: number;
  workers: number;
}

export interface SolverBenchmarkResult {
  caseId: string;
  fixturePath: string;
  strategy: 'mock' | 'cp_sat';
  status: string;
  scheduleStatus: string;
  operationCount: number;
  lateOrders: number;
  totalTardiness: number;
  makespan: number;
  elapsedMs: number;
  issueCodes: string[];
}

export interface SolverBenchmarkReport {
  generatedAt: string;
  results: SolverBenchmarkResult[];
}
```

**Steps:**
1. Add the types.
2. Add a tiny test that imports the types through a sample object and verifies expected keys via normal TypeScript compilation.
3. Run:
   ```bash
   npx vitest run test/benchmarkReport.test.ts
   npm run typecheck
   ```

**Expected:** benchmark reporting has a typed contract.

---

## Task 3: Add benchmark runner module

**Objective:** Implement reusable benchmark logic separate from the CLI wrapper.

**Files:**
- Create: `src/solver/benchmarkRunner.ts`
- Test: `test/benchmarkRunner.test.ts`

**Steps:**
1. Add a function `runSolverBenchmarkCase(benchmarkCase, options)`.
2. Load the fixture JSON and parse it with `plantSchema`.
3. Call existing `runLocalSolve(plant, { strategy, timeLimitSeconds, workers, pythonBinary })`.
4. Measure elapsed wall-clock time with `performance.now()`.
5. Convert the solver result into `SolverBenchmarkResult`.
6. Add tests using `strategy: 'mock'` so tests do not need OR-Tools.
7. Run:
   ```bash
   npx vitest run test/benchmarkRunner.test.ts
   npm run typecheck
   ```

**Expected:** benchmark logic works with the mock strategy and can be reused by the CLI.

---

## Task 4: Add CLI script for benchmark execution

**Objective:** Let Ventura run one command to benchmark ForgePlan locally.

**Files:**
- Create: `scripts/forgeplan-benchmark.mjs`
- Modify: `package.json`
- Test: `test/forgeplanBenchmarkCli.test.ts`

**Steps:**
1. Add package script:
   ```json
   "benchmark": "node scripts/forgeplan-benchmark.mjs"
   ```
2. CLI defaults:
   - strategy: `mock`
   - fixtures: all files under `fixtures/benchmarks/*.json`
   - output JSON: `reports/solver-benchmark/latest.json`
   - output Markdown: `reports/solver-benchmark/latest.md`
3. Add options:
   ```text
   --strategy mock|cp_sat
   --time-limit 10
   --workers 2
   --python /path/to/python
   --fixture fixtures/benchmarks/pfg-small.json
   ```
4. Build before running the CLI in tests if needed.
5. Add a CLI test that runs mock benchmark and asserts JSON output exists and contains at least one result.
6. Run:
   ```bash
   npm run build
   npx vitest run test/forgeplanBenchmarkCli.test.ts
   ```

**Expected:** `npm run benchmark -- --strategy mock` produces repeatable local reports.

---

## Task 5: Add Markdown report renderer

**Objective:** Make benchmark output readable for product/industrial validation, not only machine-readable.

**Files:**
- Create: `src/solver/benchmarkReport.ts`
- Test: `test/benchmarkReport.test.ts`

**Steps:**
1. Add `renderBenchmarkMarkdown(report: SolverBenchmarkReport): string`.
2. Include:
   - generated timestamp;
   - each case id;
   - strategy;
   - status;
   - operation count;
   - late orders;
   - total tardiness;
   - makespan;
   - elapsed milliseconds;
   - issue codes.
3. Avoid Markdown tables because Telegram/Obsidian mobile can be less readable; use bullets.
4. Add snapshot-like assertions for a sample report.
5. Run:
   ```bash
   npx vitest run test/benchmarkReport.test.ts
   npm run typecheck
   ```

**Expected:** the benchmark output can be pasted directly into Obsidian or Telegram.

---

## Task 6: Add optional real CP-SAT benchmark smoke

**Objective:** Exercise real OR-Tools only when available, without making normal tests fragile.

**Files:**
- Modify: `test/benchmarkRunner.test.ts`
- Modify: `docs/solver-pfg-cpsat-v2.md`

**Steps:**
1. Add a test guarded by `process.env.FORGEPLAN_TEST_PYTHON_BINARY`.
2. If the env var is missing or OR-Tools unavailable, assert the skip path clearly.
3. If available, run `pfg-small.json` with `strategy: 'cp_sat'`, `timeLimitSeconds: 10`, `workers: 2`.
4. Assert:
   - result status is `optimal` or `feasible`;
   - operation count is greater than zero;
   - schedule strategy is `cp_sat`.
5. Document command:
   ```bash
   FORGEPLAN_TEST_PYTHON_BINARY=/tmp/forgeplan-ortools-venv/bin/python \
     npm run benchmark -- --strategy cp_sat --time-limit 10 --workers 2
   ```

**Expected:** real-solver benchmarking is available locally but not required for CI/basic development.

---

## Task 7: Update docs and README next phase

**Objective:** Make the roadmap explicit and avoid overselling solver maturity.

**Files:**
- Modify: `README.md`
- Modify: `docs/solver-pfg-cpsat-v2.md`
- Create or modify: `docs/solver-benchmarking.md`

**Steps:**
1. Add benchmark command usage.
2. State that Phase 7.1 is an evidence loop before decomposition/warm-starts/calendars.
3. Explain supported vs deferred constraints.
4. Link generated reports under `reports/solver-benchmark/`.
5. Run:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run build:web
   ```

**Expected:** a new contributor or future agent understands the next solver-hardening path.

---

## Full verification

Run:

```bash
npm run typecheck
npm test
npm run build
npm run build:web
npm run benchmark -- --strategy mock
```

If OR-Tools is available:

```bash
FORGEPLAN_TEST_PYTHON_BINARY=/tmp/forgeplan-ortools-venv/bin/python \
  npm run benchmark -- --strategy cp_sat --time-limit 10 --workers 2
```

Because this repo uses Graphify, after modifying code files run:

```bash
graphify update .
git diff --check
```

Then commit:

```bash
git add .
git commit -m "feat: add PFG solver benchmark evidence loop"
```

---

## Acceptance criteria

- `fixtures/benchmarks/` contains at least three valid PFG benchmark fixtures.
- `npm run benchmark -- --strategy mock` writes JSON and Markdown reports.
- Benchmark runner has unit tests that do not require OR-Tools.
- Optional CP-SAT benchmark smoke works when a Python binary with OR-Tools is provided.
- README and solver docs explain how to use the evidence loop.
- Existing quality gates pass.
- Graphify is updated after code changes.

---

## Recommended agent assignment

For the activated Black Tower profiles:

- `seldon-ceo`: keep scope limited to Phase 7.1; reject feature creep.
- `daneel-cto`: implement benchmark runner, CLI and safe Node/Python boundaries.
- `columbo-qa`: review tests, edge cases and benchmark reliability.
- `lyra-research`: compare benchmark metrics against the OptiPlan/PFG notes.
- `valentine-product`: ensure report language is understandable to planners.
- `jeeves-ops`: update docs, commands and repeatable operating procedure.

Do not involve the whole organization yet. This is a focused technical sprint.
