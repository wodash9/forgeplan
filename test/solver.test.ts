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
