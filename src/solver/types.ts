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

export type PfgConstraintCoverage =
  | 'batch_splitting'
  | 'dosing_phase_precedence'
  | 'dosing_level_no_overlap'
  | 'within_order_batch_symmetry'
  | 'dosing_changeover'
  | 'intermediate_silo_assignment'
  | 'intermediate_silo_no_mixing'
  | 'intermediate_inventory_reservoir'
  | 'granulator_assignment'
  | 'granulator_no_overlap'
  | 'granulator_changeover'
  | 'final_silo_assignment'
  | 'final_silo_no_mixing'
  | 'final_inventory_reservoir'
  | 'dispatch_assignment'
  | 'dispatch_no_overlap'
  | 'dispatch_changeover'
  | 'tardiness_late_orders_makespan'
  | 'on_time_implication_cuts'
  | 'due_date_capacity_cuts'
  | 'restricted_due_dominance';

export interface PfgResource {
  id: string;
  nodeId: string;
  name: string;
  capacity: number;
  compatibleMaterials: string[];
}

export interface PfgProcessingResource extends PfgResource {
  processingTime: number;
  productionMode: ProductionMode;
}

export interface PfgStorageResource extends PfgResource {
  transferTime: number;
  initialQuantity: number;
  initialMaterialId?: string | undefined;
}

export interface PfgBatch {
  id: string;
  orderId: string;
  materialId: string;
  index: number;
  quantity: number;
}

export interface PfgOrderRequirement {
  orderId: string;
  materialId: string;
  quantity: number;
  minStartQuantity: number;
  dueTime: number;
  earliestStart: number;
}

export interface PfgConnection {
  sourceNodeId: string;
  targetNodeId: string;
  transportTime: number;
}

export interface PfgFlowModel {
  batchSize: number;
  dosingLevels: number;
  dosingLine: PfgProcessingResource;
  intermediateSilos: PfgStorageResource[];
  granulators: PfgProcessingResource[];
  finalSilos: PfgStorageResource[];
  dispatchLines: PfgProcessingResource[];
  batches: PfgBatch[];
  orderRequirements: PfgOrderRequirement[];
  dosingLineToIntermediateSilos: PfgConnection[];
  intermediateToGranulators: PfgConnection[];
  granulatorToFinalSilos: PfgConnection[];
  finalSiloToDispatchLines: PfgConnection[];
  cleanoutTime: number;
  granulatorSetupTime: number;
  dispatchSetupTime: number;
  constraintCoverage: PfgConstraintCoverage[];
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
  pfgFlow?: PfgFlowModel | undefined;
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
