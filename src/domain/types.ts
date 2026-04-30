export type TimeUnit = 'minute' | 'hour' | 'day';

export type NodeType =
  | 'source'
  | 'machine'
  | 'mixer'
  | 'reactor'
  | 'tank'
  | 'buffer'
  | 'silo'
  | 'line'
  | 'packaging'
  | 'dispatch'
  | 'sink'
  | 'custom';

export type ProductionMode = 'continuous' | 'batch';

export interface Position {
  x: number;
  y: number;
}

export interface Material {
  id: string;
  name: string;
  unit: string;
  family?: string | undefined;
  compatibilityTags: string[];
}

export interface ProductComponent {
  productId: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  unit: string;
  family?: string | undefined;
  materialId?: string | undefined;
  properties: Record<string, string>;
  components: ProductComponent[];
}

export interface PlantNode {
  id: string;
  name: string;
  type: NodeType;
  position: Position;
  capacity?: number | undefined;
  processingTime?: number | undefined;
  productionMode?: ProductionMode | undefined;
  compatibleMaterials?: string[] | undefined;
  metadata: Record<string, unknown>;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  materialTypes?: string[] | undefined;
  capacity?: number | undefined;
  transportTime?: number | undefined;
  enabled: boolean;
  metadata?: Record<string, unknown> | undefined;
}

export interface Order {
  id: string;
  materialId: string;
  quantity: number;
  dueTime: number;
  priority: number;
  earliestStart?: number | undefined;
  minStartQuantity?: number | undefined;
}

export interface Plant {
  id: string;
  name: string;
  version: number;
  timeHorizon: number;
  timeUnit: TimeUnit;
  materials: Material[];
  products: Product[];
  nodes: PlantNode[];
  connections: Connection[];
  orders: Order[];
}

export interface Scenario {
  id: string;
  plantId: string;
  name: string;
  plantVersion: number;
  createdAt: string;
  solverSettings: SolverSettings;
}

export type SolverStrategy = 'mock' | 'cp_sat' | 'heuristic' | 'decomposed' | 'monolithic' | 'lexicographic';

export interface SolverSettings {
  strategy: SolverStrategy;
  timeLimitSeconds: number;
  workers: number;
}

export interface SolverInstance {
  plant: Plant;
  scenario: Scenario;
}

export type ScheduleStatus = 'optimal' | 'feasible' | 'infeasible' | 'unknown' | 'error';

export interface ScheduledOperation {
  id: string;
  orderId: string;
  nodeId: string;
  materialId: string;
  start: number;
  end: number;
  quantity: number;
}

export interface ScheduleKpis {
  lateOrders: number;
  totalTardiness: number;
  makespan: number;
}

export interface Schedule {
  id: string;
  plantId: string;
  scenarioId: string;
  status: ScheduleStatus;
  strategy: SolverStrategy;
  operations: ScheduledOperation[];
  kpis: ScheduleKpis;
  violations: string[];
  explanations: string[];
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ValidationResult {
  status: 'ready' | 'ready_with_warnings' | 'not_ready';
  issues: ValidationIssue[];
}
