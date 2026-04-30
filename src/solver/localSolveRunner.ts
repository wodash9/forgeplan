import type { Plant, Scenario, SolverStrategy } from '../domain/types.js';
import { createScenario } from '../domain/defaults.js';
import { buildSolverModel } from './buildSolverModel.js';
import { mockSolverAdapter } from './mockSolver.js';
import type { SolverAdapter, SolverOptions, SolverResult } from './types.js';
import { OrToolsCpSatAdapter } from './ortoolsCpSatAdapter.js';

export interface LocalSolveOptions extends SolverOptions {
  strategy?: Extract<SolverStrategy, 'mock' | 'cp_sat'> | undefined;
  scenario?: Scenario | undefined;
  pythonBinary?: string | undefined;
}

export function runLocalSolve(plant: Plant, options: LocalSolveOptions = {}): SolverResult {
  const strategy = options.strategy ?? 'mock';
  const scenario = options.scenario ?? createScenario(plant, { solverSettings: { strategy, timeLimitSeconds: options.timeLimitSeconds ?? 30, workers: options.workers ?? 1 } });
  const model = buildSolverModel(plant, scenario, { objective: strategy === 'cp_sat' ? 'minimize_total_tardiness' : 'minimize_makespan' });
  const adapter = createLocalSolverAdapter(strategy, options);

  return adapter.solve(model, {
    timeLimitSeconds: options.timeLimitSeconds ?? scenario.solverSettings.timeLimitSeconds,
    workers: options.workers ?? scenario.solverSettings.workers,
  });
}

export function createLocalSolverAdapter(strategy: LocalSolveOptions['strategy'], options: LocalSolveOptions = {}): SolverAdapter {
  switch (strategy ?? 'mock') {
    case 'mock':
      return mockSolverAdapter;
    case 'cp_sat':
      return new OrToolsCpSatAdapter({ pythonBinary: options.pythonBinary });
    default:
      throw new Error(`Unsupported local solver strategy: ${String(strategy)}`);
  }
}
