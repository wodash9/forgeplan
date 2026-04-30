import { spawnSync } from 'node:child_process';

import type { Schedule, ScheduledOperation } from '../domain/types.js';
import type { SolverAdapter, SolverIssue, SolverModel, SolverOptions, SolverResult } from './types.js';
import { validateSolverModel } from './validateSolverModel.js';

export interface OrToolsCpSatAdapterOptions {
  pythonBinary?: string | undefined;
}

export interface OrToolsAvailability {
  available: boolean;
  pythonBinary: string;
  version?: string | undefined;
  error?: string | undefined;
}

interface OrToolsWorkerResponse {
  status: Schedule['status'];
  operations: ScheduledOperation[];
  kpis: Schedule['kpis'];
  violations: string[];
  explanations: string[];
  error?: string | undefined;
}

export class OrToolsCpSatAdapter implements SolverAdapter {
  readonly name = 'ortools-cp-sat';
  readonly pythonBinary: string;

  constructor(options: OrToolsCpSatAdapterOptions = {}) {
    this.pythonBinary = options.pythonBinary ?? 'python3';
  }

  checkAvailability(): OrToolsAvailability {
    const check = spawnSync(
      this.pythonBinary,
      ['-c', "import ortools; print(getattr(ortools, '__version__', 'unknown'))"],
      { encoding: 'utf8', timeout: 5_000 },
    );

    if (check.error) {
      return { available: false, pythonBinary: this.pythonBinary, error: check.error.message };
    }
    if (check.status !== 0) {
      return { available: false, pythonBinary: this.pythonBinary, error: (check.stderr || check.stdout || 'OR-Tools import failed.').trim() };
    }

    return { available: true, pythonBinary: this.pythonBinary, version: check.stdout.trim() };
  }

  solve(model: SolverModel, options: SolverOptions = {}): SolverResult {
    const validation = validateSolverModel(model);
    if (!validation.valid) {
      return {
        status: 'error',
        issues: validation.issues,
        schedule: emptySchedule(model, 'error', validation.issues.map((issue) => issue.message)),
      };
    }

    const payload = JSON.stringify({
      model,
      options: {
        timeLimitSeconds: options.timeLimitSeconds ?? 10,
        workers: options.workers ?? 1,
      },
    });
    const run = spawnSync(this.pythonBinary, ['-c', ORTOOLS_CP_SAT_WORKER], {
      input: payload,
      encoding: 'utf8',
      timeout: Math.max(1_000, (options.timeLimitSeconds ?? 10) * 1_000 + 5_000),
      maxBuffer: 1024 * 1024,
    });

    if (run.error) {
      return adapterError(model, [{ severity: 'error', code: 'ortools.process_error', message: run.error.message }]);
    }
    if (run.status !== 0) {
      const message = (run.stderr || run.stdout || 'OR-Tools CP-SAT worker failed.').trim();
      return adapterError(model, [{ severity: 'error', code: 'ortools.worker_failed', message }]);
    }

    let response: OrToolsWorkerResponse;
    try {
      response = JSON.parse(run.stdout) as OrToolsWorkerResponse;
    } catch (error) {
      return adapterError(model, [
        {
          severity: 'error',
          code: 'ortools.invalid_response',
          message: `OR-Tools worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }

    if (response.error) {
      return adapterError(model, [{ severity: 'error', code: 'ortools.worker_error', message: response.error }]);
    }

    return {
      status: response.status,
      issues: [],
      schedule: {
        id: `schedule_${model.id}_ortools_cp_sat`,
        plantId: model.plantId,
        scenarioId: model.scenarioId,
        status: response.status,
        strategy: 'cp_sat',
        operations: response.operations,
        kpis: response.kpis,
        violations: response.violations,
        explanations: response.explanations,
      },
    };
  }
}

export const orToolsCpSatAdapter = new OrToolsCpSatAdapter();

function adapterError(model: SolverModel, issues: SolverIssue[]): SolverResult {
  return {
    status: 'error',
    issues,
    schedule: emptySchedule(model, 'error', issues.map((issue) => issue.message)),
  };
}

function emptySchedule(model: SolverModel, status: Schedule['status'], violations: string[]): Schedule {
  return {
    id: `schedule_${model.id}_ortools_cp_sat`,
    plantId: model.plantId,
    scenarioId: model.scenarioId,
    status,
    strategy: 'cp_sat',
    operations: [],
    kpis: { lateOrders: 0, totalTardiness: 0, makespan: 0 },
    violations,
    explanations: ['OR-Tools CP-SAT adapter did not produce a schedule.'],
  };
}

const ORTOOLS_CP_SAT_WORKER = String.raw`
import json
import sys

try:
    from ortools.sat.python import cp_model
except Exception as exc:
    print(json.dumps({"status": "error", "operations": [], "kpis": {"lateOrders": 0, "totalTardiness": 0, "makespan": 0}, "violations": [str(exc)], "explanations": [], "error": "OR-Tools is not installed or could not be imported: " + str(exc)}))
    sys.exit(0)

payload = json.load(sys.stdin)
model_data = payload["model"]
options = payload.get("options", {})
time_limit_seconds = float(options.get("timeLimitSeconds", 10))
workers = max(1, int(options.get("workers", 1)))

model = cp_model.CpModel()
horizon = int(model_data["horizon"])
operations = model_data.get("operations", [])
precedences = model_data.get("precedences", [])
orders = {order["id"]: order for order in model_data.get("orders", [])}

start_vars = {}
end_vars = {}
intervals_by_resource = {}

for op in operations:
    duration = int(op["duration"])
    start = model.NewIntVar(0, horizon, "start_" + op["id"])
    end = model.NewIntVar(0, horizon, "end_" + op["id"])
    interval = model.NewIntervalVar(start, duration, end, "interval_" + op["id"])
    start_vars[op["id"]] = start
    end_vars[op["id"]] = end
    intervals_by_resource.setdefault(op["resourceId"], []).append(interval)

    order = orders.get(op["orderId"])
    if order is not None:
        model.Add(start >= int(order.get("earliestStart", 0)))

for resource_id, intervals in intervals_by_resource.items():
    model.AddNoOverlap(intervals)

for precedence in precedences:
    before = precedence["beforeOperationId"]
    after = precedence["afterOperationId"]
    if before in end_vars and after in start_vars:
        model.Add(start_vars[after] >= end_vars[before])

makespan = model.NewIntVar(0, horizon, "makespan")
if operations:
    model.AddMaxEquality(makespan, [end_vars[op["id"]] for op in operations])
else:
    model.Add(makespan == 0)

completion_vars = {}
tardiness_vars = []
late_vars = []
for order_id, order in orders.items():
    order_end_vars = [end_vars[op["id"]] for op in operations if op["orderId"] == order_id]
    completion = model.NewIntVar(0, horizon, "completion_" + order_id)
    if order_end_vars:
        model.AddMaxEquality(completion, order_end_vars)
    else:
        model.Add(completion == 0)
    completion_vars[order_id] = completion
    due_time = int(order["dueTime"])
    tardiness = model.NewIntVar(0, horizon, "tardiness_" + order_id)
    model.Add(tardiness >= completion - due_time)
    model.Add(tardiness >= 0)
    late = model.NewBoolVar("late_" + order_id)
    model.Add(completion >= due_time + 1).OnlyEnforceIf(late)
    model.Add(completion <= due_time).OnlyEnforceIf(late.Not())
    tardiness_vars.append(tardiness)
    late_vars.append(late)

if model_data.get("objective") == "minimize_total_tardiness":
    # First CP-SAT integration mirrors the thesis/OptiPlan lexicographic intent with
    # a stable weighted objective: avoid late orders first, then reduce tardiness,
    # then compact makespan. Full multi-pass lexicographic optimization can build on this.
    model.Minimize(sum(late_vars) * max(1, horizon * 1000) + sum(tardiness_vars) * 100 + makespan)
else:
    model.Minimize(makespan)

solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = time_limit_seconds
solver.parameters.num_search_workers = workers
status = solver.Solve(model)

status_map = {
    cp_model.OPTIMAL: "optimal",
    cp_model.FEASIBLE: "feasible",
    cp_model.INFEASIBLE: "infeasible",
    cp_model.MODEL_INVALID: "error",
    cp_model.UNKNOWN: "unknown",
}
status_name = status_map.get(status, "unknown")

scheduled = []
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    for op in operations:
        start = int(solver.Value(start_vars[op["id"]]))
        end = int(solver.Value(end_vars[op["id"]]))
        scheduled.append({
            "id": "scheduled_" + op["id"],
            "orderId": op["orderId"],
            "nodeId": op["nodeId"],
            "materialId": op["materialId"],
            "start": start,
            "end": end,
            "quantity": op["quantity"],
        })

actual_makespan = max([op["end"] for op in scheduled], default=0)
late_orders = 0
total_tardiness = 0
for order_id, order in orders.items():
    completion = max([op["end"] for op in scheduled if op["orderId"] == order_id], default=0)
    tardiness = max(0, completion - int(order["dueTime"]))
    if tardiness > 0:
        late_orders += 1
    total_tardiness += tardiness

violations = []
if status_name == "infeasible":
    violations.append("CP-SAT proved the model infeasible within the configured horizon.")
elif status_name == "unknown":
    violations.append("CP-SAT stopped before proving feasibility or infeasibility.")
elif status_name == "error":
    violations.append("CP-SAT rejected the model.")

print(json.dumps({
    "status": status_name,
    "operations": scheduled,
    "kpis": {
        "lateOrders": late_orders,
        "totalTardiness": total_tardiness,
        "makespan": actual_makespan,
    },
    "violations": violations,
    "explanations": [
        "Solved locally with Google OR-Tools CP-SAT via the ForgePlan Solver IR.",
        "This first adapter supports fixed-resource operations, no-overlap, route precedences, earliest starts, horizon, due-date tardiness KPIs, and weighted late/tardiness/makespan optimization.",
        "V1 covers the PFG/OptiPlan core sequencing layer; silo assignment, inventory reservoirs, batching splits, and sequence-dependent cleanings are documented as next solver-model layers.",
    ],
}))
`;
