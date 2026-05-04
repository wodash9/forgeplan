import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createForgePlanApi,
  createForgePlanServer,
  createKeycloakUserManagementFromEnv,
  ForgePlanLocalStore,
  UserManagementError,
  type Plant,
  type Schedule,
  type SolverAdapter,
  type SolverModel,
  type SolverOptions,
} from '../src/index.js';

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

  it('runs a CP-SAT solve through the local solver boundary and persists the resulting schedule', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);
    let capturedModel: SolverModel | undefined;
    let capturedOptions: SolverOptions | undefined;
    const cpSatAdapter: SolverAdapter = {
      name: 'test-cp-sat',
      solve(model, options) {
        capturedModel = model;
        capturedOptions = options;
        const operation = model.operations[0];
        if (!operation) throw new Error('Expected one operation in fixture model.');
        const schedule: Schedule = {
          id: `schedule_${model.id}_cp_sat_test`,
          plantId: model.plantId,
          scenarioId: model.scenarioId,
          status: 'optimal',
          strategy: 'cp_sat',
          operations: [{
            id: `scheduled_${operation.id}`,
            orderId: operation.orderId,
            nodeId: operation.nodeId,
            materialId: operation.materialId,
            start: 0,
            end: operation.duration,
            quantity: operation.quantity,
          }],
          kpis: { lateOrders: 0, totalTardiness: 0, makespan: operation.duration },
          violations: [],
          explanations: ['Solved by injected CP-SAT test adapter.'],
        };
        return { status: 'optimal', issues: [], schedule };
      },
    };
    const apiWithCpSat = createForgePlanApi({ store, solverAdapters: { cp_sat: cpSatAdapter } });

    const solveResponse = await apiWithCpSat.fetch(new Request('http://forgeplan.local/api/solve/cp-sat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id, timeLimitSeconds: 7, workers: 2 }),
    }));
    const solveBody = await solveResponse.json() as {
      scenario: { id: string; plantId: string; solverSettings: { strategy: string; timeLimitSeconds: number; workers: number } };
      schedule: Schedule;
    };

    expect(solveResponse.status).toBe(201);
    expect(solveBody.scenario.solverSettings).toMatchObject({ strategy: 'cp_sat', timeLimitSeconds: 7, workers: 2 });
    expect(solveBody.schedule.strategy).toBe('cp_sat');
    expect(solveBody.schedule.status).toBe('optimal');
    expect(store.getSchedule(solveBody.schedule.id)).toEqual(solveBody.schedule);
    expect(capturedModel).toMatchObject({ plantId: plant.id, objective: 'minimize_total_tardiness' });
    expect(capturedOptions).toEqual({ timeLimitSeconds: 7, workers: 2 });
  });

  it('keeps solve scenarios immutable across repeated strategies', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);
    const cpSatAdapter: SolverAdapter = {
      name: 'test-cp-sat',
      solve(model) {
        const operation = model.operations[0];
        if (!operation) throw new Error('Expected one operation in fixture model.');
        return {
          status: 'optimal',
          issues: [],
          schedule: {
            id: `schedule_${model.id}_cp_sat_test`,
            plantId: model.plantId,
            scenarioId: model.scenarioId,
            status: 'optimal',
            strategy: 'cp_sat',
            operations: [{ id: `scheduled_${operation.id}`, orderId: operation.orderId, nodeId: operation.nodeId, materialId: operation.materialId, start: 0, end: operation.duration, quantity: operation.quantity }],
            kpis: { lateOrders: 0, totalTardiness: 0, makespan: operation.duration },
            violations: [],
            explanations: ['Solved by injected CP-SAT test adapter.'],
          },
        };
      },
    };
    const apiWithCpSat = createForgePlanApi({ store, solverAdapters: { cp_sat: cpSatAdapter } });

    const mockResponse = await apiWithCpSat.fetch(new Request('http://forgeplan.local/api/solve/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id }),
    }));
    const cpSatResponse = await apiWithCpSat.fetch(new Request('http://forgeplan.local/api/solve/cp-sat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id }),
    }));
    const mockBody = await mockResponse.json() as { scenario: { id: string }; schedule: Schedule };
    const cpSatBody = await cpSatResponse.json() as { scenario: { id: string }; schedule: Schedule };

    expect(mockResponse.status).toBe(201);
    expect(cpSatResponse.status).toBe(201);
    expect(mockBody.scenario.id).not.toBe(cpSatBody.scenario.id);
    expect(store.getScenario(mockBody.scenario.id)?.solverSettings.strategy).toBe('mock');
    expect(store.getScenario(cpSatBody.scenario.id)?.solverSettings.strategy).toBe('cp_sat');
    expect(store.getSchedule(mockBody.schedule.id)?.scenarioId).toBe(mockBody.scenario.id);
    expect(store.getSchedule(cpSatBody.schedule.id)?.scenarioId).toBe(cpSatBody.scenario.id);
  });

  it('rejects solve requests whose existing scenario strategy does not match the requested solver', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);
    const mockScenario = store.saveScenario({
      id: 'scenario_mock_only',
      plantId: plant.id,
      name: 'Mock scenario',
      plantVersion: plant.version,
      createdAt: new Date().toISOString(),
      solverSettings: { strategy: 'mock', timeLimitSeconds: 60, workers: 1 },
    });

    const solveResponse = await api.fetch(new Request('http://forgeplan.local/api/solve/cp-sat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id, scenarioId: mockScenario.id }),
    }));

    expect(solveResponse.status).toBe(422);
    expect(await solveResponse.json()).toMatchObject({ error: { code: 'invalid_relationship' } });
  });

  it('rejects solve requests with out-of-range runtime settings', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);

    const solveResponse = await api.fetch(new Request('http://forgeplan.local/api/solve/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plantId: plant.id, timeLimitSeconds: 999_999, workers: 999 }),
    }));

    expect(solveResponse.status).toBe(400);
    expect(await solveResponse.json()).toMatchObject({ error: { code: 'invalid_body' } });
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

  it('serves the built SPA and falls back to index.html for platform routes before API handling', async () => {
    const staticDir = join(tempDir, 'dist-web');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<html><body><div id="root">ForgePlan SPA</div></body></html>');
    writeFileSync(join(staticDir, 'asset.txt'), 'asset-ok');
    const runtime = createForgePlanServer({ dbPath: join(tempDir, 'static.db'), host: '127.0.0.1', port: 0, staticDir });
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = runtime.server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const appResponse = await fetch(`${baseUrl}/app`);
      expect(appResponse.status).toBe(200);
      expect(appResponse.headers.get('content-type')).toContain('text/html');
      expect(await appResponse.text()).toContain('ForgePlan SPA');

      const assetResponse = await fetch(`${baseUrl}/asset.txt`);
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toBe('asset-ok');

      const apiResponse = await fetch(`${baseUrl}/api/health`);
      expect(apiResponse.status).toBe(200);
      expect(await apiResponse.json()).toMatchObject({ status: 'ok' });
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

  it('reports Keycloak user management as unavailable until the server-side adapter is configured', async () => {
    const response = await api.fetch(new Request('http://forgeplan.local/api/admin/users', {
      headers: { authorization: 'Bearer valid-admin-token' },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'user_management_unavailable',
        message: expect.stringContaining('Keycloak'),
      },
    });
  });

  it('requires a Keycloak bearer for protected API routes in keycloak mode while leaving health public', async () => {
    const plant = readPlantFixture('minimal-valid-plant.json');
    store.savePlant(plant);
    const userManagement = {
      isConfigured: () => true,
      async requireUser(request: Request) {
        if (!request.headers.get('authorization')) throw new UserManagementError(401, 'missing_bearer_token', 'Bearer token required.');
        return { id: 'user-1', username: 'planner', roles: ['forgeplan-user'] };
      },
      async requireAdmin(request: Request) {
        if (!request.headers.get('authorization')) throw new UserManagementError(401, 'missing_bearer_token', 'Bearer token required.');
        return { id: 'admin-1', username: 'ventura', roles: ['forgeplan-admin'] };
      },
      async listUsers() { return []; },
      async createUser() { return { id: 'user-2', username: 'operator', enabled: true }; },
      async updateUser(id: string) { return { id, username: 'operator', enabled: true }; },
      async deleteUser() {},
    };
    const protectedApi = createForgePlanApi({ store, userManagement, apiAccessMode: 'keycloak' });

    const healthResponse = await protectedApi.fetch(new Request('http://forgeplan.local/api/health'));
    expect(healthResponse.status).toBe(200);

    const anonymousModelsResponse = await protectedApi.fetch(new Request('http://forgeplan.local/api/models'));
    expect(anonymousModelsResponse.status).toBe(401);

    const anonymousPlantsResponse = await protectedApi.fetch(new Request('http://forgeplan.local/api/plants'));
    expect(anonymousPlantsResponse.status).toBe(401);
    expect(await anonymousPlantsResponse.json()).toMatchObject({ error: { code: 'missing_bearer_token' } });

    const authenticatedPlantsResponse = await protectedApi.fetch(new Request('http://forgeplan.local/api/plants', {
      headers: { authorization: 'Bearer user-token' },
    }));
    expect(authenticatedPlantsResponse.status).toBe(200);
  });

  it('allows Authorization in CORS preflight responses', async () => {
    const response = await api.fetch(new Request('http://forgeplan.local/api/admin/users', { method: 'OPTIONS' }));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('keeps CP-SAT disabled by default in the public Node runtime', async () => {
    const originalFlag = process.env.FORGEPLAN_CP_SAT_ENABLED;
    delete process.env.FORGEPLAN_CP_SAT_ENABLED;
    try {
      const plant = readPlantFixture('minimal-valid-plant.json');
      store.savePlant(plant);
      const response = await api.fetch(new Request('http://forgeplan.local/api/solve/cp-sat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plantId: plant.id }),
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_body', message: expect.stringContaining('disabled') } });
    } finally {
      if (originalFlag === undefined) delete process.env.FORGEPLAN_CP_SAT_ENABLED;
      else process.env.FORGEPLAN_CP_SAT_ENABLED = originalFlag;
    }
  });

  it('does not grant ForgePlan admin rights from OAuth scopes or generic role claims', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (href.includes('/token/introspect')) {
        return Response.json({
          active: true,
          sub: 'user-1',
          preferred_username: 'scope-admin',
          scope: 'openid forgeplan-admin admin',
          roles: ['forgeplan-admin'],
          resource_access: { 'other-client': { roles: ['forgeplan-admin'] } },
        });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    };
    const adapter = createKeycloakUserManagementFromEnv({
      FORGEPLAN_KEYCLOAK_URL: 'https://auth.example.test',
      FORGEPLAN_KEYCLOAK_REALM: 'etharlia',
      FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_ID: 'forgeplan-admin-api',
      FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_SECRET: 'server-secret',
      FORGEPLAN_KEYCLOAK_ROLE_CLIENT_ID: 'forgeplan-spa',
      FORGEPLAN_ADMIN_ROLES: 'forgeplan-admin',
    }, fetchImpl as typeof fetch);

    await expect(adapter.requireAdmin(new Request('http://forgeplan.local/api/admin/users', {
      headers: { authorization: 'Bearer user-token' },
    }))).rejects.toMatchObject({ status: 403, code: 'forbidden_user_management' });
  });

  it('rejects encoded path traversal user ids before calling Keycloak Admin user endpoints', async () => {
    const calledUrls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      calledUrls.push(href);
      if (href.includes('/token/introspect')) {
        return Response.json({
          active: true,
          sub: 'admin-1',
          preferred_username: 'ventura',
          resource_access: { 'forgeplan-spa': { roles: ['forgeplan-admin'] } },
        });
      }
      if (href.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'admin-api-token', expires_in: 30 });
      return Response.json({ error: 'unsafe keycloak call' }, { status: 500 });
    };
    const adapter = createKeycloakUserManagementFromEnv({
      FORGEPLAN_KEYCLOAK_URL: 'https://auth.example.test',
      FORGEPLAN_KEYCLOAK_REALM: 'etharlia',
      FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_ID: 'forgeplan-admin-api',
      FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_SECRET: 'server-secret',
      FORGEPLAN_KEYCLOAK_ROLE_CLIENT_ID: 'forgeplan-spa',
      FORGEPLAN_ADMIN_ROLES: 'forgeplan-admin',
    }, fetchImpl as typeof fetch);
    const apiWithRealKeycloakAdapter = createForgePlanApi({ store, userManagement: adapter });

    const response = await apiWithRealKeycloakAdapter.fetch(new Request('http://forgeplan.local/api/admin/users/%252e%252e', {
      method: 'PATCH',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_user_input', message: expect.stringContaining('unsafe path') } });
    expect(calledUrls.every((url) => !url.includes('/admin/realms/etharlia/users/'))).toBe(true);
  });

  it('delegates ForgePlan user access CRUD to the configured Keycloak user management adapter', async () => {
    const calls: string[] = [];
    const userManagement = {
      isConfigured: () => true,
      async requireUser(request: Request) {
        calls.push(`user:${request.headers.get('authorization')}`);
        return { id: 'user-admin-1', username: 'ventura', roles: ['forgeplan-user'] };
      },
      async requireAdmin(request: Request) {
        calls.push(`auth:${request.headers.get('authorization')}`);
        return { id: 'admin-1', username: 'ventura', roles: ['forgeplan-admin'] };
      },
      async listUsers({ search }: { search?: string | undefined }) {
        calls.push(`list:${search ?? ''}`);
        return [{ id: 'user-1', username: 'planner', email: 'planner@example.com', firstName: 'Plan', lastName: 'Ner', enabled: true }];
      },
      async createUser(input: unknown) {
        calls.push(`create:${JSON.stringify(input)}`);
        return { id: 'user-2', username: 'operator', email: 'operator@example.com', enabled: true };
      },
      async updateUser(id: string, input: unknown) {
        calls.push(`update:${id}:${JSON.stringify(input)}`);
        return { id, username: 'planner', email: 'planner@example.com', firstName: 'Planner', enabled: false };
      },
      async deleteUser(id: string) {
        calls.push(`delete:${id}`);
      },
    };
    const apiWithUsers = createForgePlanApi({ store, userManagement });

    const listResponse = await apiWithUsers.fetch(new Request('http://forgeplan.local/api/admin/users?search=plan', {
      headers: { authorization: 'Bearer valid-admin-token' },
    }));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      users: [{ id: 'user-1', username: 'planner', email: 'planner@example.com', firstName: 'Plan', lastName: 'Ner', enabled: true }],
    });

    const createResponse = await apiWithUsers.fetch(new Request('http://forgeplan.local/api/admin/users', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'operator', email: 'operator@example.com', password: 'TempPass123!', temporaryPassword: true }),
    }));
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject({ user: { id: 'user-2', username: 'operator' } });

    const updateResponse = await apiWithUsers.fetch(new Request('http://forgeplan.local/api/admin/users/user-1', {
      method: 'PATCH',
      headers: { authorization: 'Bearer valid-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Planner', enabled: false }),
    }));
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ user: { id: 'user-1', firstName: 'Planner', enabled: false } });

    const deleteResponse = await apiWithUsers.fetch(new Request('http://forgeplan.local/api/admin/users/user-1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer valid-admin-token' },
    }));
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ deleted: true, id: 'user-1' });

    expect(calls).toEqual([
      'auth:Bearer valid-admin-token',
      'list:plan',
      'auth:Bearer valid-admin-token',
      'create:{"username":"operator","email":"operator@example.com","password":"TempPass123!","temporaryPassword":true}',
      'auth:Bearer valid-admin-token',
      'update:user-1:{"firstName":"Planner","enabled":false}',
      'auth:Bearer valid-admin-token',
      'delete:user-1',
    ]);
  });
});
