import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createEmptyPlant, createScenario, plantSchema, validatePlant } from '../src/index.js';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', name), 'utf8'));
}

describe('ForgePlan domain kernel', () => {
  it('accepts the minimal valid plant fixture', () => {
    const fixture = readFixture('minimal-valid-plant.json');
    const parsed = plantSchema.safeParse(fixture);
    const result = validatePlant(fixture);

    expect(parsed.success).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
  });

  it('reports blockers for the invalid fixture', () => {
    const result = validatePlant(readFixture('invalid-plant.json'));
    const codes = result.issues.map((issue) => issue.code);

    expect(result.status).toBe('not_ready');
    expect(codes).toContain('schema.invalid');
  });

  it('detects missing materials and orders in an otherwise shaped plant', () => {
    const result = validatePlant(createEmptyPlant());
    const codes = result.issues.map((issue) => issue.code);

    expect(result.status).toBe('not_ready');
    expect(codes).toContain('plant.no_materials');
    expect(codes).toContain('plant.no_orders');
  });

  it('detects orders that reference unknown materials', () => {
    const plant = createEmptyPlant({
      materials: [{ id: 'mat_a', name: 'A', unit: 'kg', compatibilityTags: [] }],
      orders: [{ id: 'order_1', materialId: 'mat_missing', quantity: 10, dueTime: 100, priority: 1 }],
    });

    const result = validatePlant(plant);
    expect(result.issues.map((issue) => issue.code)).toContain('order.unknown_material');
  });

  it('detects connections with missing nodes', () => {
    const plant = createEmptyPlant({
      materials: [{ id: 'mat_a', name: 'A', unit: 'kg', compatibilityTags: [] }],
      nodes: [{ id: 'node_a', name: 'A', type: 'source', position: { x: 0, y: 0 }, metadata: {} }],
      connections: [{ id: 'conn_1', sourceNodeId: 'node_a', targetNodeId: 'node_missing', enabled: true }],
      orders: [{ id: 'order_1', materialId: 'mat_a', quantity: 10, dueTime: 100, priority: 1 }],
    });

    const result = validatePlant(plant);
    expect(result.issues.map((issue) => issue.code)).toContain('connection.unknown_target');
  });

  it('detects orders without a possible source-to-dispatch route', () => {
    const plant = createEmptyPlant({
      materials: [{ id: 'mat_a', name: 'A', unit: 'kg', compatibilityTags: [] }],
      nodes: [
        { id: 'source', name: 'Source', type: 'source', position: { x: 0, y: 0 }, compatibleMaterials: ['mat_a'], metadata: {} },
        { id: 'dispatch', name: 'Dispatch', type: 'dispatch', position: { x: 200, y: 0 }, compatibleMaterials: ['mat_a'], metadata: {} },
      ],
      connections: [],
      orders: [{ id: 'order_1', materialId: 'mat_a', quantity: 10, dueTime: 100, priority: 1 }],
    });

    const result = validatePlant(plant);
    expect(result.status).toBe('not_ready');
    expect(result.issues.map((issue) => issue.code)).toContain('order.no_route');
  });

  it('creates a baseline scenario for a plant', () => {
    const plant = plantSchema.parse(readFixture('minimal-valid-plant.json'));
    const scenario = createScenario(plant);

    expect(scenario.plantId).toBe(plant.id);
    expect(scenario.plantVersion).toBe(plant.version);
    expect(scenario.solverSettings.strategy).toBe('mock');
  });
});
