import { createRequire } from 'node:module';

import type { Plant, Scenario, Schedule, ValidationIssue } from '../domain/types.js';
import { plantSchema, scenarioSchema } from '../schema/plantSchema.js';
import { validatePlant } from '../validation/validatePlant.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export interface StoreEvent {
  id: number;
  type: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PlantSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioSummary {
  id: string;
  plantId: string;
  name: string;
  createdAt: string;
}

export interface ScheduleSummary {
  id: string;
  plantId: string;
  scenarioId: string;
  status: Schedule['status'];
  strategy: Schedule['strategy'];
  createdAt: string;
}

interface PlantRow {
  id: string;
  name: string;
  version: number;
  json: string;
  created_at: string;
  updated_at: string;
}

interface ScenarioRow {
  id: string;
  plant_id: string;
  name: string;
  json: string;
  created_at: string;
}

interface ScheduleRow {
  id: string;
  plant_id: string;
  scenario_id: string;
  status: Schedule['status'];
  strategy: Schedule['strategy'];
  json: string;
  created_at: string;
}

interface EventRow {
  id: number;
  type: string;
  entity_type: string;
  entity_id: string;
  payload: string;
  created_at: string;
}

export class ForgePlanLocalStore {
  readonly db: InstanceType<typeof DatabaseSync>;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  savePlant(input: unknown): Plant {
    const validation = validatePlant(input);
    if (validation.status === 'not_ready') {
      throw new StoreValidationError('Plant is not ready for persistence.', validation.issues);
    }

    const plant = plantSchema.parse(input) as Plant;
    const existing = this.db.prepare('select created_at from plants where id = ?').get(plant.id) as { created_at: string } | undefined;
    const now = new Date().toISOString();
    const createdAt = existing?.created_at ?? now;

    this.db
      .prepare(
        `insert into plants (id, name, version, json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           name = excluded.name,
           version = excluded.version,
           json = excluded.json,
           updated_at = excluded.updated_at`,
      )
      .run(plant.id, plant.name, plant.version, JSON.stringify(plant), createdAt, now);

    this.appendEvent('plant.saved', 'plant', plant.id, { name: plant.name, version: plant.version });
    return plant;
  }

  getPlant(id: string): Plant | undefined {
    const row = this.db.prepare('select * from plants where id = ?').get(id) as PlantRow | undefined;
    return row ? (JSON.parse(row.json) as Plant) : undefined;
  }

  listPlants(): PlantSummary[] {
    const rows = this.db.prepare('select id, name, version, created_at, updated_at from plants order by updated_at desc, id asc').all() as Omit<PlantRow, 'json'>[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  exportPlantJson(id: string): string {
    const plant = this.getPlant(id);
    if (!plant) throw new Error(`Cannot export plant ${id}: plant does not exist.`);
    this.appendEvent('plant.exported', 'plant', id, { name: plant.name, version: plant.version });
    return JSON.stringify(plant, null, 2);
  }

  importPlantJson(json: string): Plant {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(`Invalid JSON: ${(error as Error).message}`);
    }

    const plant = this.savePlant(parsed);
    this.appendEvent('plant.imported', 'plant', plant.id, { name: plant.name, version: plant.version });
    return plant;
  }

  saveScenario(input: unknown): Scenario {
    const scenario = scenarioSchema.parse(input);
    if (!this.getPlant(scenario.plantId)) {
      throw new Error(`Cannot save scenario ${scenario.id}: plant ${scenario.plantId} does not exist.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into scenarios (id, plant_id, name, json, created_at)
         values (?, ?, ?, ?, ?)
         on conflict(id) do update set
           plant_id = excluded.plant_id,
           name = excluded.name,
           json = excluded.json`,
      )
      .run(scenario.id, scenario.plantId, scenario.name, JSON.stringify(scenario), now);

    this.appendEvent('scenario.saved', 'scenario', scenario.id, { plantId: scenario.plantId, name: scenario.name });
    return scenario;
  }

  getScenario(id: string): Scenario | undefined {
    const row = this.db.prepare('select * from scenarios where id = ?').get(id) as ScenarioRow | undefined;
    return row ? (JSON.parse(row.json) as Scenario) : undefined;
  }

  listScenarios(plantId?: string): ScenarioSummary[] {
    const rows = (plantId
      ? this.db.prepare('select id, plant_id, name, created_at from scenarios where plant_id = ? order by created_at desc, id asc').all(plantId)
      : this.db.prepare('select id, plant_id, name, created_at from scenarios order by created_at desc, id asc').all()) as Omit<ScenarioRow, 'json'>[];
    return rows.map((row) => ({ id: row.id, plantId: row.plant_id, name: row.name, createdAt: row.created_at }));
  }

  saveSchedule(schedule: Schedule): Schedule {
    if (!this.getPlant(schedule.plantId)) {
      throw new Error(`Cannot save schedule ${schedule.id}: plant ${schedule.plantId} does not exist.`);
    }
    if (!this.getScenario(schedule.scenarioId)) {
      throw new Error(`Cannot save schedule ${schedule.id}: scenario ${schedule.scenarioId} does not exist.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into schedules (id, plant_id, scenario_id, status, strategy, json, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           status = excluded.status,
           strategy = excluded.strategy,
           json = excluded.json`,
      )
      .run(schedule.id, schedule.plantId, schedule.scenarioId, schedule.status, schedule.strategy, JSON.stringify(schedule), now);

    this.appendEvent('schedule.saved', 'schedule', schedule.id, {
      plantId: schedule.plantId,
      scenarioId: schedule.scenarioId,
      status: schedule.status,
      strategy: schedule.strategy,
    });
    return schedule;
  }

  getSchedule(id: string): Schedule | undefined {
    const row = this.db.prepare('select * from schedules where id = ?').get(id) as ScheduleRow | undefined;
    return row ? (JSON.parse(row.json) as Schedule) : undefined;
  }

  listSchedules(scenarioId?: string): ScheduleSummary[] {
    const rows = (scenarioId
      ? this.db
          .prepare('select id, plant_id, scenario_id, status, strategy, created_at from schedules where scenario_id = ? order by created_at desc, id asc')
          .all(scenarioId)
      : this.db.prepare('select id, plant_id, scenario_id, status, strategy, created_at from schedules order by created_at desc, id asc').all()) as Omit<ScheduleRow, 'json'>[];
    return rows.map((row) => ({
      id: row.id,
      plantId: row.plant_id,
      scenarioId: row.scenario_id,
      status: row.status,
      strategy: row.strategy,
      createdAt: row.created_at,
    }));
  }

  appendEvent(type: string, entityType: string, entityId: string, payload: Record<string, unknown> = {}): StoreEvent {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('insert into events (type, entity_type, entity_id, payload, created_at) values (?, ?, ?, ?, ?)')
      .run(type, entityType, entityId, JSON.stringify(payload), now);
    return {
      id: Number(result.lastInsertRowid),
      type,
      entityType,
      entityId,
      payload,
      createdAt: now,
    };
  }

  listEvents(limit = 100): StoreEvent[] {
    const rows = this.db.prepare('select * from events order by id asc limit ?').all(limit) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  private initialize(): void {
    this.db.exec(`
      create table if not exists metadata (
        key text primary key,
        value text not null
      );

      create table if not exists plants (
        id text primary key,
        name text not null,
        version integer not null,
        json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists scenarios (
        id text primary key,
        plant_id text not null,
        name text not null,
        json text not null,
        created_at text not null
      );

      create table if not exists schedules (
        id text primary key,
        plant_id text not null,
        scenario_id text not null,
        status text not null,
        strategy text not null,
        json text not null,
        created_at text not null
      );

      create table if not exists events (
        id integer primary key autoincrement,
        type text not null,
        entity_type text not null,
        entity_id text not null,
        payload text not null,
        created_at text not null
      );
    `);

    this.db.prepare('insert or ignore into metadata (key, value) values (?, ?)').run('schema_version', '1');
    this.appendEvent('store.initialized', 'store', 'local', { schemaVersion: 1 });
  }
}

export class StoreValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = 'StoreValidationError';
  }
}
