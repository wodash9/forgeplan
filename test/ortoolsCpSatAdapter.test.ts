import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSolverModel, createScenario, plantSchema } from '../src/index.js';
import { createDemoPlant } from '../src/app/demoPlant.js';
import { OrToolsCpSatAdapter } from '../src/solver/node.js';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8'));
}

describe('OR-Tools CP-SAT adapter', () => {
  it('reports availability without throwing', () => {
    const adapter = new OrToolsCpSatAdapter();
    const availability = adapter.checkAvailability();

    expect(availability.pythonBinary).toBe('python3');
    expect(typeof availability.available).toBe('boolean');
    if (!availability.available) {
      expect(availability.error).toBeTruthy();
    }
  });

  it('returns an explicit error schedule when Python/OR-Tools is unavailable', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);
    const model = buildSolverModel(plant, scenario);
    const adapter = new OrToolsCpSatAdapter({ pythonBinary: 'python3-does-not-exist-for-forgeplan-test' });

    const result = adapter.solve(model, { timeLimitSeconds: 1 });

    expect(result.status).toBe('error');
    expect(result.schedule.status).toBe('error');
    expect(result.issues[0]?.code).toBe('ortools.process_error');
  });

  it('solves the minimal fixture when OR-Tools is installed locally', () => {
    const adapter = new OrToolsCpSatAdapter();
    const availability = adapter.checkAvailability();
    if (!availability.available) {
      expect(availability.error).toBeTruthy();
      return;
    }

    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant, { solverSettings: { strategy: 'cp_sat', timeLimitSeconds: 5, workers: 1 } });
    const model = buildSolverModel(plant, scenario);

    const result = adapter.solve(model, { timeLimitSeconds: 5 });

    expect(['optimal', 'feasible']).toContain(result.status);
    expect(result.schedule.strategy).toBe('cp_sat');
    expect(result.schedule.operations).toHaveLength(1);
    expect(result.schedule.operations[0]).toMatchObject({ orderId: 'order_1', nodeId: 'node_mixer', start: 0, end: 30 });
  });

  it('solves the PFG default plant with documented batching, silos, granulation, final storage and dispatch constraints', () => {
    const pythonBinary = process.env.FORGEPLAN_TEST_PYTHON_BINARY;
    const adapter = new OrToolsCpSatAdapter({ pythonBinary });
    const availability = adapter.checkAvailability();
    if (!availability.available) {
      expect(availability.error).toBeTruthy();
      return;
    }

    const plant = createDemoPlant();
    const scenario = createScenario(plant, { solverSettings: { strategy: 'cp_sat', timeLimitSeconds: 10, workers: 2 } });
    const model = buildSolverModel(plant, scenario, { objective: 'minimize_total_tardiness' });

    const result = adapter.solve(model, { timeLimitSeconds: 10, workers: 2 });
    const nodeIds = new Set(result.schedule.operations.map((operation) => operation.nodeId));

    const nodeIdList = Array.from(nodeIds);

    expect(['optimal', 'feasible']).toContain(result.status);
    expect(result.schedule.strategy).toBe('cp_sat');
    expect(nodeIds.has('node_dosing_line')).toBe(true);
    expect(nodeIdList.some((nodeId) => nodeId.startsWith('node_intermediate_silo_'))).toBe(true);
    expect(nodeIdList.some((nodeId) => nodeId.startsWith('node_granulation_line_'))).toBe(true);
    expect(nodeIdList.some((nodeId) => nodeId.startsWith('node_final_silo_'))).toBe(true);
    expect(nodeIdList.some((nodeId) => nodeId.startsWith('node_expedition_line_'))).toBe(true);
    expect(result.schedule.explanations.join(' ')).toContain('batch splitting');
    expect(result.schedule.explanations.join(' ')).toContain('silo assignment');
    expect(result.schedule.explanations.join(' ')).toContain('inventory reservoirs');
    expect(result.schedule.violations).toEqual([]);
  });
});
