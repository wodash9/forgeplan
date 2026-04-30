import type { Connection, Plant, PlantNode, ProductionMode, Scenario } from '../domain/types.js';
import type {
  PfgConnection,
  PfgConstraintCoverage,
  PfgFlowModel,
  PfgProcessingResource,
  PfgStorageResource,
  SolverModel,
  SolverObjective,
  SolverOperation,
  SolverPrecedence,
  SolverResource,
} from './types.js';

const PROCESSING_NODE_TYPES = new Set<PlantNode['type']>(['machine', 'mixer', 'reactor', 'line', 'packaging', 'custom']);

const PFG_CONSTRAINT_COVERAGE: PfgConstraintCoverage[] = [
  'batch_splitting',
  'dosing_phase_precedence',
  'dosing_level_no_overlap',
  'within_order_batch_symmetry',
  'dosing_changeover',
  'intermediate_silo_assignment',
  'intermediate_silo_no_mixing',
  'intermediate_inventory_reservoir',
  'granulator_assignment',
  'granulator_no_overlap',
  'granulator_changeover',
  'final_silo_assignment',
  'final_silo_no_mixing',
  'final_inventory_reservoir',
  'dispatch_assignment',
  'dispatch_no_overlap',
  'dispatch_changeover',
  'tardiness_late_orders_makespan',
  'on_time_implication_cuts',
  'due_date_capacity_cuts',
  'restricted_due_dominance',
];

export interface BuildSolverModelOptions {
  objective?: SolverObjective | undefined;
}

export function buildSolverModel(plant: Plant, scenario: Scenario, options: BuildSolverModelOptions = {}): SolverModel {
  const resources = plant.nodes.filter(isProcessingNode).map(toSolverResource);
  const resourceByNodeId = new Map(resources.map((resource) => [resource.nodeId, resource]));
  const operations: SolverOperation[] = [];
  const precedences: SolverPrecedence[] = [];

  for (const order of [...plant.orders].sort((a, b) => a.priority - b.priority || a.dueTime - b.dueTime || a.id.localeCompare(b.id))) {
    const route = findRouteForOrder(plant, order.materialId);
    const routeOperations: SolverOperation[] = [];

    for (const node of route.filter(isProcessingNode)) {
      const resource = resourceByNodeId.get(node.id);
      if (!resource) continue;
      const operation: SolverOperation = {
        id: `op_${order.id}_${node.id}`,
        orderId: order.id,
        nodeId: node.id,
        resourceId: resource.id,
        materialId: order.materialId,
        duration: Math.max(1, Math.ceil(node.processingTime ?? estimateDuration(order.quantity, resource.capacity))),
        quantity: order.quantity,
      };
      routeOperations.push(operation);
      operations.push(operation);
    }

    for (let index = 1; index < routeOperations.length; index += 1) {
      const before = routeOperations[index - 1];
      const after = routeOperations[index];
      if (!before || !after) continue;
      precedences.push({
        beforeOperationId: before.id,
        afterOperationId: after.id,
        type: 'route_sequence',
      });
    }
  }

  const pfgFlow = buildPfgFlowModel(plant);

  return {
    id: `solver_model_${plant.id}_${scenario.id}`,
    plantId: plant.id,
    scenarioId: scenario.id,
    horizon: plant.timeHorizon,
    timeUnit: plant.timeUnit,
    resources,
    operations,
    precedences,
    orders: plant.orders.map((order) => ({
      id: order.id,
      materialId: order.materialId,
      quantity: order.quantity,
      dueTime: order.dueTime,
      priority: order.priority,
      earliestStart: order.earliestStart ?? 0,
    })),
    objective: options.objective ?? 'minimize_makespan',
    ...(pfgFlow ? { pfgFlow } : {}),
  };
}

function toSolverResource(node: PlantNode): SolverResource {
  return {
    id: `res_${node.id}`,
    nodeId: node.id,
    name: node.name,
    capacity: Math.max(1, Math.ceil(node.capacity ?? 1)),
    productionMode: node.productionMode ?? defaultProductionMode(node.type),
  };
}

function isProcessingNode(node: PlantNode): boolean {
  return PROCESSING_NODE_TYPES.has(node.type);
}

function defaultProductionMode(type: PlantNode['type']): ProductionMode {
  return type === 'line' ? 'continuous' : 'batch';
}

function estimateDuration(quantity: number, capacity: number): number {
  return Math.ceil(quantity / Math.max(1, capacity));
}

function findRouteForOrder(plant: Plant, materialId: string): PlantNode[] {
  const nodesById = new Map(plant.nodes.map((node) => [node.id, node]));
  const enabledConnections = plant.connections.filter((connection) => connection.enabled && supportsMaterial(connection, materialId));
  const outgoing = new Map<string, Connection[]>();

  for (const connection of enabledConnections) {
    const current = outgoing.get(connection.sourceNodeId) ?? [];
    current.push(connection);
    outgoing.set(connection.sourceNodeId, current);
  }

  const sources = plant.nodes.filter((node) => node.type === 'source' && nodeSupportsMaterial(node, materialId));
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; path: string[] }> = sources.map((node) => ({ nodeId: node.id, path: [node.id] }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    const node = nodesById.get(current.nodeId);
    if (node && (node.type === 'dispatch' || node.type === 'sink') && current.path.length > 1) {
      return current.path.map((nodeId) => nodesById.get(nodeId)).filter((item): item is PlantNode => Boolean(item));
    }

    for (const connection of outgoing.get(current.nodeId) ?? []) {
      const target = nodesById.get(connection.targetNodeId);
      if (!target || !nodeSupportsMaterial(target, materialId)) continue;
      queue.push({ nodeId: target.id, path: [...current.path, target.id] });
    }
  }

  return [];
}

function nodeSupportsMaterial(node: PlantNode, materialId: string): boolean {
  return !node.compatibleMaterials || node.compatibleMaterials.length === 0 || node.compatibleMaterials.includes(materialId);
}

function supportsMaterial(connection: Connection, materialId: string): boolean {
  return !connection.materialTypes || connection.materialTypes.length === 0 || connection.materialTypes.includes(materialId);
}

function buildPfgFlowModel(plant: Plant): PfgFlowModel | undefined {
  const dosingLine = plant.nodes.find((node) => pfgStage(node) === 'dosification');
  const intermediateSilos = plant.nodes.filter((node) => pfgStage(node) === 'intermediate_storage');
  const granulators = plant.nodes.filter((node) => pfgStage(node) === 'granulation');
  const finalSilos = plant.nodes.filter((node) => pfgStage(node) === 'final_storage');
  const dispatchLines = plant.nodes.filter((node) => pfgStage(node) === 'expedition');

  if (!dosingLine || intermediateSilos.length === 0 || granulators.length === 0 || finalSilos.length === 0 || dispatchLines.length === 0) {
    return undefined;
  }

  const batchSize = Math.max(1, numberMetadata(dosingLine, 'batchSize') ?? Math.ceil(dosingLine.capacity ?? 1));
  const dosingLevels = Math.max(1, Math.ceil(numberMetadata(dosingLine, 'levels') ?? 1));
  const batches = plant.orders.flatMap((order) => splitOrderIntoBatches(order.id, order.materialId, order.quantity, batchSize));

  return {
    batchSize,
    dosingLevels,
    dosingLine: toPfgProcessingResource(dosingLine),
    intermediateSilos: intermediateSilos.map((node) => toPfgStorageResource(node, minIncomingTransportTime(plant, dosingLine.id, node.id))),
    granulators: granulators.map(toPfgProcessingResource),
    finalSilos: finalSilos.map((node) => toPfgStorageResource(node, minIncomingTransportTimeFromAny(plant, granulators.map((item) => item.id), node.id))),
    dispatchLines: dispatchLines.map(toPfgProcessingResource),
    batches,
    orderRequirements: plant.orders.map((order) => ({
      orderId: order.id,
      materialId: order.materialId,
      quantity: order.quantity,
      minStartQuantity: Math.max(1, Math.min(order.quantity, Math.ceil(order.minStartQuantity ?? order.quantity))),
      dueTime: order.dueTime,
      earliestStart: order.earliestStart ?? 0,
    })),
    dosingLineToIntermediateSilos: stageConnections(plant, [dosingLine], intermediateSilos),
    intermediateToGranulators: stageConnections(plant, intermediateSilos, granulators),
    granulatorToFinalSilos: stageConnections(plant, granulators, finalSilos),
    finalSiloToDispatchLines: stageConnections(plant, finalSilos, dispatchLines),
    cleanoutTime: numberMetadata(dosingLine, 'cleanoutTime') ?? 5,
    granulatorSetupTime: maxMetadata(granulators, 'setupTime') ?? 5,
    dispatchSetupTime: maxMetadata(dispatchLines, 'setupTime') ?? 5,
    constraintCoverage: PFG_CONSTRAINT_COVERAGE,
  };
}

function pfgStage(node: PlantNode): string | undefined {
  return typeof node.metadata.pfgStage === 'string' ? node.metadata.pfgStage : undefined;
}

function numberMetadata(node: PlantNode, key: string): number | undefined {
  const value = node.metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function maxMetadata(nodes: PlantNode[], key: string): number | undefined {
  const values = nodes.map((node) => numberMetadata(node, key)).filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function toPfgProcessingResource(node: PlantNode): PfgProcessingResource {
  return {
    id: `res_${node.id}`,
    nodeId: node.id,
    name: node.name,
    capacity: Math.max(1, Math.ceil(node.capacity ?? 1)),
    compatibleMaterials: node.compatibleMaterials ?? [],
    processingTime: Math.max(1, Math.ceil(node.processingTime ?? 1)),
    productionMode: node.productionMode ?? defaultProductionMode(node.type),
  };
}

function toPfgStorageResource(node: PlantNode, transferTime: number): PfgStorageResource {
  const initialQuantity = numberMetadata(node, 'initialQuantity') ?? 0;
  const initialMaterial = node.metadata.initialMaterialId;
  return {
    id: `res_${node.id}`,
    nodeId: node.id,
    name: node.name,
    capacity: Math.max(1, Math.ceil(node.capacity ?? 1)),
    compatibleMaterials: node.compatibleMaterials ?? [],
    transferTime: Math.max(0, Math.ceil(transferTime)),
    initialQuantity: Math.max(0, Math.ceil(initialQuantity)),
    ...(typeof initialMaterial === 'string' ? { initialMaterialId: initialMaterial } : {}),
  };
}

function splitOrderIntoBatches(orderId: string, materialId: string, quantity: number, batchSize: number) {
  const batches = [];
  let remaining = Math.max(0, Math.ceil(quantity));
  let index = 1;
  while (remaining > 0) {
    const batchQuantity = Math.min(batchSize, remaining);
    batches.push({ id: `batch_${orderId}_${index}`, orderId, materialId, index, quantity: batchQuantity });
    remaining -= batchQuantity;
    index += 1;
  }
  return batches;
}

function stageConnections(plant: Plant, sources: PlantNode[], targets: PlantNode[]): PfgConnection[] {
  const sourceIds = new Set(sources.map((node) => node.id));
  const targetIds = new Set(targets.map((node) => node.id));
  return plant.connections
    .filter((connection) => connection.enabled && sourceIds.has(connection.sourceNodeId) && targetIds.has(connection.targetNodeId))
    .map((connection) => ({
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      transportTime: Math.max(0, Math.ceil(connection.transportTime ?? 0)),
    }));
}

function minIncomingTransportTime(plant: Plant, sourceNodeId: string, targetNodeId: string): number {
  const times = plant.connections
    .filter((connection) => connection.enabled && connection.sourceNodeId === sourceNodeId && connection.targetNodeId === targetNodeId)
    .map((connection) => connection.transportTime ?? 0);
  return times.length > 0 ? Math.min(...times) : 0;
}

function minIncomingTransportTimeFromAny(plant: Plant, sourceNodeIds: string[], targetNodeId: string): number {
  const sourceSet = new Set(sourceNodeIds);
  const times = plant.connections
    .filter((connection) => connection.enabled && sourceSet.has(connection.sourceNodeId) && connection.targetNodeId === targetNodeId)
    .map((connection) => connection.transportTime ?? 0);
  return times.length > 0 ? Math.min(...times) : 0;
}
