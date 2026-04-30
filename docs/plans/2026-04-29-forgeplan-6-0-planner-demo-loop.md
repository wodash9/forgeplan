# ForgePlan 6.0 Planner Demo Loop Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the current technical demo into a planner-facing local production planning demo: visible orders, clear planning action, and understandable solve feedback.

**Architecture:** Keep this as a small React/UI slice on top of the existing domain model and mock solver. Do not introduce HTTP APIs, cloud, auth, Electron, or advanced solver constraints. The current canonical `Plant` remains the source of truth.

**Tech Stack:** TypeScript, React 19, Vite, @xyflow/react, Vitest, Testing Library.

---

## Scope

Build only Fase 6.0 from the roadmap:

- Change UI copy from generic visual editor to local production planning.
- Add a visible “Pedidos a planificar” panel.
- Let the user edit demo order fields already present in the domain model.
- Rename “Run mock solve” to “Planificar pedidos”.
- Show “solver demo” clearly while using `MockSolverAdapter`.
- Add a post-solve explanation block: late orders, likely bottleneck, and next action.
- Add/adjust tests for the planner-facing flow.

## Non-goals

Do not implement yet:

- CP-SAT from the browser UI.
- SQLite persistence from UI.
- CSV/Excel import.
- API HTTP.
- advanced industrial constraints.
- cloud/network/auth.

---

## Task 1: Update planner-facing copy

**Objective:** Make the app immediately communicate the planning value proposition.

**Files:**
- Modify: `src/app/App.tsx`
- Test: `test/app.test.tsx`

**Steps:**
1. Change the main title to `Planificación local de producción`.
2. Change the subtitle to mention plant, orders, bottlenecks, and local/offline privacy.
3. Update tests that assert old text.
4. Run:
   ```bash
   npm test -- test/app.test.tsx
   npm run typecheck
   ```

**Expected:** tests and typecheck pass.

---

## Task 2: Add visible orders panel

**Objective:** Show the planner what demand is being scheduled.

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`
- Test: `test/app.test.tsx`

**Steps:**
1. Add a section titled `Pedidos a planificar`.
2. Render current `plant.orders`.
3. For each order show material, quantity, due time, earliest start, and priority.
4. Keep layout simple; do not add new dependencies.
5. Add a test that checks the panel renders at least one demo order.
6. Run:
   ```bash
   npm test -- test/app.test.tsx
   npm run typecheck
   ```

**Expected:** user can see demo orders without opening developer tools.

---

## Task 3: Make demo orders editable

**Objective:** Let the user perform basic what-if planning by editing orders.

**Files:**
- Modify: `src/app/App.tsx`
- Test: `test/app.test.tsx`

**Steps:**
1. Add controlled inputs for `quantity`, `dueTime`, and `priority`.
2. Update `plant.orders` immutably.
3. Clear the current schedule when an order changes.
4. Guard numeric fields with simple minimum values.
5. Add a test with Testing Library/user-event that edits an order quantity and confirms the UI updates.
6. Run:
   ```bash
   npm test -- test/app.test.tsx
   npm run typecheck
   ```

**Expected:** editing a demo order is visible and does not break solve flow.

---

## Task 4: Rename solve action and label mock mode honestly

**Objective:** Make the primary action understandable and avoid overselling optimization.

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`
- Test: `test/app.test.tsx`

**Steps:**
1. Rename button from `Run mock solve` to `Planificar pedidos`.
2. Add a small badge/copy near the button: `Solver demo` or `modo demo`.
3. Keep using `mockSolverAdapter`.
4. Update tests.
5. Run:
   ```bash
   npm test -- test/app.test.tsx
   npm run typecheck
   ```

**Expected:** UI is honest: planning action is clear, solver demo status is visible.

---

## Task 5: Add post-solve explanation block

**Objective:** Translate solver output into planner language.

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`
- Test: `test/app.test.tsx`

**Steps:**
1. Add a section titled `Qué ha pasado` inside/near `SolvePanel` after a schedule exists.
2. Show:
   - number of late orders;
   - total tardiness;
   - makespan;
   - a simple “next thing to try”.
3. Compute a simple likely bottleneck from scheduled operations grouped by `nodeId` using total busy time.
4. If no operations exist, show a fallback explanation.
5. Add tests that click `Planificar pedidos` and assert the explanation section appears.
6. Run:
   ```bash
   npm test -- test/app.test.tsx
   npm run typecheck
   ```

**Expected:** after solving, the user sees an explanation, not only raw operations.

---

## Task 6: Full verification

**Objective:** Prove the slice is safe to continue from.

**Files:**
- No new files required.

**Steps:**
1. Run:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run build:web
   ```
2. Check git diff:
   ```bash
   git diff -- src/app/App.tsx src/app/styles.css test/app.test.tsx
   ```
3. Update README only if user-facing command/copy changed materially.

**Expected:** all verification commands pass.

---

## Acceptance criteria

- The app title and copy frame ForgePlan as a local production planning tool.
- A planner can see orders without explanation.
- Demo order quantity/due time/priority are editable.
- The primary button says `Planificar pedidos`.
- Mock mode is labelled honestly.
- After solving, the UI explains outcome and likely bottleneck in plain language.
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:web` pass.
