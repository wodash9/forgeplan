import { plantSchema } from '../schema/plantSchema.js';
import type { Plant, PlantNode, ValidationIssue, ValidationResult } from '../domain/types.js';

export function validatePlant(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = plantSchema.safeParse(input);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        severity: 'error',
        code: 'schema.invalid',
        message: issue.message,
        path: issue.path.join('.'),
      });
    }
    return toResult(issues);
  }

  const plant = parsed.data;
  issues.push(...validateDomain(plant));
  return toResult(issues);
}

function validateDomain(plant: Plant): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const materialIds = new Set(plant.materials.map((material) => material.id));
  const nodeIds = new Set(plant.nodes.map((node) => node.id));

  if (plant.materials.length === 0) {
    issues.push(error('plant.no_materials', 'Plant must define at least one material.', 'materials'));
  }

  if (plant.orders.length === 0) {
    issues.push(error('plant.no_orders', 'Plant must define at least one order before solving.', 'orders'));
  }

  for (const order of plant.orders) {
    if (!materialIds.has(order.materialId)) {
      issues.push(
        error(
          'order.unknown_material',
          `Order ${order.id} references unknown material ${order.materialId}.`,
          `orders.${order.id}.materialId`,
        ),
      );
    }
  }

  for (const node of plant.nodes) {
    if (node.capacity !== undefined && node.capacity <= 0) {
      issues.push(error('node.invalid_capacity', `Node ${node.id} must have positive capacity.`, `nodes.${node.id}.capacity`));
    }
    if (node.processingTime !== undefined && node.processingTime <= 0) {
      issues.push(
        error('node.invalid_processing_time', `Node ${node.id} must have positive processing time.`, `nodes.${node.id}.processingTime`),
      );
    }
  }

  for (const connection of plant.connections) {
    if (!nodeIds.has(connection.sourceNodeId)) {
      issues.push(
        error(
          'connection.unknown_source',
          `Connection ${connection.id} references unknown source node ${connection.sourceNodeId}.`,
          `connections.${connection.id}.sourceNodeId`,
        ),
      );
    }
    if (!nodeIds.has(connection.targetNodeId)) {
      issues.push(
        error(
          'connection.unknown_target',
          `Connection ${connection.id} references unknown target node ${connection.targetNodeId}.`,
          `connections.${connection.id}.targetNodeId`,
        ),
      );
    }
    if (connection.sourceNodeId === connection.targetNodeId) {
      issues.push(error('connection.self_loop', `Connection ${connection.id} cannot connect a node to itself.`, `connections.${connection.id}`));
    }
  }

  for (const order of plant.orders) {
    if (materialIds.has(order.materialId) && !hasRouteForMaterial(plant.nodes, plant.connections, order.materialId)) {
      issues.push(
        error(
          'order.no_route',
          `Order ${order.id} has no possible route for material ${order.materialId}.`,
          `orders.${order.id}`,
        ),
      );
    }
  }

  if (plant.nodes.length > 0 && !plant.nodes.some((node) => node.type === 'source')) {
    issues.push(warning('plant.no_source', 'Plant has no source node; material availability may be undefined.', 'nodes'));
  }

  if (plant.nodes.length > 0 && !plant.nodes.some((node) => node.type === 'dispatch' || node.type === 'sink')) {
    issues.push(warning('plant.no_dispatch', 'Plant has no dispatch/sink node; completion may be ambiguous.', 'nodes'));
  }

  return issues;
}

function hasRouteForMaterial(nodes: PlantNode[], connections: Plant['connections'], materialId: string): boolean {
  const compatibleNodeIds = new Set(
    nodes
      .filter((node) => node.compatibleMaterials === undefined || node.compatibleMaterials.includes(materialId))
      .map((node) => node.id),
  );

  const sourceIds = nodes.filter((node) => node.type === 'source' && compatibleNodeIds.has(node.id)).map((node) => node.id);
  const sinkIds = new Set(
    nodes
      .filter((node) => (node.type === 'dispatch' || node.type === 'sink') && compatibleNodeIds.has(node.id))
      .map((node) => node.id),
  );

  if (sourceIds.length === 0 || sinkIds.size === 0) {
    return false;
  }

  const adjacency = new Map<string, string[]>();
  for (const connection of connections) {
    if (!connection.enabled) continue;
    if (!compatibleNodeIds.has(connection.sourceNodeId) || !compatibleNodeIds.has(connection.targetNodeId)) continue;
    if (connection.materialTypes !== undefined && !connection.materialTypes.includes(materialId)) continue;
    const targets = adjacency.get(connection.sourceNodeId) ?? [];
    targets.push(connection.targetNodeId);
    adjacency.set(connection.sourceNodeId, targets);
  }

  const queue = [...sourceIds];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (sinkIds.has(current)) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

function toResult(issues: ValidationIssue[]): ValidationResult {
  if (issues.some((issue) => issue.severity === 'error')) {
    return { status: 'not_ready', issues };
  }
  if (issues.some((issue) => issue.severity === 'warning')) {
    return { status: 'ready_with_warnings', issues };
  }
  return { status: 'ready', issues };
}

function error(code: string, message: string, path?: string): ValidationIssue {
  return { severity: 'error', code, message, path };
}

function warning(code: string, message: string, path?: string): ValidationIssue {
  return { severity: 'warning', code, message, path };
}
