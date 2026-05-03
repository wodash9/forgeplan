import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

describe('forgeplan solve CLI', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' });
  }, 60_000);

  it('prints a feasible mock schedule for the minimal fixture', () => {
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
