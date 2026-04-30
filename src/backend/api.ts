import { randomUUID } from 'node:crypto';

import { buildSolverModel, mockSolverAdapter } from '../solver/index.js';
import { OrToolsCpSatAdapter } from '../solver/node.js';
import { createScenario } from '../domain/defaults.js';
import type { Plant, Scenario, Schedule, SolverStrategy, ValidationResult } from '../domain/types.js';
import type { SolverAdapter, SolverOptions } from '../solver/types.js';
import { validatePlant } from '../validation/validatePlant.js';
import { ForgePlanLocalStore, StoreRelationshipError, StoreValidationError } from '../storage/localStore.js';

export type ApiSolveStrategy = Extract<SolverStrategy, 'mock' | 'cp_sat'>;

export interface ForgePlanApiOptions {
  store: ForgePlanLocalStore;
  solverAdapters?: Partial<Record<ApiSolveStrategy, SolverAdapter>> | undefined;
}

export interface ForgePlanApi {
  fetch(request: Request): Promise<Response>;
}

const BACKEND_MODELS = ['Plant', 'Material', 'PlantNode', 'Connection', 'Order', 'Scenario', 'Schedule', 'StoreEvent'] as const;
const MAX_SOLVE_TIME_LIMIT_SECONDS = 300;
const MAX_SOLVE_WORKERS = 16;

export function createForgePlanApi({ store, solverAdapters = {} }: ForgePlanApiOptions): ForgePlanApi {
  return {
    fetch: (request) => handleApiRequest(store, request, solverAdapters),
  };
}

async function handleApiRequest(store: ForgePlanLocalStore, request: Request, solverAdapters: Partial<Record<ApiSolveStrategy, SolverAdapter>>): Promise<Response> {
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

    if (segments[1] === 'plants') return await handlePlants(store, request, segments, solverAdapters);
    if (segments[1] === 'scenarios') return await handleScenarios(store, request, segments, url);
    if (segments[1] === 'schedules') return await handleSchedules(store, request, segments, url);
    if (segments[1] === 'events' && request.method === 'GET') {
      return jsonResponse(store.listEvents(parseEventLimit(url.searchParams.get('limit'))));
    }
    const solveStrategy = parseSolveStrategy(segments[2]);
    if (segments[1] === 'solve' && solveStrategy && request.method === 'POST') {
      return await handleSolve(store, request, solveStrategy, solverAdapters);
    }

    return errorResponse(404, 'not_found', `Route ${url.pathname} does not exist.`);
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

async function handlePlants(store: ForgePlanLocalStore, request: Request, segments: string[], solverAdapters: Partial<Record<ApiSolveStrategy, SolverAdapter>>): Promise<Response> {
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
  if (segments.length === 4 && segments[3] === 'solve' && request.method === 'POST') {
    const body = await parseJsonBody(request) as { strategy?: unknown };
    const requestedStrategy = parseSolveStrategy(typeof body.strategy === 'string' ? body.strategy : 'mock');
    if (!requestedStrategy) return errorResponse(400, 'invalid_body', 'Plant solve expects strategy "mock" or "cp_sat".');
    return handleSolveFromBody(store, body, requestedStrategy, solverAdapters, decodeURIComponent(plantId));
  }

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

interface SolveRequestBody {
  plantId?: unknown;
  scenarioId?: unknown;
  timeLimitSeconds?: unknown;
  workers?: unknown;
  strategy?: unknown;
}

async function handleSolve(store: ForgePlanLocalStore, request: Request, strategy: ApiSolveStrategy, solverAdapters: Partial<Record<ApiSolveStrategy, SolverAdapter>>): Promise<Response> {
  return handleSolveFromBody(store, await parseJsonBody(request) as SolveRequestBody, strategy, solverAdapters);
}

function handleSolveFromBody(
  store: ForgePlanLocalStore,
  body: SolveRequestBody,
  strategy: ApiSolveStrategy,
  solverAdapters: Partial<Record<ApiSolveStrategy, SolverAdapter>>,
  routePlantId?: string,
): Response {
  const plantId = routePlantId ?? body.plantId;
  if (typeof plantId !== 'string' || plantId.trim().length === 0) {
    return errorResponse(400, 'invalid_body', `${strategyLabel(strategy)} solve expects a plantId string.`);
  }

  const plant = store.getPlant(plantId);
  if (!plant) return errorResponse(404, 'not_found', `Plant ${plantId} does not exist.`);

  const requestedOptions = parseSolveOptions(body);
  const scenario = resolveScenario(store, plant, typeof body.scenarioId === 'string' ? body.scenarioId : undefined, strategy, requestedOptions, body);
  const solveOptions: SolverOptions = {
    timeLimitSeconds: body.timeLimitSeconds === undefined ? scenario.solverSettings.timeLimitSeconds : requestedOptions.timeLimitSeconds,
    workers: body.workers === undefined ? scenario.solverSettings.workers : requestedOptions.workers,
  };
  const solverModel = buildSolverModel(plant, scenario, { objective: strategy === 'cp_sat' ? 'minimize_total_tardiness' : 'minimize_makespan' });
  const adapter = solverAdapters[strategy] ?? createDefaultSolveAdapter(strategy);
  const result = adapter.solve(solverModel, solveOptions);
  const schedule = store.saveSchedule(result.schedule);

  return jsonResponse({ status: result.status, issues: result.issues, scenario, schedule }, 201);
}

function createDefaultSolveAdapter(strategy: ApiSolveStrategy): SolverAdapter {
  if (strategy === 'cp_sat') return new OrToolsCpSatAdapter({ pythonBinary: process.env.FORGEPLAN_PYTHON_BINARY });
  return mockSolverAdapter;
}

function parseSolveOptions(body: SolveRequestBody): SolverOptions {
  return {
    timeLimitSeconds: parsePositiveNumber(body.timeLimitSeconds, 30, MAX_SOLVE_TIME_LIMIT_SECONDS, 'timeLimitSeconds'),
    workers: parsePositiveInteger(body.workers, 1, MAX_SOLVE_WORKERS, 'workers'),
  };
}

function parsePositiveNumber(value: unknown, fallback: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new InvalidSolveOptionsError(`${field} must be a positive number no greater than ${max}.`);
  }
  return parsed;
}

function parsePositiveInteger(value: unknown, fallback: number, max: number, field: string): number {
  const parsed = parsePositiveNumber(value, fallback, max, field);
  if (!Number.isInteger(parsed)) throw new InvalidSolveOptionsError(`${field} must be a positive integer.`);
  return parsed;
}

function parseSolveStrategy(rawStrategy: string | undefined): ApiSolveStrategy | undefined {
  if (rawStrategy === 'mock') return 'mock';
  if (rawStrategy === 'cp_sat' || rawStrategy === 'cp-sat') return 'cp_sat';
  return undefined;
}

function strategyLabel(strategy: ApiSolveStrategy): string {
  return strategy === 'cp_sat' ? 'CP-SAT' : 'Mock';
}

function resolveScenario(store: ForgePlanLocalStore, plant: Plant, scenarioId: string | undefined, strategy: ApiSolveStrategy = 'mock', options?: SolverOptions, body: SolveRequestBody = {}): Scenario {
  if (scenarioId) {
    const scenario = store.getScenario(scenarioId);
    if (!scenario) throw new NotFoundError(`Scenario ${scenarioId} does not exist.`);
    if (scenario.plantId !== plant.id) {
      throw new StoreRelationshipError(`Scenario ${scenario.id} belongs to plant ${scenario.plantId}, not ${plant.id}.`);
    }
    ensureScenarioMatchesSolveRequest(scenario, strategy, options, body);
    return scenario;
  }
  return store.saveScenario(createScenario(plant, {
    id: `scenario_${plant.id}_${strategy}_${randomUUID()}`,
    name: `${plant.name} ${strategyLabel(strategy)} solve`,
    createdAt: new Date().toISOString(),
    solverSettings: {
      strategy,
      timeLimitSeconds: options?.timeLimitSeconds ?? 30,
      workers: options?.workers ?? 1,
    },
  }));
}

function ensureScenarioMatchesSolveRequest(scenario: Scenario, strategy: ApiSolveStrategy, options?: SolverOptions, body: SolveRequestBody = {}): void {
  if (scenario.solverSettings.strategy !== strategy) {
    throw new StoreRelationshipError(`Scenario ${scenario.id} is configured for ${scenario.solverSettings.strategy}, not ${strategy}.`);
  }
  if (body.timeLimitSeconds !== undefined && options?.timeLimitSeconds !== scenario.solverSettings.timeLimitSeconds) {
    throw new StoreRelationshipError(`Scenario ${scenario.id} time limit is ${scenario.solverSettings.timeLimitSeconds}, not ${options?.timeLimitSeconds}.`);
  }
  if (body.workers !== undefined && options?.workers !== scenario.solverSettings.workers) {
    throw new StoreRelationshipError(`Scenario ${scenario.id} workers setting is ${scenario.solverSettings.workers}, not ${options?.workers}.`);
  }
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
  if (error instanceof InvalidSolveOptionsError) return errorResponse(400, 'invalid_body', error.message);
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
class InvalidSolveOptionsError extends Error {}
class NotFoundError extends Error {}
