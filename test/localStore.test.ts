import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createScenario, ForgePlanLocalStore, StoreValidationError, type Plant, type Schedule } from '../src/index.js';

function readPlantFixture(name: string): Plant {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8')) as Plant;
}

describe('ForgePlanLocalStore', () => {
  let tempDir: string;
  let store: ForgePlanLocalStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'forgeplan-store-'));
    store = new ForgePlanLocalStore(join(tempDir, 'forgeplan.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and retrieves a valid plant', () => {
    const plant = readPlantFixture('minimal-valid-plant.json');

    store.savePlant(plant);

    expect(store.getPlant(plant.id)).toEqual(plant);
    expect(store.listPlants()).toEqual([
      expect.objectContaining({ id: plant.id, name: plant.name, version: plant.version }),
    ]);
  });

  it('rejects an invalid plant and exposes validation issues', () => {
    const invalidPlant = readPlantFixture('invalid-plant.json');

    expect(() => store.savePlant(invalidPlant)).toThrow(StoreValidationError);
    try {
      store.savePlant(invalidPlant);
    } catch (error) {
      expect(error).toBeInstanceOf(StoreValidationError);
      expect((error as StoreValidationError).issues.length).toBeGreaterThan(0);
    }

    expect(store.listPlants()).toEqual([]);
  });

  it('saves scenarios for existing plants', () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const scenario = createScenario(plant);

    store.savePlant(plant);
    store.saveScenario(scenario);

    expect(store.getScenario(scenario.id)).toEqual(scenario);
    expect(store.listScenarios(plant.id)).toEqual([
      expect.objectContaining({ id: scenario.id, plantId: plant.id, name: scenario.name }),
    ]);
  });

  it('rejects scenarios for missing plants', () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const scenario = createScenario(plant);

    expect(() => store.saveScenario(scenario)).toThrow(/does not exist/);
  });

  it('saves schedules for existing scenarios', () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const scenario = createScenario(plant);
    const schedule: Schedule = {
      id: 'schedule_demo',
      plantId: plant.id,
      scenarioId: scenario.id,
      status: 'feasible',
      strategy: 'mock',
      operations: [],
      kpis: { lateOrders: 0, totalTardiness: 0, makespan: 0 },
      violations: [],
      explanations: ['Mock schedule for persistence tests.'],
    };

    store.savePlant(plant);
    store.saveScenario(scenario);
    store.saveSchedule(schedule);

    expect(store.getSchedule(schedule.id)).toEqual(schedule);
    expect(store.listSchedules(scenario.id)).toEqual([
      expect.objectContaining({ id: schedule.id, plantId: plant.id, scenarioId: scenario.id, status: 'feasible' }),
    ]);
  });

  it('records append-only events in creation order', () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const scenario = createScenario(plant);

    store.savePlant(plant);
    store.saveScenario(scenario);

    expect(store.listEvents().map((event) => event.type)).toEqual([
      'store.initialized',
      'plant.saved',
      'scenario.saved',
    ]);
  });
});
