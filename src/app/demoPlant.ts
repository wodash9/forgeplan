import type { Connection, Plant, PlantNode } from '../domain/types.js';

const feedMaterialId = 'mat_feed';

export function createDemoPlant(): Plant {
  return {
    id: 'plant_pfg_feed_production',
    name: 'PFG Feed Production Plant',
    version: 1,
    timeHorizon: 960,
    timeUnit: 'minute',
    materials: [
      {
        id: feedMaterialId,
        name: 'Feed product flow',
        unit: 'kg',
        family: 'Animal feed',
        compatibilityTags: ['feed', 'pfg', 'intermediate', 'finished'],
      },
    ],
    products: [
      {
        id: 'prod_feed_premix',
        name: 'Feed Premix',
        sku: 'PREMIX-BASE',
        unit: 'kg',
        family: 'Intermediate dosed meal',
        materialId: feedMaterialId,
        properties: { source: 'PFG dosification output', form: 'meal' },
        components: [],
      },
      {
        id: 'prod_vitamin_pack',
        name: 'Vitamin Pack',
        sku: 'VIT-PACK',
        unit: 'kg',
        family: 'Additive',
        properties: { dosage: '2%', storage: 'dry' },
        components: [],
      },
      {
        id: 'prod_complete_feed',
        name: 'Complete Feed',
        sku: 'FEED-COMPLETE',
        unit: 'kg',
        family: 'Finished pellet feed',
        materialId: feedMaterialId,
        properties: { source: 'PFG granulation output', format: 'pellet' },
        components: [
          { productId: 'prod_feed_premix', quantity: 80 },
          { productId: 'prod_vitamin_pack', quantity: 2 },
        ],
      },
    ],
    nodes: [
      createNode('node_raw_supply', 'Raw material availability', 'source', 40, 280, {
        metadata: {
          isaTag: 'SRC',
          pfgStage: 'raw_material_assumption',
          pfgReference: 'PFG chapter 6.2: raw material management is simplified as always available.',
        },
      }),
      createNode('node_dosing_line', 'Línia Dosificació LD', 'line', 260, 280, {
        capacity: 120,
        processingTime: 45,
        productionMode: 'batch',
        metadata: {
          isaTag: 'LD',
          pfgStage: 'dosification',
          pfgReference: 'PFG figure 6.1 and chapter 6.3: one multi-level batch dosification line.',
          levels: '5',
        },
      }),
      createNode('node_intermediate_silo_1', 'Sitja Intermèdia SI-1', 'silo', 520, 80, {
        capacity: 500,
        metadata: { isaTag: 'SI-1', pfgStage: 'intermediate_storage', storageGroup: 'MI-A' },
      }),
      createNode('node_intermediate_silo_2', 'Sitja Intermèdia SI-2', 'silo', 520, 210, {
        capacity: 500,
        metadata: { isaTag: 'SI-2', pfgStage: 'intermediate_storage', storageGroup: 'MI-A' },
      }),
      createNode('node_intermediate_silo_3', 'Sitja Intermèdia SI-3', 'silo', 520, 350, {
        capacity: 500,
        metadata: { isaTag: 'SI-3', pfgStage: 'intermediate_storage', storageGroup: 'MI-B' },
      }),
      createNode('node_intermediate_silo_4', 'Sitja Intermèdia SI-4', 'silo', 520, 480, {
        capacity: 500,
        metadata: { isaTag: 'SI-4', pfgStage: 'intermediate_storage', storageGroup: 'MI-B' },
      }),
      createNode('node_granulation_line_1', 'Línia Granulació LG-1', 'line', 790, 190, {
        capacity: 80,
        processingTime: 60,
        productionMode: 'continuous',
        metadata: {
          isaTag: 'LG-1',
          pfgStage: 'granulation',
          pfgReference: 'PFG chapter 6.3: continuous, single-level granulation lines assigned to intermediate storage.',
        },
      }),
      createNode('node_granulation_line_2', 'Línia Granulació LG-2', 'line', 790, 390, {
        capacity: 70,
        processingTime: 70,
        productionMode: 'continuous',
        metadata: {
          isaTag: 'LG-2',
          pfgStage: 'granulation',
          pfgReference: 'PFG chapter 6.3: K parametrizable granulation lines.',
        },
      }),
      createNode('node_final_silo_1', 'Sitja Final SF-1', 'silo', 1050, 120, {
        capacity: 800,
        metadata: { isaTag: 'SF-1', pfgStage: 'final_storage' },
      }),
      createNode('node_final_silo_2', 'Sitja Final SF-2', 'silo', 1050, 280, {
        capacity: 800,
        metadata: { isaTag: 'SF-2', pfgStage: 'final_storage' },
      }),
      createNode('node_final_silo_3', 'Sitja Final SF-3', 'silo', 1050, 440, {
        capacity: 800,
        metadata: { isaTag: 'SF-3', pfgStage: 'final_storage' },
      }),
      createNode('node_expedition_line_1', 'Línia Expedició LE-1', 'line', 1320, 200, {
        capacity: 120,
        processingTime: 20,
        productionMode: 'continuous',
        metadata: {
          isaTag: 'LE-1',
          pfgStage: 'expedition',
          pfgReference: 'PFG chapter 6.3: continuous expedition lines load trucks from assigned final silos.',
        },
      }),
      createNode('node_expedition_line_2', 'Línia Expedició LE-2', 'line', 1320, 370, {
        capacity: 120,
        processingTime: 20,
        productionMode: 'continuous',
        metadata: {
          isaTag: 'LE-2',
          pfgStage: 'expedition',
          pfgReference: 'PFG figure 6.1: T parametrizable expedition lines.',
        },
      }),
      createNode('node_truck_pickup', 'Truck pickup / dispatch', 'dispatch', 1540, 280, {
        metadata: {
          isaTag: 'TRK',
          pfgStage: 'truck_loading',
          pfgReference: 'PFG chapter 6.2: trucks are assumed always available with constant loading time.',
        },
      }),
    ],
    connections: [
      createConnection('conn_raw_ld', 'node_raw_supply', 'node_dosing_line', 120, 0),
      createConnection('conn_ld_si1', 'node_dosing_line', 'node_intermediate_silo_1', 120, 5),
      createConnection('conn_ld_si2', 'node_dosing_line', 'node_intermediate_silo_2', 120, 5),
      createConnection('conn_ld_si3', 'node_dosing_line', 'node_intermediate_silo_3', 120, 5),
      createConnection('conn_ld_si4', 'node_dosing_line', 'node_intermediate_silo_4', 120, 5),
      createConnection('conn_si1_lg1', 'node_intermediate_silo_1', 'node_granulation_line_1', 80, 2),
      createConnection('conn_si2_lg1', 'node_intermediate_silo_2', 'node_granulation_line_1', 80, 2),
      createConnection('conn_si3_lg2', 'node_intermediate_silo_3', 'node_granulation_line_2', 70, 2),
      createConnection('conn_si4_lg2', 'node_intermediate_silo_4', 'node_granulation_line_2', 70, 2),
      createConnection('conn_lg1_sf1', 'node_granulation_line_1', 'node_final_silo_1', 80, 3),
      createConnection('conn_lg1_sf2', 'node_granulation_line_1', 'node_final_silo_2', 80, 3),
      createConnection('conn_lg1_sf3', 'node_granulation_line_1', 'node_final_silo_3', 80, 3),
      createConnection('conn_lg2_sf1', 'node_granulation_line_2', 'node_final_silo_1', 70, 3),
      createConnection('conn_lg2_sf2', 'node_granulation_line_2', 'node_final_silo_2', 70, 3),
      createConnection('conn_lg2_sf3', 'node_granulation_line_2', 'node_final_silo_3', 70, 3),
      createConnection('conn_sf1_le1', 'node_final_silo_1', 'node_expedition_line_1', 120, 2),
      createConnection('conn_sf2_le1', 'node_final_silo_2', 'node_expedition_line_1', 120, 2),
      createConnection('conn_sf3_le2', 'node_final_silo_3', 'node_expedition_line_2', 120, 2),
      createConnection('conn_le1_dispatch', 'node_expedition_line_1', 'node_truck_pickup', 120, 0),
      createConnection('conn_le2_dispatch', 'node_expedition_line_2', 'node_truck_pickup', 120, 0),
    ],
    orders: [
      {
        id: 'order_1',
        materialId: feedMaterialId,
        quantity: 80,
        dueTime: 420,
        priority: 1,
        minStartQuantity: 20,
      },
      {
        id: 'order_2',
        materialId: feedMaterialId,
        quantity: 120,
        dueTime: 600,
        priority: 2,
        minStartQuantity: 30,
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
    compatibleMaterials: [feedMaterialId],
    metadata: {},
    ...overrides,
  };
}

function createConnection(id: string, sourceNodeId: string, targetNodeId: string, capacity: number, transportTime: number): Connection {
  return {
    id,
    sourceNodeId,
    targetNodeId,
    materialTypes: [feedMaterialId],
    capacity,
    transportTime,
    enabled: true,
  };
}
