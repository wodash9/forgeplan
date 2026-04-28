import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { plantSchema } from '../src/index.js';
import { createLocalSolverAdapter, runLocalSolve } from '../src/solver/node.js';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8'));
}

describe('local solve runner', () => {
  it('runs a local mock solve by default', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));

    const result = runLocalSolve(plant);

    expect(result.status).toBe('feasible');
    expect(result.schedule.strategy).toBe('mock');
    expect(result.schedule.operations).toHaveLength(1);
  });

  it('creates the requested local adapter', () => {
    expect(createLocalSolverAdapter('mock').name).toBe('mock');
    expect(createLocalSolverAdapter('cp_sat').name).toBe('ortools-cp-sat');
  });

  it('rejects unsupported strategies clearly', () => {
    expect(() => createLocalSolverAdapter('bogus' as never)).toThrow('Unsupported local solver strategy');
  });
});
