import { z } from 'zod';

export const timeUnitSchema = z.enum(['minute', 'hour', 'day']);

export const nodeTypeSchema = z.enum([
  'source',
  'machine',
  'mixer',
  'reactor',
  'tank',
  'buffer',
  'silo',
  'line',
  'packaging',
  'dispatch',
  'sink',
  'custom',
]);

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const materialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  family: z.string().min(1).optional(),
  compatibilityTags: z.array(z.string().min(1)).default([]),
});

export const plantNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: nodeTypeSchema,
  position: positionSchema,
  capacity: z.number().positive().optional(),
  processingTime: z.number().positive().optional(),
  compatibleMaterials: z.array(z.string().min(1)).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const connectionSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  materialTypes: z.array(z.string().min(1)).optional(),
  capacity: z.number().positive().optional(),
  transportTime: z.number().nonnegative().optional(),
  enabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export const orderSchema = z.object({
  id: z.string().min(1),
  materialId: z.string().min(1),
  quantity: z.number().positive(),
  dueTime: z.number().nonnegative(),
  priority: z.number().int().positive().default(1),
  earliestStart: z.number().nonnegative().optional(),
  minStartQuantity: z.number().positive().optional(),
});

export const plantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  timeHorizon: z.number().positive(),
  timeUnit: timeUnitSchema,
  materials: z.array(materialSchema),
  nodes: z.array(plantNodeSchema),
  connections: z.array(connectionSchema),
  orders: z.array(orderSchema),
});

export const solverStrategySchema = z.enum(['mock', 'cp_sat', 'heuristic', 'decomposed', 'monolithic', 'lexicographic']);

export const solverSettingsSchema = z.object({
  strategy: solverStrategySchema,
  timeLimitSeconds: z.number().positive(),
  workers: z.number().int().positive(),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  plantId: z.string().min(1),
  name: z.string().min(1),
  plantVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  solverSettings: solverSettingsSchema,
});

export const scheduleStatusSchema = z.enum(['optimal', 'feasible', 'infeasible', 'unknown', 'error']);

export const scheduledOperationSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  nodeId: z.string().min(1),
  materialId: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  quantity: z.number().positive(),
}).refine((operation) => operation.end >= operation.start, {
  message: 'Operation end must be greater than or equal to start.',
  path: ['end'],
});

export const scheduleSchema = z.object({
  id: z.string().min(1),
  plantId: z.string().min(1),
  scenarioId: z.string().min(1),
  status: scheduleStatusSchema,
  strategy: solverStrategySchema,
  operations: z.array(scheduledOperationSchema),
  kpis: z.object({
    lateOrders: z.number().int().nonnegative(),
    totalTardiness: z.number().nonnegative(),
    makespan: z.number().nonnegative(),
  }),
  violations: z.array(z.string()),
  explanations: z.array(z.string()),
});

export type PlantInput = z.infer<typeof plantSchema>;
export type ScenarioInput = z.infer<typeof scenarioSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
