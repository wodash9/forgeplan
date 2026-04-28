import type { Plant, Scenario, SolverSettings } from './types.js';

export const defaultSolverSettings: SolverSettings = {
  strategy: 'mock',
  timeLimitSeconds: 30,
  workers: 1,
};

export function createEmptyPlant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: 'plant_empty',
    name: 'Empty Plant',
    version: 1,
    timeHorizon: 480,
    timeUnit: 'minute',
    materials: [],
    nodes: [],
    connections: [],
    orders: [],
    ...overrides,
  };
}

export function createScenario(plant: Plant, overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: `scenario_${plant.id}_baseline`,
    plantId: plant.id,
    name: `${plant.name} baseline`,
    plantVersion: plant.version,
    createdAt: new Date(0).toISOString(),
    solverSettings: defaultSolverSettings,
    ...overrides,
  };
}
