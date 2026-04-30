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

pfg_flow = model_data.get("pfgFlow")
if pfg_flow:
    def compatible(resource, material_id):
        materials = resource.get("compatibleMaterials") or []
        return not materials or material_id in materials

    def by_node(items):
        return {item["nodeId"]: item for item in items}

    def connection_map(items):
        return {(item["sourceNodeId"], item["targetNodeId"]): int(item.get("transportTime", 0)) for item in items}

    def conjunction_var(model, left, right, name):
        both = model.NewBoolVar(name)
        model.AddBoolAnd([left, right]).OnlyEnforceIf(both)
        model.AddBoolOr([left.Not(), right.Not(), both])
        return both

    def processing_duration(order_req, resource):
        quantity = int(order_req["quantity"])
        capacity = max(1, int(resource.get("capacity", 1)))
        base = max(1, int(resource.get("processingTime", 1)))
        return max(1, (quantity * base + capacity - 1) // capacity)

    def selected_resource(resource_list, assignment, order_id, solver):
        for resource in resource_list:
            if solver.Value(assignment[(order_id, resource["nodeId"])]) == 1:
                return resource
        return resource_list[0]

    def add_pairwise_setup(model, order_ids, assignment, starts, ends, resource, setup_time):
        intervals_on_resource = []
        for order_id in order_ids:
            active = assignment[(order_id, resource["nodeId"])]
            intervals_on_resource.append(optional_intervals[(order_id, resource["nodeId"])])
        if intervals_on_resource:
            model.AddNoOverlap(intervals_on_resource)
        for left_index in range(len(order_ids)):
            for right_index in range(left_index + 1, len(order_ids)):
                left = order_ids[left_index]
                right = order_ids[right_index]
                both = model.NewBoolVar("both_%s_%s_%s" % (resource["nodeId"], left, right))
                model.AddBoolAnd([assignment[(left, resource["nodeId"])], assignment[(right, resource["nodeId"])]]).OnlyEnforceIf(both)
                model.AddBoolOr([assignment[(left, resource["nodeId"])].Not(), assignment[(right, resource["nodeId"])].Not(), both])
                before = model.NewBoolVar("before_%s_%s_%s" % (resource["nodeId"], left, right))
                material_left = orders[left]["materialId"]
                material_right = orders[right]["materialId"]
                setup_lr = int(setup_time if material_left != material_right else 0)
                setup_rl = int(setup_time if material_left != material_right else 0)
                model.Add(starts[right] >= ends[left] + setup_lr).OnlyEnforceIf([both, before])
                model.Add(starts[left] >= ends[right] + setup_rl).OnlyEnforceIf([both, before.Not()])

    model = cp_model.CpModel()
    horizon = int(model_data["horizon"])
    orders = {order["orderId"]: order for order in pfg_flow.get("orderRequirements", [])}
    order_ids = list(orders.keys())
    batches = pfg_flow.get("batches", [])
    batches_by_order = {order_id: [] for order_id in order_ids}
    for batch in batches:
        batches_by_order.setdefault(batch["orderId"], []).append(batch)
    for order_id in batches_by_order:
        batches_by_order[order_id].sort(key=lambda item: int(item["index"]))

    dosing = pfg_flow["dosingLine"]
    intermediate_silos = pfg_flow.get("intermediateSilos", [])
    granulators = pfg_flow.get("granulators", [])
    final_silos = pfg_flow.get("finalSilos", [])
    dispatch_lines = pfg_flow.get("dispatchLines", [])
    dosing_to_intermediate = connection_map(pfg_flow.get("dosingLineToIntermediateSilos", []))
    intermediate_to_granulators = connection_map(pfg_flow.get("intermediateToGranulators", []))
    granulator_to_final_silos = connection_map(pfg_flow.get("granulatorToFinalSilos", []))
    final_silo_to_dispatch = connection_map(pfg_flow.get("finalSiloToDispatchLines", []))
    dosing_levels = max(1, int(pfg_flow.get("dosingLevels", 1)))
    dosing_level_duration = max(1, (int(dosing.get("processingTime", 1)) + dosing_levels - 1) // dosing_levels)

    batch_start = {}
    batch_end = {}
    intervals_by_level = {level: [] for level in range(1, dosing_levels + 1)}
    for batch in batches:
        previous_end = None
        for level in range(1, dosing_levels + 1):
            key = (batch["id"], level)
            start = model.NewIntVar(0, horizon, "start_%s_l%s" % key)
            end = model.NewIntVar(0, horizon, "end_%s_l%s" % key)
            interval = model.NewIntervalVar(start, dosing_level_duration, end, "interval_%s_l%s" % key)
            batch_start[key] = start
            batch_end[key] = end
            intervals_by_level[level].append(interval)
            if previous_end is not None:
                model.Add(start >= previous_end)
            previous_end = end
    for intervals in intervals_by_level.values():
        model.AddNoOverlap(intervals)
    for order_id, order_batches in batches_by_order.items():
        for index in range(1, len(order_batches)):
            model.Add(batch_start[(order_batches[index - 1]["id"], 1)] <= batch_start[(order_batches[index]["id"], 1)])

    cleanout = int(pfg_flow.get("cleanoutTime", 0))
    for left_index in range(len(batches)):
        for right_index in range(left_index + 1, len(batches)):
            left = batches[left_index]
            right = batches[right_index]
            before = model.NewBoolVar("before_last_%s_%s" % (left["id"], right["id"]))
            setup_lr = cleanout if left["materialId"] != right["materialId"] else 0
            setup_rl = cleanout if left["materialId"] != right["materialId"] else 0
            model.Add(batch_start[(right["id"], dosing_levels)] >= batch_end[(left["id"], dosing_levels)] + setup_lr).OnlyEnforceIf(before)
            model.Add(batch_start[(left["id"], dosing_levels)] >= batch_end[(right["id"], dosing_levels)] + setup_rl).OnlyEnforceIf(before.Not())

    x_i = {}
    for order_id, order in orders.items():
        candidates = []
        for silo in intermediate_silos:
            lit = model.NewBoolVar("xI_%s_%s" % (order_id, silo["nodeId"]))
            x_i[(order_id, silo["nodeId"])] = lit
            feasible = compatible(silo, order["materialId"]) and int(silo["capacity"]) >= int(order["quantity"])
            feasible = feasible and (dosing["nodeId"], silo["nodeId"]) in dosing_to_intermediate
            feasible = feasible and any((silo["nodeId"], g["nodeId"]) in intermediate_to_granulators for g in granulators)
            if feasible:
                candidates.append(lit)
            else:
                model.Add(lit == 0)
        model.AddExactlyOne(candidates if candidates else [x_i[(order_id, intermediate_silos[0]["nodeId"])]])
    for silo in intermediate_silos:
        capacity = max(0, int(silo["capacity"]) - int(silo.get("initialQuantity", 0)))
        model.Add(sum(int(orders[o]["quantity"]) * x_i[(o, silo["nodeId"])] for o in order_ids) <= capacity)
        for left_index in range(len(order_ids)):
            for right_index in range(left_index + 1, len(order_ids)):
                left = order_ids[left_index]
                right = order_ids[right_index]
                if orders[left]["materialId"] != orders[right]["materialId"]:
                    model.Add(x_i[(left, silo["nodeId"])] + x_i[(right, silo["nodeId"])] <= 1)

    batch_avail = {}
    for batch in batches:
        order_id = batch["orderId"]
        avail = model.NewIntVar(0, horizon, "avail_%s" % batch["id"])
        transfer = sum(dosing_to_intermediate.get((dosing["nodeId"], s["nodeId"]), 0) * x_i[(order_id, s["nodeId"])] for s in intermediate_silos)
        model.Add(avail == batch_end[(batch["id"], dosing_levels)] + transfer)
        batch_avail[batch["id"]] = avail

    supply_ready = {}
    full_ready = {}
    for order_id, order_batches in batches_by_order.items():
        min_quantity = int(orders[order_id]["minStartQuantity"])
        cumulative = 0
        min_batch_vars = []
        for batch in order_batches:
            cumulative += int(batch["quantity"])
            min_batch_vars.append(batch_avail[batch["id"]])
            if cumulative >= min_quantity:
                break
        supply = model.NewIntVar(0, horizon, "supply_ready_%s" % order_id)
        full = model.NewIntVar(0, horizon, "full_ready_%s" % order_id)
        model.AddMaxEquality(supply, min_batch_vars or [model.NewConstant(0)])
        model.AddMaxEquality(full, [batch_avail[b["id"]] for b in order_batches] or [model.NewConstant(0)])
        supply_ready[order_id] = supply
        full_ready[order_id] = full

    x_g = {}
    gran_start = {}
    gran_end = {}
    optional_intervals = {}
    for order_id, order in orders.items():
        gran_start[order_id] = model.NewIntVar(0, horizon, "gran_start_%s" % order_id)
        gran_end[order_id] = model.NewIntVar(0, horizon, "gran_end_%s" % order_id)
        model.Add(gran_start[order_id] >= int(order.get("earliestStart", 0)))
        model.Add(gran_start[order_id] >= supply_ready[order_id])
        candidates = []
        for granulator in granulators:
            lit = model.NewBoolVar("xG_%s_%s" % (order_id, granulator["nodeId"]))
            x_g[(order_id, granulator["nodeId"])] = lit
            duration = processing_duration(order, granulator)
            optional_intervals[(order_id, granulator["nodeId"])] = model.NewOptionalIntervalVar(gran_start[order_id], duration, gran_end[order_id], lit, "gran_%s_%s" % (order_id, granulator["nodeId"]))
            if compatible(granulator, order["materialId"]):
                candidates.append(lit)
            else:
                model.Add(lit == 0)
            for silo in intermediate_silos:
                if (silo["nodeId"], granulator["nodeId"]) not in intermediate_to_granulators:
                    model.Add(x_i[(order_id, silo["nodeId"])] + lit <= 1)
        model.AddExactlyOne(candidates if candidates else [x_g[(order_id, granulators[0]["nodeId"])]])
        intermediate_transfer_terms = []
        for silo in intermediate_silos:
            for granulator in granulators:
                pair_time = intermediate_to_granulators.get((silo["nodeId"], granulator["nodeId"]))
                if pair_time is not None:
                    both = conjunction_var(model, x_i[(order_id, silo["nodeId"])], x_g[(order_id, granulator["nodeId"])], "xIG_%s_%s_%s" % (order_id, silo["nodeId"], granulator["nodeId"]))
                    intermediate_transfer_terms.append(pair_time * both)
        model.Add(gran_start[order_id] >= supply_ready[order_id] + sum(intermediate_transfer_terms))
    for granulator in granulators:
        add_pairwise_setup(model, order_ids, x_g, gran_start, gran_end, granulator, int(pfg_flow.get("granulatorSetupTime", 0)))

    for silo in intermediate_silos:
        times = []
        changes = []
        actives = []
        for batch in batches:
            times.append(batch_avail[batch["id"]])
            changes.append(int(batch["quantity"]))
            actives.append(x_i[(batch["orderId"], silo["nodeId"])])
        for order_id, order in orders.items():
            min_q = int(order["minStartQuantity"])
            rest_q = max(0, int(order["quantity"]) - min_q)
            times.append(gran_start[order_id])
            changes.append(-min_q)
            actives.append(x_i[(order_id, silo["nodeId"])])
            if rest_q > 0:
                times.append(gran_end[order_id])
                changes.append(-rest_q)
                actives.append(x_i[(order_id, silo["nodeId"])])
        if times:
            model.AddReservoirConstraintWithActive(times, changes, actives, -int(silo.get("initialQuantity", 0)), int(silo["capacity"]) - int(silo.get("initialQuantity", 0)))

    x_f = {}
    final_ready = {}
    for order_id, order in orders.items():
        final_ready[order_id] = model.NewIntVar(0, horizon, "final_ready_%s" % order_id)
        candidates = []
        for silo in final_silos:
            lit = model.NewBoolVar("xF_%s_%s" % (order_id, silo["nodeId"]))
            x_f[(order_id, silo["nodeId"])] = lit
            feasible = compatible(silo, order["materialId"]) and int(silo["capacity"]) >= int(order["quantity"])
            feasible = feasible and any((g["nodeId"], silo["nodeId"]) in granulator_to_final_silos for g in granulators)
            if feasible:
                candidates.append(lit)
            else:
                model.Add(lit == 0)
            for granulator in granulators:
                if (granulator["nodeId"], silo["nodeId"]) not in granulator_to_final_silos:
                    model.Add(x_g[(order_id, granulator["nodeId"])] + lit <= 1)
        model.AddExactlyOne(candidates if candidates else [x_f[(order_id, final_silos[0]["nodeId"])]])
        final_transfer_terms = []
        for granulator in granulators:
            for final_silo in final_silos:
                pair_time = granulator_to_final_silos.get((granulator["nodeId"], final_silo["nodeId"]))
                if pair_time is not None:
                    both = conjunction_var(model, x_g[(order_id, granulator["nodeId"])], x_f[(order_id, final_silo["nodeId"])], "xGF_%s_%s_%s" % (order_id, granulator["nodeId"], final_silo["nodeId"]))
                    final_transfer_terms.append(pair_time * both)
        model.Add(final_ready[order_id] == gran_end[order_id] + sum(final_transfer_terms))
    for silo in final_silos:
        capacity = max(0, int(silo["capacity"]) - int(silo.get("initialQuantity", 0)))
        model.Add(sum(int(orders[o]["quantity"]) * x_f[(o, silo["nodeId"])] for o in order_ids) <= capacity)
        for left_index in range(len(order_ids)):
            for right_index in range(left_index + 1, len(order_ids)):
                left = order_ids[left_index]
                right = order_ids[right_index]
                if orders[left]["materialId"] != orders[right]["materialId"]:
                    model.Add(x_f[(left, silo["nodeId"])] + x_f[(right, silo["nodeId"])] <= 1)

    x_d = {}
    dispatch_start = {}
    completion = {}
    dispatch_intervals = {}
    for order_id, order in orders.items():
        dispatch_start[order_id] = model.NewIntVar(0, horizon, "dispatch_start_%s" % order_id)
        completion[order_id] = model.NewIntVar(0, horizon, "completion_%s" % order_id)
        candidates = []
        for line in dispatch_lines:
            lit = model.NewBoolVar("xD_%s_%s" % (order_id, line["nodeId"]))
            x_d[(order_id, line["nodeId"])] = lit
            duration = processing_duration(order, line)
            dispatch_intervals[(order_id, line["nodeId"])] = model.NewOptionalIntervalVar(dispatch_start[order_id], duration, completion[order_id], lit, "dispatch_%s_%s" % (order_id, line["nodeId"]))
            if compatible(line, order["materialId"]):
                candidates.append(lit)
            else:
                model.Add(lit == 0)
            for silo in final_silos:
                if (silo["nodeId"], line["nodeId"]) not in final_silo_to_dispatch:
                    model.Add(x_f[(order_id, silo["nodeId"])] + lit <= 1)
        model.AddExactlyOne(candidates if candidates else [x_d[(order_id, dispatch_lines[0]["nodeId"])]])
        dispatch_transfer_terms = []
        for final_silo in final_silos:
            for line in dispatch_lines:
                pair_time = final_silo_to_dispatch.get((final_silo["nodeId"], line["nodeId"]))
                if pair_time is not None:
                    both = conjunction_var(model, x_f[(order_id, final_silo["nodeId"])], x_d[(order_id, line["nodeId"])], "xFD_%s_%s_%s" % (order_id, final_silo["nodeId"], line["nodeId"]))
                    dispatch_transfer_terms.append(pair_time * both)
        model.Add(dispatch_start[order_id] >= final_ready[order_id] + sum(dispatch_transfer_terms))
        model.Add(completion[order_id] == dispatch_start[order_id] + sum(processing_duration(order, line) * x_d[(order_id, line["nodeId"])] for line in dispatch_lines))
    optional_intervals = dispatch_intervals
    for line in dispatch_lines:
        add_pairwise_setup(model, order_ids, x_d, dispatch_start, completion, line, int(pfg_flow.get("dispatchSetupTime", 0)))

    for silo in final_silos:
        times = []
        changes = []
        actives = []
        for order_id, order in orders.items():
            times.append(final_ready[order_id])
            changes.append(int(order["quantity"]))
            actives.append(x_f[(order_id, silo["nodeId"])])
            times.append(dispatch_start[order_id])
            changes.append(-int(order["quantity"]))
            actives.append(x_f[(order_id, silo["nodeId"])])
        if times:
            model.AddReservoirConstraintWithActive(times, changes, actives, -int(silo.get("initialQuantity", 0)), int(silo["capacity"]) - int(silo.get("initialQuantity", 0)))

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, list(completion.values()) or [model.NewConstant(0)])
    tardiness_vars = []
    late_vars = []
    for order_id, order in orders.items():
        due = int(order["dueTime"])
        tard = model.NewIntVar(0, horizon, "tardiness_%s" % order_id)
        late = model.NewBoolVar("late_%s" % order_id)
        model.Add(tard >= completion[order_id] - due)
        model.Add(tard >= 0)
        model.Add(completion[order_id] >= due + 1).OnlyEnforceIf(late)
        model.Add(completion[order_id] <= due).OnlyEnforceIf(late.Not())
        min_gran = min(processing_duration(order, g) for g in granulators)
        min_load = min(processing_duration(order, d) for d in dispatch_lines)
        min_fill = min(granulator_to_final_silos.values()) if granulator_to_final_silos else 0
        model.Add(completion[order_id] >= supply_ready[order_id] + min_gran + min_fill + min_load)
        model.Add(completion[order_id] >= gran_end[order_id] + min_fill + min_load)
        model.Add(completion[order_id] >= final_ready[order_id] + min_load)
        model.Add(supply_ready[order_id] + min_gran + min_load <= due).OnlyEnforceIf(late.Not())
        model.Add(gran_end[order_id] + min_load <= due).OnlyEnforceIf(late.Not())
        model.Add(final_ready[order_id] + min_load <= due).OnlyEnforceIf(late.Not())
        model.Add(dispatch_start[order_id] + min_load <= due).OnlyEnforceIf(late.Not())
        for g in granulators:
            model.Add(gran_start[order_id] + processing_duration(order, g) + min_load <= due).OnlyEnforceIf([x_g[(order_id, g["nodeId"])], late.Not()])
        for f in final_silos:
            min_pair_fill = min([time for (source, target), time in granulator_to_final_silos.items() if target == f["nodeId"]], default=0)
            model.Add(gran_end[order_id] + min_pair_fill + min_load <= due).OnlyEnforceIf([x_f[(order_id, f["nodeId"])], late.Not()])
        for d in dispatch_lines:
            model.Add(dispatch_start[order_id] + processing_duration(order, d) <= due).OnlyEnforceIf([x_d[(order_id, d["nodeId"])], late.Not()])
        tardiness_vars.append(tard)
        late_vars.append(late)

    for due in sorted(set(int(order["dueTime"]) for order in orders.values())):
        due_orders = [order_id for order_id, order in orders.items() if int(order["dueTime"]) <= due]
        for level in range(1, dosing_levels + 1):
            model.Add(sum(dosing_level_duration * len(batches_by_order[o]) * late_vars[order_ids.index(o)].Not() for o in due_orders) <= due)
        model.Add(sum(min(processing_duration(orders[o], g) for g in granulators) * late_vars[order_ids.index(o)].Not() for o in due_orders) <= len(granulators) * due)
        model.Add(sum(min(processing_duration(orders[o], d) for d in dispatch_lines) * late_vars[order_ids.index(o)].Not() for o in due_orders) <= len(dispatch_lines) * due)

    sorted_orders = sorted(order_ids, key=lambda oid: (orders[oid]["materialId"], int(orders[oid]["quantity"]), int(orders[oid]["minStartQuantity"]), int(orders[oid]["dueTime"]), oid))
    for left_index in range(len(sorted_orders)):
        for right_index in range(left_index + 1, len(sorted_orders)):
            left = sorted_orders[left_index]
            right = sorted_orders[right_index]
            if (orders[left]["materialId"], int(orders[left]["quantity"]), int(orders[left]["minStartQuantity"]), int(orders[left].get("earliestStart", 0))) == (orders[right]["materialId"], int(orders[right]["quantity"]), int(orders[right]["minStartQuantity"]), int(orders[right].get("earliestStart", 0))) and int(orders[left]["dueTime"]) <= int(orders[right]["dueTime"]):
                model.Add(gran_start[left] <= gran_start[right])
                model.Add(dispatch_start[left] <= dispatch_start[right])
                model.Add(completion[left] <= completion[right])

    model.Minimize(sum(late_vars) * max(1, horizon * 1000) + sum(tardiness_vars) * 100 + makespan)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = workers
    status = solver.Solve(model)
    status_map = {cp_model.OPTIMAL: "optimal", cp_model.FEASIBLE: "feasible", cp_model.INFEASIBLE: "infeasible", cp_model.MODEL_INVALID: "error", cp_model.UNKNOWN: "unknown"}
    status_name = status_map.get(status, "unknown")

    scheduled = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for batch in batches:
            for level in range(1, dosing_levels + 1):
                scheduled.append({"id": "scheduled_%s_dosing_l%s" % (batch["id"], level), "orderId": batch["orderId"], "nodeId": dosing["nodeId"], "materialId": batch["materialId"], "start": int(solver.Value(batch_start[(batch["id"], level)])), "end": int(solver.Value(batch_end[(batch["id"], level)])), "quantity": batch["quantity"]})
            si = selected_resource(intermediate_silos, x_i, batch["orderId"], solver)
            scheduled.append({"id": "scheduled_%s_dump_%s" % (batch["id"], si["nodeId"]), "orderId": batch["orderId"], "nodeId": si["nodeId"], "materialId": batch["materialId"], "start": int(solver.Value(batch_end[(batch["id"], dosing_levels)])), "end": int(solver.Value(batch_avail[batch["id"]])), "quantity": batch["quantity"]})
        for order_id, order in orders.items():
            g = selected_resource(granulators, x_g, order_id, solver)
            f = selected_resource(final_silos, x_f, order_id, solver)
            d = selected_resource(dispatch_lines, x_d, order_id, solver)
            scheduled.append({"id": "scheduled_%s_granulation_%s" % (order_id, g["nodeId"]), "orderId": order_id, "nodeId": g["nodeId"], "materialId": order["materialId"], "start": int(solver.Value(gran_start[order_id])), "end": int(solver.Value(gran_end[order_id])), "quantity": order["quantity"]})
            scheduled.append({"id": "scheduled_%s_final_fill_%s" % (order_id, f["nodeId"]), "orderId": order_id, "nodeId": f["nodeId"], "materialId": order["materialId"], "start": int(solver.Value(gran_end[order_id])), "end": int(solver.Value(final_ready[order_id])), "quantity": order["quantity"]})
            scheduled.append({"id": "scheduled_%s_dispatch_%s" % (order_id, d["nodeId"]), "orderId": order_id, "nodeId": d["nodeId"], "materialId": order["materialId"], "start": int(solver.Value(dispatch_start[order_id])), "end": int(solver.Value(completion[order_id])), "quantity": order["quantity"]})
        scheduled.sort(key=lambda op: (op["start"], op["end"], op["id"]))

    actual_makespan = max([op["end"] for op in scheduled], default=0)
    late_orders = 0
    total_tardiness = 0
    for order_id, order in orders.items():
        comp = int(solver.Value(completion[order_id])) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0
        tard = max(0, comp - int(order["dueTime"]))
        if tard > 0:
            late_orders += 1
        total_tardiness += tard
    violations = []
    if status_name == "infeasible":
        violations.append("CP-SAT proved the PFG model infeasible within the configured horizon.")
    elif status_name == "unknown":
        violations.append("CP-SAT stopped before proving PFG feasibility or infeasibility.")
    elif status_name == "error":
        violations.append("CP-SAT rejected the PFG model.")
    print(json.dumps({"status": status_name, "operations": scheduled, "kpis": {"lateOrders": late_orders, "totalTardiness": total_tardiness, "makespan": actual_makespan}, "violations": violations, "explanations": ["Solved locally with Google OR-Tools CP-SAT using the PFG/OptiPlan constraint layer.", "The PFG layer covers batch splitting, multi-level dosing precedence/no-overlap, changeovers, silo assignment/no-mixing, inventory reservoirs, granulator and dispatch assignment/no-overlap/setup, due-date cuts, restricted due dominance, and weighted late/tardiness/makespan optimization.", "This first production solver uses event-based silo reservoirs and whole-order silo assignment, matching the documented Obsidian modeling assumptions."]}))
    sys.exit(0)

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
