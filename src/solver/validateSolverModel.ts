import type { SolverIssue, SolverModel, SolverValidationResult } from './types.js';

export function validateSolverModel(model: SolverModel): SolverValidationResult {
  const issues: SolverIssue[] = [];
  const resourceIds = new Set(model.resources.map((resource) => resource.id));
  const operationIds = new Set(model.operations.map((operation) => operation.id));
  const orderIds = new Set(model.orders.map((order) => order.id));

  if (model.horizon <= 0) {
    issues.push({ severity: 'error', code: 'solver.horizon_invalid', message: 'Solver horizon must be greater than zero.', path: 'horizon' });
  }

  if (model.resources.length === 0) {
    issues.push({ severity: 'error', code: 'solver.no_resources', message: 'Solver model has no processing resources.', path: 'resources' });
  }

  if (model.operations.length === 0) {
    issues.push({ severity: 'error', code: 'solver.no_operations', message: 'Solver model has no operations to schedule.', path: 'operations' });
  }

  for (const resource of model.resources) {
    if (resource.capacity <= 0) {
      issues.push({
        severity: 'error',
        code: 'solver.resource_capacity_invalid',
        message: `Resource ${resource.id} must have positive capacity.`,
        path: `resources.${resource.id}.capacity`,
      });
    }
  }

  for (const operation of model.operations) {
    if (!resourceIds.has(operation.resourceId)) {
      issues.push({
        severity: 'error',
        code: 'solver.operation_unknown_resource',
        message: `Operation ${operation.id} references unknown resource ${operation.resourceId}.`,
        path: `operations.${operation.id}.resourceId`,
      });
    }
    if (!orderIds.has(operation.orderId)) {
      issues.push({
        severity: 'error',
        code: 'solver.operation_unknown_order',
        message: `Operation ${operation.id} references unknown order ${operation.orderId}.`,
        path: `operations.${operation.id}.orderId`,
      });
    }
    if (operation.duration <= 0) {
      issues.push({
        severity: 'error',
        code: 'solver.operation_duration_invalid',
        message: `Operation ${operation.id} must have positive duration.`,
        path: `operations.${operation.id}.duration`,
      });
    }
    if (operation.quantity <= 0) {
      issues.push({
        severity: 'error',
        code: 'solver.operation_quantity_invalid',
        message: `Operation ${operation.id} must have positive quantity.`,
        path: `operations.${operation.id}.quantity`,
      });
    }
  }

  for (const precedence of model.precedences) {
    if (!operationIds.has(precedence.beforeOperationId)) {
      issues.push({
        severity: 'error',
        code: 'solver.precedence_unknown_before',
        message: `Precedence references unknown before operation ${precedence.beforeOperationId}.`,
        path: `precedences.${precedence.beforeOperationId}`,
      });
    }
    if (!operationIds.has(precedence.afterOperationId)) {
      issues.push({
        severity: 'error',
        code: 'solver.precedence_unknown_after',
        message: `Precedence references unknown after operation ${precedence.afterOperationId}.`,
        path: `precedences.${precedence.afterOperationId}`,
      });
    }
  }

  for (const order of model.orders) {
    if (order.quantity <= 0) {
      issues.push({ severity: 'error', code: 'solver.order_quantity_invalid', message: `Order ${order.id} must have positive quantity.`, path: `orders.${order.id}.quantity` });
    }
    if (order.dueTime < 0) {
      issues.push({ severity: 'error', code: 'solver.order_due_time_invalid', message: `Order ${order.id} must have non-negative due time.`, path: `orders.${order.id}.dueTime` });
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}
