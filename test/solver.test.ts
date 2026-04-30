import { readFileSync } from 'node:fs';
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
});
