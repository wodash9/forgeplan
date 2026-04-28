import type { Plant, PlantNode } from '../domain/types.js';

export function createDemoPlant(): Plant {
  return {
    id: 'plant_demo_ui',
    name: 'ForgePlan Demo Plant',
    version: 1,
    timeHorizon: 480,
    timeUnit: 'minute',
    materials: [
      {
        id: 'mat_feed',
        name: 'Feed Product',
        unit: 'kg',
        compatibilityTags: ['feed'],
      },
    ],
    nodes: [
      createNode('node_source', 'Raw Input', 'source', 60, 140),
      createNode('node_mixer', 'Mixer 1', 'mixer', 300, 140, { capacity: 100, processingTime: 30 }),
      createNode('node_dispatch', 'Dispatch', 'dispatch', 560, 140),
    ],
    connections: [
      {
        id: 'conn_source_mixer',
        sourceNodeId: 'node_source',
        targetNodeId: 'node_mixer',
        materialTypes: ['mat_feed'],
        capacity: 100,
        transportTime: 0,
        enabled: true,
      },
      {
        id: 'conn_mixer_dispatch',
        sourceNodeId: 'node_mixer',
        targetNodeId: 'node_dispatch',
        materialTypes: ['mat_feed'],
        capacity: 100,
        transportTime: 5,
        enabled: true,
      },
    ],
    orders: [
      {
        id: 'order_1',
        materialId: 'mat_feed',
        quantity: 80,
        dueTime: 240,
        priority: 1,
      },
    ],
  };
}

export function createNode(
  id: string,
  name: string,
  type: PlantNode['type'],
  x: number,
  y: number,
  overrides: Partial<PlantNode> = {},
): PlantNode {
  return {
    id,
    name,
    type,
    position: { x, y },
    compatibleMaterials: ['mat_feed'],
    metadata: {},
    ...overrides,
  };
}
