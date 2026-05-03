import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createScenario, plantSchema, type SolverModel } from '../src/index.js';
import { createLocalSolverAdapter, runLocalSolve } from '../src/solver/node.js';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8'));
}

function createFakeCpSatPython() {
  const tempDir = mkdtempSync(join(tmpdir(), 'forgeplan-local-solve-fake-python-'));
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
  explanations: ['fake local cp-sat worker']
}));
`);
  chmodSync(fakePython, 0o755);
  return { fakePython, capturePath };
}

describe('local solve runner', () => {
  it('runs a local mock solve when mock is requested explicitly', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));

    const result = runLocalSolve(plant, { strategy: 'mock' });

    expect(result.status).toBe('feasible');
    expect(result.schedule.strategy).toBe('mock');
    expect(result.schedule.operations).toHaveLength(1);
  });

  it('defaults local solves to the real CP-SAT path without silently falling back to mock', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const { fakePython, capturePath } = createFakeCpSatPython();

    const result = runLocalSolve(plant, { pythonBinary: fakePython, timeLimitSeconds: 7, workers: 2 });
    const captured = JSON.parse(readFileSync(capturePath, 'utf8')) as { model: SolverModel; options: { timeLimitSeconds: number; workers: number } };

    expect(result.status).toBe('optimal');
    expect(result.schedule.strategy).toBe('cp_sat');
    expect(captured.model.objective).toBe('minimize_total_tardiness');
    expect(captured.options).toEqual({ timeLimitSeconds: 7, workers: 2 });
  });

  it('uses a scenario CP-SAT strategy when no explicit local solve strategy is provided', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant, { solverSettings: { strategy: 'cp_sat', timeLimitSeconds: 6, workers: 1 } });
    const { fakePython, capturePath } = createFakeCpSatPython();

    const result = runLocalSolve(plant, { scenario, pythonBinary: fakePython });
    const captured = JSON.parse(readFileSync(capturePath, 'utf8')) as { model: SolverModel; options: { timeLimitSeconds: number; workers: number } };

    expect(result.status).toBe('optimal');
    expect(result.schedule.strategy).toBe('cp_sat');
    expect(captured.options).toEqual({ timeLimitSeconds: 6, workers: 1 });
  });

  it('creates the requested local adapter', () => {
    expect(createLocalSolverAdapter('mock').name).toBe('mock');
    expect(createLocalSolverAdapter('cp_sat').name).toBe('ortools-cp-sat');
  });

  it('rejects unsupported strategies clearly', () => {
    expect(() => createLocalSolverAdapter('bogus' as never)).toThrow('Unsupported local solver strategy');
  });
});
