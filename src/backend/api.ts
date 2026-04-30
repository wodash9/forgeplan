import { buildSolverModel, mockSolverAdapter } from '../solver/index.js';
import { createScenario } from '../domain/defaults.js';
import type { Plant, Scenario, Schedule, ValidationResult } from '../domain/types.js';
import { validatePlant } from '../validation/validatePlant.js';
import { ForgePlanLocalStore, StoreRelationshipError, StoreValidationError } from '../storage/localStore.js';

export interface ForgePlanApiOptions {
  store: ForgePlanLocalStore;
}

export interface ForgePlanApi {
  fetch(request: Request): Promise<Response>;
}

const BACKEND_MODELS = ['Plant', 'Material', 'PlantNode', 'Connection', 'Order', 'Scenario', 'Schedule', 'StoreEvent'] as const;

export function createForgePlanApi({ store }: ForgePlanApiOptions): ForgePlanApi {
  return {
    fetch: (request) => handleApiRequest(store, request),
  };
}

async function handleApiRequest(store: ForgePlanLocalStore, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api') return errorResponse(404, 'not_found', `Route ${url.pathname} does not exist.`);

    if (request.method === 'OPTIONS') return emptyResponse(204);

    if (segments[1] === 'health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', models: [...BACKEND_MODELS], storage: { schemaVersion: readSchemaVersion(store) } });
    }

    if (segments[1] === 'models' && request.method === 'GET') {
      return jsonResponse({ models: describeBackendModels() });
    }

    if (segments[1] === 'plants') return await handlePlants(store, request, segments);
    if (segments[1] === 'scenarios') return await handleScenarios(store, request, segments, url);
    if (segments[1] === 'schedules') return await handleSchedules(store, request, segments, url);
    if (segments[1] === 'events' && request.method === 'GET') {
      return jsonResponse(store.listEvents(parseEventLimit(url.searchParams.get('limit'))));
    }
    if (segments[1] === 'solve' && segments[2] === 'mock' && request.method === 'POST') {
      return await handleMockSolve(store, request);
    }

    return errorResponse(404, 'not_found', `Route ${url.pathname} does not exist.`);
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

async function handlePlants(store: ForgePlanLocalStore, request: Request, segments: string[]): Promise<Response> {
  if (segments.length === 2 && request.method === 'GET') return jsonResponse(store.listPlants());
  if (segments.length === 2 && request.method === 'POST') {
    const plant = store.savePlant(await parseJsonBody(request));
    return jsonResponse(toPlantSummary(plant), 201);
  }
  if (segments.length === 3 && segments[2] === 'import' && request.method === 'POST') {
    const body = await parseJsonBody(request) as { json?: unknown };
    if (typeof body.json !== 'string') return errorResponse(400, 'invalid_body', 'Import endpoint expects { "json": "..." }.');
    const plant = store.importPlantJson(body.json);
    return jsonResponse(toPlantSummary(plant), 201);
  }

  const plantId = segments[2];
  if (!plantId) return errorResponse(404, 'not_found', 'Plant route does not exist.');

  const plant = store.getPlant(decodeURIComponent(plantId));
  if (!plant) return errorResponse(404, 'not_found', `Plant ${plantId} does not exist.`);

  if (segments.length === 3 && request.method === 'GET') return jsonResponse(plant);
  if (segments.length === 3 && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await parseJsonBody(request) as Record<string, unknown>;
    const saved = store.savePlant({ ...body, id: decodeURIComponent(plantId) });
    return jsonResponse(saved);
  }
  if (segments.length === 3 && request.method === 'DELETE') {
    store.deletePlant(decodeURIComponent(plantId));
    return jsonResponse({ deleted: true, id: decodeURIComponent(plantId) });
  }
  if (segments.length === 4 && segments[3] === 'readiness' && request.method === 'GET') return jsonResponse(validatePlant(plant) satisfies ValidationResult);
  if (segments.length === 4 && segments[3] === 'export' && request.method === 'GET') return jsonResponse({ json: store.exportPlantJson(plant.id) });
  if (segments.length === 4 && segments[3] === 'solve' && request.method === 'POST') return handleMockSolve(store, request, decodeURIComponent(plantId));

  return errorResponse(404, 'not_found', 'Plant route does not exist.');
}

async function handleScenarios(store: ForgePlanLocalStore, request: Request, segments: string[], url: URL): Promise<Response> {
  if (segments.length === 2 && request.method === 'GET') return jsonResponse(store.listScenarios(url.searchParams.get('plantId') ?? undefined));
  if (segments.length === 2 && request.method === 'POST') {
    const scenario = store.saveScenario(await parseJsonBody(request));
    return jsonResponse(scenario, 201);
  }

  const scenarioId = segments[2];
  if (segments.length === 3 && scenarioId && request.method === 'GET') {
    const scenario = store.getScenario(decodeURIComponent(scenarioId));
    return scenario ? jsonResponse(scenario) : errorResponse(404, 'not_found', `Scenario ${scenarioId} does not exist.`);
  }
  if (segments.length === 3 && scenarioId && (request.method === 'PUT' || request.method === 'PATCH')) {
    const scenario = store.saveScenario({ ...(await parseJsonBody(request) as Record<string, unknown>), id: decodeURIComponent(scenarioId) });
    return jsonResponse(scenario);
  }
  if (segments.length === 3 && scenarioId && request.method === 'DELETE') {
    return store.deleteScenario(decodeURIComponent(scenarioId))
      ? jsonResponse({ deleted: true, id: decodeURIComponent(scenarioId) })
      : errorResponse(404, 'not_found', `Scenario ${scenarioId} does not exist.`);
  }
  return errorResponse(404, 'not_found', 'Scenario route does not exist.');
}

function handleSchedules(store: ForgePlanLocalStore, request: Request, segments: string[], url: URL): Response | Promise<Response> {
  if (segments.length === 2 && request.method === 'GET') return jsonResponse(store.listSchedules(url.searchParams.get('scenarioId') ?? undefined));
  if (segments.length === 2 && request.method === 'POST') {
    return parseJsonBody(request).then((body) => jsonResponse(store.saveSchedule(body as Schedule), 201));
  }

  const scheduleId = segments[2];
  if (segments.length === 3 && scheduleId && request.method === 'GET') {
    const schedule = store.getSchedule(decodeURIComponent(scheduleId));
    return schedule ? jsonResponse(schedule) : errorResponse(404, 'not_found', `Schedule ${scheduleId} does not exist.`);
  }
  if (segments.length === 3 && scheduleId && (request.method === 'PUT' || request.method === 'PATCH')) {
    return parseJsonBody(request).then((body) => jsonResponse(store.saveSchedule({ ...(body as Record<string, unknown>), id: decodeURIComponent(scheduleId) } as Schedule)));
  }
  if (segments.length === 3 && scheduleId && request.method === 'DELETE') {
    return store.deleteSchedule(decodeURIComponent(scheduleId))
      ? jsonResponse({ deleted: true, id: decodeURIComponent(scheduleId) })
      : errorResponse(404, 'not_found', `Schedule ${scheduleId} does not exist.`);
  }
  return errorResponse(404, 'not_found', 'Schedule route does not exist.');
}

async function handleMockSolve(store: ForgePlanLocalStore, request: Request, routePlantId?: string): Promise<Response> {
  const body = await parseJsonBody(request) as { plantId?: unknown; scenarioId?: unknown };
  const plantId = routePlantId ?? body.plantId;
  if (typeof plantId !== 'string' || plantId.trim().length === 0) {
    return errorResponse(400, 'invalid_body', 'Mock solve expects a plantId string.');
  }

  const plant = store.getPlant(plantId);
  if (!plant) return errorResponse(404, 'not_found', `Plant ${plantId} does not exist.`);

  const scenario = resolveScenario(store, plant, typeof body.scenarioId === 'string' ? body.scenarioId : undefined);
  const solverModel = buildSolverModel(plant, scenario);
  const result = mockSolverAdapter.solve(solverModel);
  const schedule = store.saveSchedule(result.schedule);

  return jsonResponse({ status: result.status, issues: result.issues, scenario, schedule }, 201);
}

function resolveScenario(store: ForgePlanLocalStore, plant: Plant, scenarioId?: string): Scenario {
  if (scenarioId) {
    const scenario = store.getScenario(scenarioId);
    if (!scenario) throw new NotFoundError(`Scenario ${scenarioId} does not exist.`);
    if (scenario.plantId !== plant.id) {
      throw new StoreRelationshipError(`Scenario ${scenario.id} belongs to plant ${scenario.plantId}, not ${plant.id}.`);
    }
    return scenario;
  }
  return store.saveScenario(createScenario(plant));
}

function parseEventLimit(rawLimit: string | null): number {
  const parsed = Number(rawLimit ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new InvalidJsonError(`Invalid JSON: ${(error as Error).message}`);
  }
}

function responseHeaders(): HeadersInit {
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: responseHeaders(),
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: responseHeaders(),
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return jsonResponse({ error: { code, message, details } }, status);
}

function mapErrorToResponse(error: unknown): Response {
  if (error instanceof InvalidJsonError) return errorResponse(400, 'invalid_json', error.message);
  if (error instanceof NotFoundError) return errorResponse(404, 'not_found', error.message);
  if (error instanceof StoreRelationshipError) return errorResponse(422, 'invalid_relationship', error.message);
  if (error instanceof StoreValidationError) return errorResponse(422, 'validation_error', error.message, error.issues);
  if (error instanceof Error && error.name === 'ZodError') return errorResponse(422, 'validation_error', error.message);
  return errorResponse(500, 'internal_error', error instanceof Error ? error.message : 'Unexpected backend error.');
}

function toPlantSummary(plant: Plant) {
  return { id: plant.id, name: plant.name, version: plant.version };
}

function readSchemaVersion(store: ForgePlanLocalStore): number {
  const row = store.db.prepare('select value from metadata where key = ?').get('schema_version') as { value: string } | undefined;
  return Number(row?.value ?? 1);
}

function describeBackendModels() {
  return [
    { name: 'Plant', persistedIn: 'plants.json', owns: ['materials', 'nodes', 'connections', 'orders'] },
    { name: 'Scenario', persistedIn: 'scenarios.json', references: ['plants.id'] },
    { name: 'Schedule', persistedIn: 'schedules.json', references: ['plants.id', 'scenarios.id'] },
    { name: 'StoreEvent', persistedIn: 'events.payload', role: 'append-only audit trail' },
  ];
}

class InvalidJsonError extends Error {}
class NotFoundError extends Error {}
