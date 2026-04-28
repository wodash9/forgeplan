import type { Schedule, ScheduledOperation } from '../domain/types.js';
import type { SolverAdapter, SolverModel, SolverOperation, SolverResult } from './types.js';
import { validateSolverModel } from './validateSolverModel.js';

export class MockSolverAdapter implements SolverAdapter {
  readonly name = 'mock';

  solve(model: SolverModel): SolverResult {
    const validation = validateSolverModel(model);
    if (!validation.valid) {
      return {
        status: 'error',
        issues: validation.issues,
        schedule: emptySchedule(model, 'error', validation.issues.map((issue) => issue.message)),
      };
    }

    const scheduledOperations: ScheduledOperation[] = [];
    const resourceAvailableAt = new Map(model.resources.map((resource) => [resource.id, 0]));
    const operationEnd = new Map<string, number>();
    const operationsByOrder = groupOperationsByOrder(model.operations);

    for (const order of [...model.orders].sort((a, b) => a.priority - b.priority || a.dueTime - b.dueTime || a.id.localeCompare(b.id))) {
      let orderCursor = Math.max(0, order.earliestStart);
      const operations = operationsByOrder.get(order.id) ?? [];

      for (const operation of operations) {
        const predecessorEnd = model.precedences
          .filter((precedence) => precedence.afterOperationId === operation.id)
          .map((precedence) => operationEnd.get(precedence.beforeOperationId) ?? 0)
          .reduce((latest, end) => Math.max(latest, end), 0);
        const resourceCursor = resourceAvailableAt.get(operation.resourceId) ?? 0;
        const start = Math.max(orderCursor, predecessorEnd, resourceCursor);
        const end = start + operation.duration;

        scheduledOperations.push({
          id: `scheduled_${operation.id}`,
          orderId: operation.orderId,
          nodeId: operation.nodeId,
          materialId: operation.materialId,
          start,
          end,
          quantity: operation.quantity,
        });
        operationEnd.set(operation.id, end);
        resourceAvailableAt.set(operation.resourceId, end);
        orderCursor = end;
      }
    }

    const makespan = scheduledOperations.reduce((max, operation) => Math.max(max, operation.end), 0);
    const violations = makespan > model.horizon ? [`Schedule makespan ${makespan} exceeds horizon ${model.horizon}.`] : [];
    const totalTardiness = calculateTotalTardiness(model, scheduledOperations);
    const lateOrders = calculateLateOrders(model, scheduledOperations);
    const status = violations.length > 0 ? 'infeasible' : 'feasible';

    return {
      status,
      issues: validation.issues,
      schedule: {
        id: `schedule_${model.id}_mock`,
        plantId: model.plantId,
        scenarioId: model.scenarioId,
        status,
        strategy: 'mock',
        operations: scheduledOperations,
        kpis: {
          lateOrders,
          totalTardiness,
          makespan,
        },
        violations,
        explanations: [
          'Mock solver used deterministic order/resource sequencing only.',
          'This schedule is suitable for integration tests, not optimization decisions.',
        ],
      },
    };
  }
}

export const mockSolverAdapter = new MockSolverAdapter();

function groupOperationsByOrder(operations: SolverOperation[]): Map<string, SolverOperation[]> {
  const grouped = new Map<string, SolverOperation[]>();
  for (const operation of [...operations].sort((a, b) => a.id.localeCompare(b.id))) {
    const current = grouped.get(operation.orderId) ?? [];
    current.push(operation);
    grouped.set(operation.orderId, current);
  }
  return grouped;
}

function calculateLateOrders(model: SolverModel, operations: ScheduledOperation[]): number {
  return model.orders.filter((order) => completionForOrder(operations, order.id) > order.dueTime).length;
}

function calculateTotalTardiness(model: SolverModel, operations: ScheduledOperation[]): number {
  return model.orders.reduce((total, order) => total + Math.max(0, completionForOrder(operations, order.id) - order.dueTime), 0);
}

function completionForOrder(operations: ScheduledOperation[], orderId: string): number {
  return operations.filter((operation) => operation.orderId === orderId).reduce((latest, operation) => Math.max(latest, operation.end), 0);
}

function emptySchedule(model: SolverModel, status: Schedule['status'], violations: string[]): Schedule {
  return {
    id: `schedule_${model.id}_mock`,
    plantId: model.plantId,
    scenarioId: model.scenarioId,
    status,
    strategy: 'mock',
    operations: [],
    kpis: {
      lateOrders: 0,
      totalTardiness: 0,
      makespan: 0,
    },
    violations,
    explanations: ['Solver model validation failed before scheduling.'],
  };
}
