import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildSolverModel,
  createScenario,
  mockSolverAdapter,
  plantSchema,
  validateSolverModel,
  type SolverModel,
} from '../src/index.js';
import { createDemoPlant } from '../src/app/demoPlant.js';
import { OrToolsCpSatAdapter } from '../src/solver/node.js';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8'));
}

describe('ForgePlan solver IR', () => {
  it('builds a solver model from the minimal plant fixture', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario);

    expect(model.plantId).toBe(plant.id);
    expect(model.scenarioId).toBe(scenario.id);
    expect(model.horizon).toBe(480);
    expect(model.resources).toHaveLength(1);
    expect(model.resources[0]).toMatchObject({ nodeId: 'node_mixer', capacity: 100, productionMode: 'batch' });
    expect(model.operations).toHaveLength(1);
    expect(model.operations[0]).toMatchObject({ orderId: 'order_1', nodeId: 'node_mixer', duration: 30, quantity: 80 });
    expect(model.objective).toBe('minimize_makespan');
  });

  it('validates missing resources and operations', () => {
    const model: SolverModel = {
      id: 'solver_model_invalid',
      plantId: 'plant_invalid',
      scenarioId: 'scenario_invalid',
      horizon: 480,
      timeUnit: 'minute',
      resources: [],
      operations: [],
      precedences: [],
      orders: [],
      objective: 'minimize_makespan',
    };

    const result = validateSolverModel(model);
    const codes = result.issues.map((issue) => issue.code);

    expect(result.valid).toBe(false);
    expect(codes).toContain('solver.no_resources');
    expect(codes).toContain('solver.no_operations');
  });

  it('solves the fixture with a deterministic feasible mock schedule', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario);

    const result = mockSolverAdapter.solve(model);

    expect(result.status).toBe('feasible');
    expect(result.schedule.status).toBe('feasible');
    expect(result.schedule.operations).toHaveLength(1);
    expect(result.schedule.operations[0]).toMatchObject({
      orderId: 'order_1',
      nodeId: 'node_mixer',
      start: 0,
      end: 30,
      quantity: 80,
    });
    expect(result.schedule.kpis.makespan).toBe(30);
    expect(result.schedule.violations).toEqual([]);
  });

  it('returns infeasible when the mock schedule exceeds the horizon', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);
    const model = { ...buildSolverModel(plant, scenario), horizon: 10 };

    const result = mockSolverAdapter.solve(model);

    expect(result.status).toBe('infeasible');
    expect(result.schedule.status).toBe('infeasible');
    expect(result.schedule.violations[0]).toContain('exceeds horizon');
  });

  it('builds a PFG constraint model from the default plant documented in Obsidian', () => {
    const plant = createDemoPlant();
    const scenario = createScenario(plant, { solverSettings: { strategy: 'cp_sat', timeLimitSeconds: 30, workers: 2 } });
    const model = buildSolverModel(plant, scenario, { objective: 'minimize_total_tardiness' });

    expect(model.pfgFlow).toBeDefined();
    expect(model.pfgFlow?.dosingLevels).toBe(5);
    expect(model.pfgFlow?.batchSize).toBe(120);
    expect(model.pfgFlow?.intermediateSilos).toHaveLength(4);
    expect(model.pfgFlow?.granulators).toHaveLength(2);
    expect(model.pfgFlow?.finalSilos).toHaveLength(3);
    expect(model.pfgFlow?.dispatchLines).toHaveLength(2);
    expect(model.pfgFlow?.batches.map((batch) => batch.orderId)).toEqual(['order_1', 'order_2']);
    expect(model.pfgFlow?.dosingLineToIntermediateSilos).toHaveLength(4);
    expect(model.pfgFlow?.constraintCoverage).toEqual([
      'batch_splitting',
      'dosing_phase_precedence',
      'dosing_level_no_overlap',
      'within_order_batch_symmetry',
      'dosing_changeover',
      'intermediate_silo_assignment',
      'intermediate_silo_no_mixing',
      'intermediate_inventory_reservoir',
      'granulator_assignment',
      'granulator_no_overlap',
      'granulator_changeover',
      'final_silo_assignment',
      'final_silo_no_mixing',
      'final_inventory_reservoir',
      'dispatch_assignment',
      'dispatch_no_overlap',
      'dispatch_changeover',
      'tardiness_late_orders_makespan',
      'on_time_implication_cuts',
      'due_date_capacity_cuts',
      'restricted_due_dominance',
    ]);
  });

  it('keeps direct dosing-to-intermediate transport arcs in the PFG model', () => {
    const plant = {
      ...createDemoPlant(),
      connections: createDemoPlant().connections.filter((connection) => connection.id !== 'conn_ld_si4'),
    };
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario, { objective: 'minimize_total_tardiness' });

    expect(model.pfgFlow?.dosingLineToIntermediateSilos).toHaveLength(3);
    expect(model.pfgFlow?.dosingLineToIntermediateSilos.map((connection) => connection.targetNodeId)).not.toContain('node_intermediate_silo_4');
  });

  it('splits PFG orders into dosing batches using the documented batch-size constraint', () => {
    const plant = { ...createDemoPlant(), orders: [{ ...createDemoPlant().orders[0]!, quantity: 250, minStartQuantity: 130 }] };
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario, { objective: 'minimize_total_tardiness' });

    expect(model.pfgFlow?.batches).toEqual([
      { id: 'batch_order_1_1', orderId: 'order_1', materialId: 'mat_feed', index: 1, quantity: 120 },
      { id: 'batch_order_1_2', orderId: 'order_1', materialId: 'mat_feed', index: 2, quantity: 120 },
      { id: 'batch_order_1_3', orderId: 'order_1', materialId: 'mat_feed', index: 3, quantity: 10 },
    ]);
    expect(model.pfgFlow?.orderRequirements[0]).toMatchObject({ orderId: 'order_1', minStartQuantity: 130 });
  });

  it('passes CP-SAT runtime options to the local Python worker boundary', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario, { objective: 'minimize_total_tardiness' });
    const tempDir = mkdtempSync(join(tmpdir(), 'forgeplan-fake-python-'));
    const capturePath = join(tempDir, 'payload.json');
    const fakePython = join(tempDir, 'fake-python.mjs');
    writeFileSync(fakePython, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
writeFileSync(${JSON.stringify(capturePath)}, input);
const payload = JSON.parse(input);
const op = payload.model.operations[0];
process.stdout.write(JSON.stringify({
  status: 'optimal',
  operations: [{ id: 'scheduled_' + op.id, orderId: op.orderId, nodeId: op.nodeId, materialId: op.materialId, start: 0, end: op.duration, quantity: op.quantity }],
  kpis: { lateOrders: 0, totalTardiness: 0, makespan: op.duration },
  violations: [],
  explanations: ['fake cp-sat worker']
}));
`);
    chmodSync(fakePython, 0o755);

    const result = new OrToolsCpSatAdapter({ pythonBinary: fakePython }).solve(model, { timeLimitSeconds: 9, workers: 3 });
    const captured = JSON.parse(readFileSync(capturePath, 'utf8')) as { model: SolverModel; options: { timeLimitSeconds: number; workers: number } };

    expect(result.status).toBe('optimal');
    expect(result.schedule.strategy).toBe('cp_sat');
    expect(captured.model.objective).toBe('minimize_total_tardiness');
    expect(captured.options).toEqual({ timeLimitSeconds: 9, workers: 3 });
  });
});
