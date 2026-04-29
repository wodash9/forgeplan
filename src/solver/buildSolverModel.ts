import type { Connection, Plant, PlantNode, Scenario } from '../domain/types.js';
import type { SolverModel, SolverObjective, SolverOperation, SolverPrecedence, SolverResource } from './types.js';

const PROCESSING_NODE_TYPES = new Set<PlantNode['type']>(['machine', 'mixer', 'reactor', 'line', 'packaging', 'custom']);

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
  };
}

function toSolverResource(node: PlantNode): SolverResource {
  return {
    id: `res_${node.id}`,
    nodeId: node.id,
    name: node.name,
    capacity: Math.max(1, Math.ceil(node.capacity ?? 1)),
  };
}

function isProcessingNode(node: PlantNode): boolean {
  return PROCESSING_NODE_TYPES.has(node.type);
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
