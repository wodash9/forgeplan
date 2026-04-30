import type { Schedule, ScheduleStatus, TimeUnit, ProductionMode } from '../domain/types.js';

export type SolverObjective = 'minimize_makespan' | 'minimize_total_tardiness';

export interface SolverResource {
  id: string;
  nodeId: string;
  name: string;
  capacity: number;
  productionMode: ProductionMode;
}

export interface SolverOperation {
  id: string;
  orderId: string;
  nodeId: string;
  resourceId: string;
  materialId: string;
  duration: number;
  quantity: number;
}

export interface SolverPrecedence {
  beforeOperationId: string;
  afterOperationId: string;
  type: 'route_sequence';
}

export interface SolverOrder {
  id: string;
  materialId: string;
  quantity: number;
  dueTime: number;
  priority: number;
  earliestStart: number;
}

export interface SolverModel {
  id: string;
  plantId: string;
  scenarioId: string;
  horizon: number;
  timeUnit: TimeUnit;
  resources: SolverResource[];
  operations: SolverOperation[];
  precedences: SolverPrecedence[];
  orders: SolverOrder[];
  objective: SolverObjective;
}

export type SolverIssueSeverity = 'error' | 'warning';

export interface SolverIssue {
  severity: SolverIssueSeverity;
  code: string;
  message: string;
  path?: string | undefined;
}

export interface SolverValidationResult {
  valid: boolean;
  issues: SolverIssue[];
}

export interface SolverOptions {
  timeLimitSeconds?: number | undefined;
  workers?: number | undefined;
}

export interface SolverResult {
  status: ScheduleStatus;
  schedule: Schedule;
  issues: SolverIssue[];
}

export interface SolverAdapter {
  name: string;
  solve(model: SolverModel, options?: SolverOptions): SolverResult;
}
