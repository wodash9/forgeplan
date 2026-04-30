import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createForgePlanApi, createForgePlanServer, ForgePlanLocalStore, type Plant } from '../src/index.js';

function readPlantFixture(name: string): Plant {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8')) as Plant;
}

describe('ForgePlan backend API', () => {
  let tempDir: string;
  let store: ForgePlanLocalStore;
  let api: ReturnType<typeof createForgePlanApi>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'forgeplan-api-'));
    store = new ForgePlanLocalStore(join(tempDir, 'forgeplan.db'));
    api = createForgePlanApi({ store });
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exposes health and backend model metadata', async () => {
    const response = await api.fetch(new Request('http://forgeplan.local/api/health'));
    const body = await response.json() as { status: string; models: string[]; storage: { schemaVersion: number } };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.models).toEqual(['Plant', 'Material', 'PlantNode', 'Connection', 'Order', 'Scenario', 'Schedule', 'StoreEvent']);
    expect(body.storage.schemaVersion).toBe(1);
  });

  it('persists and returns plant models through REST endpoints', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');

    const createResponse = await api.fetch(new Request('http://forgeplan.local/api/plants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plant),
    }));
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject({ id: plant.id, name: plant.name, version: plant.version });

    const listResponse = await api.fetch(new Request('http://forgeplan.local/api/plants'));
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({ id: plant.id, name: plant.name, version: plant.version }),
    ]);

    const detailResponse = await api.fetch(new Request(`http://forgeplan.local/api/plants/${plant.id}`));
    expect(await detailResponse.json()).toEqual(plant);

    const readinessResponse = await api.fetch(new Request(`http://forgeplan.local/api/plants/${plant.id}/readiness`));
    expect(await readinessResponse.json()).toMatchObject({ status: 'ready', issues: [] });
  });

  it('runs a mock solve, saves scenario and schedule, and exposes events', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);

    const solveResponse = await api.fetch(new Request('http://forgeplan.local/api/solve/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id }),
    }));
    const solveBody = await solveResponse.json() as {
      scenario: { id: string; plantId: string };
      schedule: { id: string; status: string; operations: Array<{ orderId: string; nodeId: string; start: number; end: number }> };
    };

    expect(solveResponse.status).toBe(201);
    expect(solveBody.scenario.plantId).toBe(plant.id);
    expect(solveBody.schedule.status).toBe('feasible');
    expect(solveBody.schedule.operations[0]).toMatchObject({ orderId: 'order_1', nodeId: 'node_mixer', start: 0, end: 30 });
    expect(store.getScenario(solveBody.scenario.id)).toEqual(solveBody.scenario);
    expect(store.getSchedule(solveBody.schedule.id)).toEqual(solveBody.schedule);

    const schedulesResponse = await api.fetch(new Request(`http://forgeplan.local/api/schedules?scenarioId=${solveBody.scenario.id}`));
    expect(await schedulesResponse.json()).toEqual([
      expect.objectContaining({ id: solveBody.schedule.id, scenarioId: solveBody.scenario.id, status: 'feasible' }),
    ]);

    const eventsResponse = await api.fetch(new Request('http://forgeplan.local/api/events'));
    const events = await eventsResponse.json() as Array<{ type: string; entityType: string }>;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['plant.saved', 'scenario.saved', 'schedule.saved']));
  });

  it('rejects solve requests that combine a plant with another plant scenario', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const secondPlant = { ...plant, id: 'plant_secondary', name: 'Secondary Plant' };
    store.savePlant(plant);
    store.savePlant(secondPlant);
    const foreignScenario = store.saveScenario({
      id: 'scenario_secondary',
      plantId: secondPlant.id,
      name: 'Secondary scenario',
      plantVersion: secondPlant.version,
      createdAt: new Date().toISOString(),
      solverSettings: { strategy: 'mock', timeLimitSeconds: 60, workers: 1 },
    });

    const solveResponse = await api.fetch(new Request('http://forgeplan.local/api/solve/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id, scenarioId: foreignScenario.id }),
    }));

    expect(solveResponse.status).toBe(422);
    expect(await solveResponse.json()).toMatchObject({ error: { code: 'invalid_relationship' } });
  });

  it('validates schedules and rejects plant/scenario mismatches', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    const secondPlant = { ...plant, id: 'plant_secondary', name: 'Secondary Plant' };
    store.savePlant(plant);
    store.savePlant(secondPlant);
    const foreignScenario = store.saveScenario({
      id: 'scenario_secondary',
      plantId: secondPlant.id,
      name: 'Secondary scenario',
      plantVersion: secondPlant.version,
      createdAt: new Date().toISOString(),
      solverSettings: { strategy: 'mock', timeLimitSeconds: 60, workers: 1 },
    });

    const mismatchResponse = await api.fetch(new Request('http://forgeplan.local/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'schedule_mismatch',
        plantId: plant.id,
        scenarioId: foreignScenario.id,
        status: 'feasible',
        strategy: 'mock',
        operations: [],
        kpis: { lateOrders: 0, totalTardiness: 0, makespan: 0 },
        violations: [],
        explanations: [],
      }),
    }));

    expect(mismatchResponse.status).toBe(422);
    expect(await mismatchResponse.json()).toMatchObject({ error: { code: 'invalid_relationship' } });

    const malformedResponse = await api.fetch(new Request('http://forgeplan.local/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'bad_schedule', plantId: plant.id, scenarioId: foreignScenario.id }),
    }));
    expect(malformedResponse.status).toBe(422);
    expect(await malformedResponse.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('clamps event list limits and does not allow wildcard CORS for untrusted origins', async () => {
    for (let index = 0; index < 130; index += 1) store.appendEvent('test.event', 'test', String(index), {});

    const eventsResponse = await api.fetch(new Request('http://forgeplan.local/api/events?limit=5000'));
    const events = await eventsResponse.json() as unknown[];
    expect(eventsResponse.status).toBe(200);
    expect(events).toHaveLength(100);

    const untrustedResponse = await api.fetch(new Request('http://forgeplan.local/api/health', {
      headers: { origin: 'https://evil.example' },
    }));
    expect(untrustedResponse.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('limits HTTP request bodies and refuses unsafe bind-all hosts by default', async () => {
    expect(() => createForgePlanServer({ dbPath: join(tempDir, 'unsafe.db'), host: '0.0.0.0' })).toThrow(/Unsafe ForgePlan host/);

    const runtime = createForgePlanServer({ dbPath: join(tempDir, 'http-limit.db'), host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = runtime.server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/plants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(1_100_000),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    } finally {
      await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
    }
  });

  it('returns structured errors for missing resources and invalid JSON', async () => {
    const missingResponse = await api.fetch(new Request('http://forgeplan.local/api/plants/missing'));
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({ error: { code: 'not_found' } });

    const invalidResponse = await api.fetch(new Request('http://forgeplan.local/api/plants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    }));
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({ error: { code: 'invalid_json' } });
  });
});
