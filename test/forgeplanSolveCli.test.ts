import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

function createFakeCpSatPython() {
  const tempDir = mkdtempSync(join(tmpdir(), 'forgeplan-cli-fake-python-'));
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
  explanations: ['fake cli cp-sat worker']
}));
`);
  chmodSync(fakePython, 0o755);
  return { fakePython, capturePath };
}

describe('forgeplan solve CLI', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' });
  }, 60_000);

  it('defaults to the local CP-SAT path when a Python boundary is available', () => {
    const { fakePython, capturePath } = createFakeCpSatPython();
    const output = execFileSync('node', ['scripts/forgeplan-solve.mjs', 'fixtures/minimal-valid-plant.json', '--time-limit', '8', '--workers', '2', '--python', fakePython], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const schedule = JSON.parse(output) as { status: string; strategy: string; operations: unknown[] };
    const captured = JSON.parse(readFileSync(capturePath, 'utf8')) as { options: { timeLimitSeconds: number; workers: number }; model: { objective: string } };

    expect(schedule.status).toBe('optimal');
    expect(schedule.strategy).toBe('cp_sat');
    expect(schedule.operations).toHaveLength(1);
    expect(captured.options).toEqual({ timeLimitSeconds: 8, workers: 2 });
    expect(captured.model.objective).toBe('minimize_total_tardiness');
  });

  it('prints a feasible mock schedule for the minimal fixture when mock is requested explicitly', () => {
    const output = execFileSync('node', ['scripts/forgeplan-solve.mjs', 'fixtures/minimal-valid-plant.json', '--strategy', 'mock'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const schedule = JSON.parse(output) as { status: string; strategy: string; operations: unknown[] };

    expect(schedule.status).toBe('feasible');
    expect(schedule.strategy).toBe('mock');
    expect(schedule.operations).toHaveLength(1);
  });

  it('fails clearly for an unsupported strategy', () => {
    expect(() =>
      execFileSync('node', ['scripts/forgeplan-solve.mjs', 'fixtures/minimal-valid-plant.json', '--strategy', 'bogus'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow(/Unsupported strategy 'bogus'/);
  });
});
