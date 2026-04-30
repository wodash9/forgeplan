import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type CoordinateExtent,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type OnConnect,
  type OnNodeDrag,
  type OnNodesChange,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Connection as PlantConnection, Plant, PlantNode, Product, ProductComponent, Schedule } from '../domain/types.js';
import { createScenario } from '../domain/defaults.js';
import { plantSchema } from '../schema/plantSchema.js';
import { buildSolverModel, mockSolverAdapter } from '../solver/index.js';
import { validatePlant } from '../validation/validatePlant.js';
import { createDemoPlant, createNode } from './demoPlant.js';
import './styles.css';

const nodeLabels: Record<PlantNode['type'], string> = {
  source: 'Source',
  machine: 'Machine',
  mixer: 'Mixer',
  reactor: 'Reactor',
  tank: 'Tank',
  buffer: 'Buffer',
  silo: 'Silo',
  line: 'Line',
  packaging: 'Packaging',
  dispatch: 'Dispatch',
  sink: 'Sink',
  custom: 'Custom',
};

type EquipmentVisual = { title: string; detail: string; standard: string; isaTag: string };

const isaStyleNote = 'ISA-5.1-style instrumentation tag · original ForgePlan drawing, not a copied ISA chart';

const equipmentVisuals: Record<PlantNode['type'], EquipmentVisual> = {
  source: { title: 'Materia prima', detail: 'Entrada', standard: 'ISO 10628-2 · REG 2065 open bulk storage', isaTag: 'SRC' },
  machine: { title: 'Granuladora / pelletizer', detail: 'Proceso', standard: 'ISO 10628-2 · REG X8057 pelletizing disc', isaTag: 'MCH' },
  mixer: { title: 'Mixer', detail: 'Mezcla', standard: 'ISO 10628-2 · REG X2672/X2673 mixer', isaTag: 'MIX' },
  reactor: { title: 'Reactor agitado', detail: 'Reacción', standard: 'ISO 10628-2 · REG X8006 agitated vessel', isaTag: 'R-101' },
  tank: { title: 'Tank / vessel', detail: 'Almacenaje', standard: 'ISO 10628-2 · REG 2062 dished vessel', isaTag: 'TK' },
  buffer: { title: 'Buffer / container', detail: 'Pulmón', standard: 'ISO 10628-2 · REG 301 tank/vessel', isaTag: 'BUF' },
  silo: { title: 'Silo / bunker', detail: 'Granel', standard: 'ISO 10628-2 · REG X2062 closed conical bottom tank', isaTag: 'SIL' },
  line: { title: 'Conveyor line', detail: 'Línea', standard: 'ISO 10628-2 · Group 18 conveying equipment style', isaTag: 'CV' },
  packaging: { title: 'Packaging / bag', detail: 'Envasado', standard: 'ISO 10628-2 · REG 2068 bag/container style', isaTag: 'PKG' },
  dispatch: { title: 'Dispatch / truck', detail: 'Salida', standard: 'ISO 10628-2 · Group 18 transport equipment style', isaTag: 'DSP' },
  sink: { title: 'Destino', detail: 'Final', standard: 'ISO 10628-2 · REG 2065 storage/sink style', isaTag: 'SNK' },
  custom: { title: 'Custom equipment', detail: 'Custom', standard: 'ForgePlan custom ISA/ISO-style equipment', isaTag: 'USR' },
};

const equipmentTypes = Object.keys(nodeLabels) as PlantNode['type'][];
const equipmentNodeMeasuredSize = { width: 136, height: 146 } as const;
export const plantNodeDragExtent: CoordinateExtent = [[-10_000, -10_000], [10_000, 10_000]];
export const plantCanvasMinZoom = 0.1;

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: PlantNode['type'];
  capacity?: number | undefined;
  processingTime?: number | undefined;
  customTypeName?: string | undefined;
  isaTag?: string | undefined;
  customProperties?: Record<string, string> | undefined;
  onSelectNode: (nodeId: string) => void;
  onOpenProperties: (nodeId: string) => void;
}

const nodeTypes = {
  equipment: EquipmentFlowNode,
};

export type PerimeterAnchor = {
  id: string;
  side: 'top' | 'right' | 'bottom' | 'left';
  percent: number;
  position: Position;
};

const anchorPercents = [15, 32, 50, 68, 85] as const;
export const perimeterConnectionAnchors: PerimeterAnchor[] = [
  ...anchorPercents.map((percent) => ({ id: `top-${percent}`, side: 'top' as const, percent, position: Position.Top })),
  ...anchorPercents.map((percent) => ({ id: `right-${percent}`, side: 'right' as const, percent, position: Position.Right })),
  ...anchorPercents.map((percent) => ({ id: `bottom-${percent}`, side: 'bottom' as const, percent, position: Position.Bottom })),
  ...anchorPercents.map((percent) => ({ id: `left-${percent}`, side: 'left' as const, percent, position: Position.Left })),
];

function perimeterHandleId(anchor: PerimeterAnchor, type: 'source' | 'target'): string {
  return `${anchor.id}-${type}`;
}

const sourceHandleIds = new Set(perimeterConnectionAnchors.map((anchor) => perimeterHandleId(anchor, 'source')));
const targetHandleIds = new Set(perimeterConnectionAnchors.map((anchor) => perimeterHandleId(anchor, 'target')));
const defaultSourceHandle = 'right-50-source';
const defaultTargetHandle = 'left-50-target';

type ConnectPayload = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export function movePlantNode(plant: Plant, nodeId: string, position: PlantNode['position']): Plant {
  return {
    ...plant,
    nodes: plant.nodes.map((node) => (node.id === nodeId ? { ...node, position: { x: position.x, y: position.y } } : node)),
  };
}

type PositionChangeLike = {
  id?: string;
  type: string;
  position?: PlantNode['position'];
  dragging?: boolean;
};

export function syncPlantNodePositions(plant: Plant, changes: PositionChangeLike[]): Plant {
  return changes.reduce((current, change) => {
    if (change.type !== 'position' || !change.id || !change.position) return current;
    return movePlantNode(current, change.id, change.position);
  }, plant);
}

export function mergePositionChanges(current: PositionChangeLike[], incoming: PositionChangeLike[]): PositionChangeLike[] {
  const byNodeId = new Map<string, PositionChangeLike>();
  for (const change of [...current, ...incoming]) {
    if (change.type !== 'position' || !change.id || !change.position) continue;
    byNodeId.set(change.id, change);
  }
  return Array.from(byNodeId.values());
}

function hasPositionChanges(changes: PositionChangeLike[]): boolean {
  return changes.some((change) => change.type === 'position' && Boolean(change.id) && Boolean(change.position));
}

type CustomNodeInput = {
  name?: string | undefined;
  customTypeName?: string | undefined;
  isaTag?: string | undefined;
  capacity?: number | undefined;
  processingTime?: number | undefined;
  customProperties?: Record<string, string> | undefined;
};

type ProductInput = {
  name?: string | undefined;
  sku?: string | undefined;
  unit?: string | undefined;
  family?: string | undefined;
  materialId?: string | undefined;
  properties?: Record<string, string> | undefined;
  components?: ProductComponent[] | undefined;
};

type ActiveScreen = 'plant' | 'products';

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function customPropertiesFromMetadata(metadata: Record<string, unknown> | undefined): Record<string, string> | undefined {
  const value = metadata?.customProperties;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, item]) => [key, item]),
  );
}

function parseCustomProperties(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [rawKey, ...rest] = line.split('=');
        const key = (rawKey || '').trim();
        const val = rest.join('=').trim();
        return key ? [key, val] : null;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
}

function formatCustomProperties(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}=${typeof item === 'string' ? item : String(item)}`)
    .join('\n');
}

function slugifyProductName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'product';
}

function nextProductId(products: Product[], name: string): string {
  const baseId = `prod_${slugifyProductName(name)}`;
  if (!products.some((product) => product.id === baseId)) return baseId;
  let index = 2;
  while (products.some((product) => product.id === `${baseId}_${index}`)) index += 1;
  return `${baseId}_${index}`;
}

export function addProductToPlant(plant: Plant, input: ProductInput): { plant: Plant; productId: string } {
  const name = input.name?.trim() || 'New product';
  const productId = nextProductId(plant.products, name);
  const product: Product = {
    id: productId,
    name,
    sku: input.sku?.trim() || productId.toUpperCase(),
    unit: input.unit?.trim() || 'kg',
    family: input.family?.trim() || undefined,
    materialId: input.materialId?.trim() || undefined,
    properties: input.properties ?? {},
    components: (input.components ?? []).filter((component) =>
      component.productId !== productId &&
      component.quantity > 0 &&
      plant.products.some((candidate) => candidate.id === component.productId),
    ),
  };
  return { plant: { ...plant, products: [...plant.products, product] }, productId };
}

const browserDbName = 'forgeplan-local-db';
const browserPlantStoreName = 'plants';
const browserLatestPlantKey = 'forgeplan.latestPlantId';

export function serializePlantModelForExport(plant: Plant): string {
  return JSON.stringify(plant, null, 2);
}

export function importPlantModelFromJson(json: string): Plant {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }

  const schemaResult = plantSchema.safeParse(parsed);
  if (!schemaResult.success) {
    throw new Error(`Invalid plant model: ${schemaResult.error.issues.map((issue) => issue.message).join(', ')}`);
  }

  const validation = validatePlant(schemaResult.data);
  if (validation.status === 'not_ready') {
    throw new Error(`Invalid plant model: ${validation.issues.map((issue) => issue.message).join('; ')}`);
  }

  return schemaResult.data;
}

function savePlantToLocalStorage(plant: Plant): void {
  window.localStorage.setItem(`${browserPlantStoreName}:${plant.id}`, serializePlantModelForExport(plant));
  window.localStorage.setItem(browserLatestPlantKey, plant.id);
}

function loadPlantFromLocalStorage(): Plant | undefined {
  const latestPlantId = window.localStorage.getItem(browserLatestPlantKey);
  if (!latestPlantId) return undefined;
  const json = window.localStorage.getItem(`${browserPlantStoreName}:${latestPlantId}`);
  if (!json) return undefined;
  try {
    return importPlantModelFromJson(json);
  } catch {
    return undefined;
  }
}

function openBrowserPlantDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(browserDbName, 1);
    request.onerror = () => reject(request.error ?? new Error('Cannot open browser DB'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(browserPlantStoreName)) {
        db.createObjectStore(browserPlantStoreName, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadLatestPlantModelFromBrowserDb(): Promise<Plant | undefined> {
  if (typeof window === 'undefined') return undefined;
  if (!('indexedDB' in window) || !window.indexedDB) return loadPlantFromLocalStorage();

  let db: IDBDatabase | undefined;
  try {
    db = await openBrowserPlantDb();
    const latestPlantId = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db!.transaction('metadata', 'readonly');
      tx.onerror = () => reject(tx.error ?? new Error('Cannot read browser DB metadata'));
      const request = tx.objectStore('metadata').get(browserLatestPlantKey);
      request.onerror = () => reject(request.error ?? new Error('Cannot read latest plant id'));
      request.onsuccess = () => {
        const row = request.result as { value?: string } | undefined;
        resolve(row?.value);
      };
    });
    if (!latestPlantId) return loadPlantFromLocalStorage();

    const json = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db!.transaction(browserPlantStoreName, 'readonly');
      tx.onerror = () => reject(tx.error ?? new Error('Cannot read plant model'));
      const request = tx.objectStore(browserPlantStoreName).get(latestPlantId);
      request.onerror = () => reject(request.error ?? new Error('Cannot read plant row'));
      request.onsuccess = () => {
        const row = request.result as { json?: string } | undefined;
        resolve(row?.json);
      };
    });
    return json ? importPlantModelFromJson(json) : loadPlantFromLocalStorage();
  } catch {
    return loadPlantFromLocalStorage();
  } finally {
    db?.close();
  }
}

export async function persistPlantModelToBrowserDb(plant: Plant): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('indexedDB' in window) || !window.indexedDB) {
    savePlantToLocalStorage(plant);
    return;
  }

  let db: IDBDatabase | undefined;
  try {
    db = await openBrowserPlantDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([browserPlantStoreName, 'metadata'], 'readwrite');
      tx.onerror = () => reject(tx.error ?? new Error('Cannot persist plant model'));
      tx.oncomplete = () => resolve();
      tx.objectStore(browserPlantStoreName).put({
        id: plant.id,
        name: plant.name,
        version: plant.version,
        json: serializePlantModelForExport(plant),
        updatedAt: new Date().toISOString(),
      });
      tx.objectStore('metadata').put({ key: browserLatestPlantKey, value: plant.id });
    });
  } catch (error) {
    savePlantToLocalStorage(plant);
    throw error;
  } finally {
    db?.close();
  }
}

export function addCustomPlantNode(plant: Plant, input: CustomNodeInput = {}): { plant: Plant; nodeId: string } {
  const nextIndex = nextNodeNumber(plant.nodes, 'node_custom');
  const id = nextIndex === 1 ? 'node_custom' : `node_custom_${nextIndex}`;
  const name = input.name?.trim() || `Custom ${nextIndex}`;
  const node = createNode(id, name, 'custom', 160 + nextIndex * 54, 280, {
    capacity: input.capacity,
    processingTime: input.processingTime,
    metadata: {
      customTypeName: input.customTypeName?.trim() || 'Custom equipment',
      isaTag: input.isaTag?.trim() || `USR-${String(nextIndex).padStart(3, '0')}`,
      customProperties: input.customProperties ?? {},
    },
  });

  return { plant: { ...plant, nodes: [...plant.nodes, node] }, nodeId: id };
}

export function buildEquipmentFlowNodes(
  plant: Plant,
  selectedNodeId: string,
  selectNode: (nodeId: string) => void,
  openProperties: (nodeId: string) => void = selectNode,
): Node<FlowNodeData>[] {
  return plant.nodes.map((node) => ({
    id: node.id,
    type: 'equipment',
    position: node.position,
    measured: equipmentNodeMeasuredSize,
    selected: node.id === selectedNodeId,
    data: {
      label: node.name,
      nodeType: node.type,
      capacity: node.capacity,
      processingTime: node.processingTime,
      customTypeName: metadataString(node.metadata, 'customTypeName'),
      isaTag: metadataString(node.metadata, 'isaTag'),
      customProperties: customPropertiesFromMetadata(node.metadata),
      onSelectNode: selectNode,
      onOpenProperties: openProperties,
    },
    className: `plant-flow-node ${node.type}`,
  }));
}

export function addPlantConnection(plant: Plant, connection: ConnectPayload): Plant {
  if (!connection.source || !connection.target || connection.source === connection.target) return plant;
  const nodeIds = new Set(plant.nodes.map((node) => node.id));
  if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) return plant;

  const baseId = `conn_${connection.source}_${connection.target}`;
  const existingIds = new Set(plant.connections.map((item) => item.id));
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  const newConnection: PlantConnection = {
    id,
    sourceNodeId: connection.source,
    targetNodeId: connection.target,
    materialTypes: plant.materials[0]?.id ? [plant.materials[0].id] : undefined,
    capacity: 100,
    transportTime: 0,
    enabled: true,
    metadata: {
      sourceHandle: canonicalConnectionHandle(connection.sourceHandle, 'source'),
      targetHandle: canonicalConnectionHandle(connection.targetHandle, 'target'),
    },
  };

  return { ...plant, connections: [...plant.connections, newConnection] };
}

function canonicalConnectionHandle(
  value: unknown,
  endpoint: 'source' | 'target',
  fallback: string = endpoint === 'source' ? defaultSourceHandle : defaultTargetHandle,
): string {
  const validIds = endpoint === 'source' ? sourceHandleIds : targetHandleIds;
  if (typeof value !== 'string') return fallback;
  if (validIds.has(value)) return value;

  const legacy = value.match(/^(top|right|bottom|left)-(source|target)$/);
  if (legacy?.[1] && legacy[2] === endpoint) {
    return `${legacy[1]}-50-${endpoint}`;
  }

  return fallback;
}

function connectionHandle(connection: PlantConnection, key: 'sourceHandle' | 'targetHandle', fallback?: string): string {
  const endpoint = key === 'sourceHandle' ? 'source' : 'target';
  return canonicalConnectionHandle(connection.metadata?.[key], endpoint, fallback);
}

function updateConnectionMetadata(connection: PlantConnection, patch: Record<string, unknown>): PlantConnection {
  return { ...connection, metadata: { ...(connection.metadata ?? {}), ...patch } };
}

export function movePlantConnectionEndpoint(
  plant: Plant,
  connectionId: string,
  endpoint: 'source' | 'target',
  handleId: string,
): Plant {
  const canonicalHandle = canonicalConnectionHandle(handleId, endpoint, '');
  if (!canonicalHandle) return plant;

  let changed = false;
  const connections = plant.connections.map((connection) => {
    if (connection.id !== connectionId) return connection;
    changed = true;
    return updateConnectionMetadata(connection, {
      [endpoint === 'source' ? 'sourceHandle' : 'targetHandle']: canonicalHandle,
    });
  });

  return changed ? { ...plant, connections } : plant;
}

export function reconnectPlantConnection(plant: Plant, connectionId: string, connection: ConnectPayload): Plant {
  if (!connection.source || !connection.target || connection.source === connection.target) return plant;
  const nodeIds = new Set(plant.nodes.map((node) => node.id));
  if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) return plant;

  let changed = false;
  const connections = plant.connections.map((item) => {
    if (item.id !== connectionId) return item;
    changed = true;
    return updateConnectionMetadata(
      {
        ...item,
        sourceNodeId: connection.source!,
        targetNodeId: connection.target!,
      },
      {
        sourceHandle: canonicalConnectionHandle(connection.sourceHandle, 'source'),
        targetHandle: canonicalConnectionHandle(connection.targetHandle, 'target'),
      },
    );
  });

  return changed ? { ...plant, connections } : plant;
}

function parseMaterialTypes(value: string): string[] | undefined {
  const materialTypes = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return materialTypes.length > 0 ? materialTypes : undefined;
}

function nextNodeNumber(nodes: PlantNode[], idPrefix: string): number {
  const usedNumbers = nodes
    .map((node) => {
      if (node.id === idPrefix) return 1;
      const match = node.id.match(new RegExp(`^${idPrefix}_(\\d+)$`));
      return match?.[1] ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isFinite(value));
  return Math.max(0, ...usedNumbers) + 1;
}

export default function App() {
  const [plant, setPlant] = useState<Plant>(() => createDemoPlant());
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('plant');
  const [selectedNodeId, setSelectedNodeId] = useState('node_mixer');
  const [propertiesNodeId, setPropertiesNodeId] = useState<string | null>(null);
  const [propertiesConnectionId, setPropertiesConnectionId] = useState<string | null>(null);
  const [creatingCustomNode, setCreatingCustomNode] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState('Not saved yet');
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const pendingPositionChangesRef = useRef<PositionChangeLike[]>([]);
  const dragFrameRef = useRef<number | null>(null);
  const validation = useMemo(() => validatePlant(plant), [plant]);
  const scenario = useMemo(() => createScenario(plant), [plant]);
  const selectedNode = plant.nodes.find((node) => node.id === selectedNodeId) ?? plant.nodes[0];
  const propertiesNode = plant.nodes.find((node) => node.id === propertiesNodeId) ?? null;
  const propertiesConnection = plant.connections.find((connection) => connection.id === propertiesConnectionId) ?? null;

  const openProperties = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPropertiesNodeId(nodeId);
  }, []);

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () => buildEquipmentFlowNodes(plant, selectedNodeId, selectNode, openProperties),
    [openProperties, plant, selectNode, selectedNodeId],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      plant.connections.map((connection) => ({
        id: connection.id,
        source: connection.sourceNodeId,
        target: connection.targetNodeId,
        sourceHandle: connectionHandle(connection, 'sourceHandle'),
        targetHandle: connectionHandle(connection, 'targetHandle'),
        label: [connection.materialTypes?.join(', '), connection.transportTime ? `${connection.transportTime} min` : null]
          .filter(Boolean)
          .join(' · '),
        animated: connection.enabled,
        selectable: true,
        reconnectable: true,
        type: 'smoothstep',
        className: connection.enabled ? 'editable-flow-edge' : 'editable-flow-edge disabled',
      })),
    [plant.connections],
  );

  const updateNode = (nodeId: string, patch: Partial<PlantNode>) => {
    setPlant((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
    setSchedule(null);
  };

  const updateConnection = (connectionId: string, patch: Partial<PlantConnection>) => {
    setPlant((current) => ({
      ...current,
      connections: current.connections.map((connection) => (connection.id === connectionId ? { ...connection, ...patch } : connection)),
    }));
    setSchedule(null);
  };

  const openConnectionProperties = useCallback((connectionId: string) => {
    setPropertiesConnectionId(connectionId);
  }, []);

  const addMixer = () => {
    const nextIndex = nextNodeNumber(plant.nodes, 'node_mixer');
    const id = nextIndex === 1 ? 'node_mixer' : `node_mixer_${nextIndex}`;
    const mixer = createNode(id, `Mixer ${nextIndex}`, 'mixer', 280 + nextIndex * 36, 260, {
      capacity: 100,
      processingTime: 30,
    });
    setPlant((current) => ({ ...current, nodes: [...current.nodes, mixer] }));
    setSelectedNodeId(id);
    setSchedule(null);
  };

  const createCustomNode = (input: CustomNodeInput) => {
    const result = addCustomPlantNode(plant, input);
    setPlant(result.plant);
    setSelectedNodeId(result.nodeId);
    setCreatingCustomNode(false);
    setSchedule(null);
  };

  const createProduct = (input: ProductInput) => {
    const result = addProductToPlant(plant, input);
    setPlant(result.plant);
    setSchedule(null);
  };

  const importJsonModel = (json: string) => {
    try {
      const importedPlant = importPlantModelFromJson(json);
      setPlant(importedPlant);
      setSelectedNodeId(importedPlant.nodes[0]?.id ?? '');
      setPropertiesNodeId(null);
      setPropertiesConnectionId(null);
      setImportingJson(false);
      setImportError(null);
      setSchedule(null);
      setPersistenceStatus('Saved to local DB');
    } catch (error) {
      setImportError((error as Error).message);
    }
  };

  const runMockSolve = () => {
    const solverModel = buildSolverModel(plant, scenario);
    const result = mockSolverAdapter.solve(solverModel);
    setSchedule(result.schedule);
  };

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    selectNode(node.id);
  }, [selectNode]);

  const flushQueuedPositionChanges = useCallback(() => {
    const changes = pendingPositionChangesRef.current;
    pendingPositionChangesRef.current = [];
    dragFrameRef.current = null;
    if (changes.length === 0) return;
    setPlant((current) => syncPlantNodePositions(current, changes));
    setSchedule(null);
  }, []);

  const queuePositionChanges = useCallback((changes: PositionChangeLike[]) => {
    if (!hasPositionChanges(changes)) return;
    pendingPositionChangesRef.current = mergePositionChanges(pendingPositionChangesRef.current, changes);
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(flushQueuedPositionChanges);
  }, [flushQueuedPositionChanges]);

  const updateDraggedNodePosition = useCallback<OnNodeDrag<Node<FlowNodeData>>>((_, node) => {
    queuePositionChanges([{ id: node.id, type: 'position', position: node.position, dragging: true }]);
  }, [queuePositionChanges]);

  const commitDraggedNodePosition = useCallback<OnNodeDrag<Node<FlowNodeData>>>((_, node) => {
    const queuedChanges = pendingPositionChangesRef.current;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingPositionChangesRef.current = [];
    setPlant((current) => movePlantNode(syncPlantNodePositions(current, queuedChanges), node.id, node.position));
    setSchedule(null);
  }, []);

  const syncLiveNodeChanges = useCallback<OnNodesChange<Node<FlowNodeData>>>((changes) => {
    queuePositionChanges(changes);
  }, [queuePositionChanges]);

  const handleConnect = useCallback<OnConnect>((connection) => {
    setPlant((current) => addPlantConnection(current, connection));
    setSchedule(null);
  }, []);

  const handleReconnect = useCallback<OnReconnect<Edge>>((edge, connection) => {
    setPlant((current) => reconnectPlantConnection(current, edge.id, connection));
    setSchedule(null);
  }, []);

  const handleEdgeClick = useCallback<EdgeMouseHandler>((_, edge) => {
    openConnectionProperties(edge.id);
  }, [openConnectionProperties]);

  useEffect(() => {
    let active = true;
    setPersistenceStatus('Loading local DB…');
    loadLatestPlantModelFromBrowserDb()
      .then((persistedPlant) => {
        if (!active) return;
        if (persistedPlant) {
          setPlant(persistedPlant);
          setSelectedNodeId(persistedPlant.nodes[0]?.id ?? '');
        }
        setStorageHydrated(true);
      })
      .catch(() => {
        if (active) setStorageHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    let active = true;
    setPersistenceStatus('Saving to local DB…');
    persistPlantModelToBrowserDb(plant)
      .then(() => {
        if (active) setPersistenceStatus('Saved to local DB');
      })
      .catch((error) => {
        if (active) setPersistenceStatus(`DB save failed: ${(error as Error).message}`);
      });
    return () => {
      active = false;
    };
  }, [plant, storageHydrated]);

  useEffect(() => () => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">ForgePlan</p>
          <h1>Visual Plant Editor MVP</h1>
          <p className="muted">Modela la planta, revisa readiness y prepara la base para optimización local.</p>
        </div>
        <ReadinessBadge status={validation.status} />
      </header>

      <nav className="screen-tabs" aria-label="ForgePlan screens">
        <button type="button" className={activeScreen === 'plant' ? 'active' : ''} onClick={() => setActiveScreen('plant')}>
          Plant editor
        </button>
        <button type="button" className={activeScreen === 'products' ? 'active' : ''} onClick={() => setActiveScreen('products')}>
          Product catalog
        </button>
      </nav>

      {activeScreen === 'plant' ? (
      <main className="workspace-grid">
        <aside className="panel palette" aria-label="Plant palette">
          <p className="eyebrow">Palette</p>
          <h2>Add equipment</h2>
          <button type="button" onClick={addMixer}>Add mixer</button>
          <button className="secondary-action" type="button" onClick={() => setCreatingCustomNode(true)}>
            Create custom node
          </button>
          <button className="secondary-action" type="button" onClick={() => setImportingJson(true)}>
            Import JSON
          </button>
          <button className="secondary-action" type="button" onClick={() => setExportingJson(true)}>
            Export JSON
          </button>
          <button className="secondary-action" type="button" onClick={runMockSolve} disabled={validation.status === 'not_ready'}>
            Run mock solve
          </button>
          <div className="summary-card">
            <strong>{plant.nodes.length}</strong>
            <span>nodes</span>
          </div>
          <div className="summary-card">
            <strong>{plant.connections.length}</strong>
            <span>connections</span>
          </div>
          <div className="summary-card persistence-card">
            <strong>DB</strong>
            <span>{persistenceStatus}</span>
          </div>
        </aside>

        <section className="panel canvas-panel" aria-label="Plant canvas">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Plant model</p>
              <h2>{plant.name}</h2>
            </div>
            <span>ISA-5.1-style instrumentation tags · ISO 10628-style equipment · {plant.orders.length} order ready</span>
          </div>
          <div className="flow-surface" data-testid="forgeplan-flow-canvas">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onConnect={handleConnect}
              onReconnect={handleReconnect}
              onNodesChange={syncLiveNodeChanges}
              onNodeDrag={updateDraggedNodePosition}
              onNodeDragStop={commitDraggedNodePosition}
              nodesDraggable
              nodesConnectable
              edgesReconnectable
              elementsSelectable
              autoPanOnNodeDrag={false}
              nodeExtent={plantNodeDragExtent}
              minZoom={plantCanvasMinZoom}
              translateExtent={plantNodeDragExtent}
              reconnectRadius={42}
              connectionRadius={42}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </section>

        <aside className="panel inspector" aria-label="Node inspector">
          <p className="eyebrow">Inspector</p>
          {selectedNode ? (
            <div className="selected-equipment-card">
              <span className="selected-equipment-icon" aria-hidden="true">
                <IsoEquipmentSymbol type={selectedNode.type} compact />
              </span>
              <div>
                <h2>{selectedNode.name}</h2>
                <p>{nodeLabels[selectedNode.type]} · x {Math.round(selectedNode.position.x)}, y {Math.round(selectedNode.position.y)}</p>
              </div>
              <button type="button" className="text-action" onClick={() => openProperties(selectedNode.id)}>
                Edit properties
              </button>
            </div>
          ) : (
            <p>Select a node to edit it.</p>
          )}

          <div className="readiness-panel">
            <h3>Readiness</h3>
            {validation.issues.length === 0 ? (
              <p className="ready-copy">Plant is ready for the next phase.</p>
            ) : (
              <ul>
                {validation.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.path ?? issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>

          <ConnectionPanel connections={plant.connections} onEdit={openConnectionProperties} />

          <SolvePanel schedule={schedule} plant={plant} />
        </aside>
      </main>
      ) : (
        <ProductCatalogScreen plant={plant} onCreateProduct={createProduct} />
      )}

      {creatingCustomNode && (
        <CreateCustomNodeDialog
          onCreate={createCustomNode}
          onClose={() => setCreatingCustomNode(false)}
        />
      )}

      {exportingJson && (
        <ExportPlantJsonDialog
          plant={plant}
          onClose={() => setExportingJson(false)}
        />
      )}

      {importingJson && (
        <ImportPlantJsonDialog
          error={importError}
          onImport={importJsonModel}
          onClose={() => {
            setImportingJson(false);
            setImportError(null);
          }}
        />
      )}

      {propertiesNode && (
        <NodePropertiesDialog
          node={propertiesNode}
          onChange={(patch) => updateNode(propertiesNode.id, patch)}
          onClose={() => setPropertiesNodeId(null)}
        />
      )}

      {propertiesConnection && (
        <ConnectionPropertiesDialog
          connection={propertiesConnection}
          onChange={(patch) => updateConnection(propertiesConnection.id, patch)}
          onClose={() => setPropertiesConnectionId(null)}
        />
      )}
    </div>
  );
}

function productById(products: Product[], productId: string): Product | undefined {
  return products.find((product) => product.id === productId);
}

function ProductCatalogScreen({ plant, onCreateProduct }: { plant: Plant; onCreateProduct: (input: ProductInput) => void }) {
  const [name, setName] = useState('Premium Feed 18%');
  const [sku, setSku] = useState('PF-18');
  const [unit, setUnit] = useState('kg');
  const [family, setFamily] = useState('Finished feed');
  const [propertiesText, setPropertiesText] = useState('protein=18%\ntexture=pellet');
  const [componentProductId, setComponentProductId] = useState(plant.products[0]?.id ?? '');
  const [componentQuantity, setComponentQuantity] = useState('80');
  const [components, setComponents] = useState<ProductComponent[]>([]);

  const addComponent = () => {
    const quantity = Number(componentQuantity);
    if (!componentProductId || !Number.isFinite(quantity) || quantity <= 0) return;
    setComponents((current) => [...current, { productId: componentProductId, quantity }]);
  };

  const submitProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreateProduct({
      name,
      sku,
      unit,
      family,
      properties: parseCustomProperties(propertiesText),
      components,
    });
    setName('');
    setSku('');
    setFamily('');
    setPropertiesText('');
    setComponents([]);
  };

  return (
    <main className="product-screen" aria-label="Product catalog workspace">
      <section className="panel product-hero-panel">
        <p className="eyebrow">Products</p>
        <h2>Product catalog & BOM</h2>
        <p className="muted-dark">Define productos fabricables, propiedades industriales y dependencias tipo receta/BOM entre productos.</p>
        <div className="product-kpis">
          <div><strong>{plant.products.length}</strong><span>products</span></div>
          <div><strong>{plant.products.filter((product) => product.components.length > 0).length}</strong><span>with dependencies</span></div>
        </div>
      </section>

      <section className="panel product-list-panel" aria-label="Product list">
        <p className="eyebrow">List</p>
        <h3>Product list</h3>
        <div className="product-list">
          {plant.products.map((product) => (
            <article className="product-card" key={product.id}>
              <div className="product-card-header">
                <div>
                  <h4>{product.name}</h4>
                  <p>{product.sku} · {product.family ?? 'No family'} · {product.unit}</p>
                </div>
                <span className="product-badge">{product.components.length ? 'BOM' : 'base'}</span>
              </div>
              <dl className="product-properties">
                {Object.entries(product.properties).map(([key, value]) => (
                  <div key={key}><dt>{key}: </dt><dd>{value}</dd></div>
                ))}
              </dl>
              {product.components.length > 0 ? (
                <div className="bom-list" aria-label={`${product.name} dependencies`}>
                  <strong>Made from</strong>
                  {product.components.map((component, index) => {
                    const dependency = productById(plant.products, component.productId);
                    return (
                      <span className="bom-chip" key={`${product.id}-${component.productId}-${component.quantity}-${index}`}>
                        <span>{dependency?.name ?? component.productId}</span>
                        <span> × {component.quantity} {dependency?.unit ?? product.unit}</span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-dark">Base product · no dependencies</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel product-form-panel">
        <p className="eyebrow">Create</p>
        <h3>Create product</h3>
        <form aria-label="Create product form" className="product-form" onSubmit={submitProduct}>
          <label>
            Product name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            SKU
            <input value={sku} onChange={(event) => setSku(event.target.value)} />
          </label>
          <div className="form-row-two">
            <label>
              Unit
              <input value={unit} onChange={(event) => setUnit(event.target.value)} />
            </label>
            <label>
              Family
              <input value={family} onChange={(event) => setFamily(event.target.value)} />
            </label>
          </div>
          <label>
            Properties
            <textarea value={propertiesText} onChange={(event) => setPropertiesText(event.target.value)} rows={4} />
          </label>
          <div className="bom-builder">
            <h4>Dependencies / BOM</h4>
            <div className="form-row-two">
              <label>
                Component product
                <select value={componentProductId} onChange={(event) => setComponentProductId(event.target.value)}>
                  {plant.products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Component quantity
                <input value={componentQuantity} onChange={(event) => setComponentQuantity(event.target.value)} inputMode="decimal" />
              </label>
            </div>
            <button className="secondary-action" type="button" onClick={addComponent}>Add component</button>
            {components.length > 0 && (
              <ul className="pending-components">
                {components.map((component, index) => {
                  const dependency = productById(plant.products, component.productId);
                  return <li key={`${component.productId}-${index}`}>{dependency?.name ?? component.productId} × {component.quantity} {dependency?.unit ?? unit}</li>;
                })}
              </ul>
            )}
          </div>
          <button type="submit">Create product</button>
        </form>
      </section>
    </main>
  );
}

function handleStyle(anchor: PerimeterAnchor) {
  return anchor.side === 'top' || anchor.side === 'bottom'
    ? { left: `${anchor.percent}%` }
    : { top: `${anchor.percent}%` };
}

function EquipmentFlowNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const baseVisual = equipmentVisuals[data.nodeType];
  const visual: EquipmentVisual = data.nodeType === 'custom'
    ? {
        ...baseVisual,
        title: data.customTypeName || baseVisual.title,
        detail: data.customTypeName || baseVisual.detail,
        isaTag: data.isaTag || baseVisual.isaTag,
      }
    : baseVisual;
  return (
    <div
      className={`iso-equipment-node ${selected ? 'selected' : ''}`}
      data-iso-symbol={data.nodeType}
      data-interaction-mode="select-node"
      role="button"
      tabIndex={0}
      aria-label={`${data.label} ${data.nodeType} equipment node`}
      title={`${data.label} · ${visual.standard}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.react-flow__handle')) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        data.onSelectNode(id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onSelectNode(id);
        }
      }}
    >
      <div className="selection-mode-highlight" aria-hidden="true" />
      <div className="connection-perimeter-highlight" aria-hidden="true" />
      <span className="mode-hint select-mode-hint" aria-hidden="true">Select / drag node</span>
      <span className="mode-hint connection-mode-hint" aria-hidden="true">Connect from perimeter</span>
      <button
        type="button"
        className="node-properties-trigger nodrag nopan"
        aria-label={`Open ${data.label} properties`}
        title={`Open ${data.label} properties`}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onOpenProperties(id);
        }}
      >
        ✎
      </button>
      {perimeterConnectionAnchors.map((anchor) => (
        <Handle
          key={perimeterHandleId(anchor, 'target')}
          id={perimeterHandleId(anchor, 'target')}
          className={`iso-perimeter-handle connection-hotspot continuous-perimeter-hotspot target ${anchor.side}`}
          data-handleid={perimeterHandleId(anchor, 'target')}
          data-interaction-mode="connect-edge"
          aria-label={`Connection hotspot ${anchor.side} ${anchor.percent} target`}
          title={`Connect from ${anchor.side} ${anchor.percent} target`}
          type="target"
          position={anchor.position}
          style={handleStyle(anchor)}
        />
      ))}
      {perimeterConnectionAnchors.map((anchor) => (
        <Handle
          key={perimeterHandleId(anchor, 'source')}
          id={perimeterHandleId(anchor, 'source')}
          className={`iso-perimeter-handle connection-hotspot continuous-perimeter-hotspot source ${anchor.side}`}
          data-handleid={perimeterHandleId(anchor, 'source')}
          data-interaction-mode="connect-edge"
          aria-label={`Connection hotspot ${anchor.side} ${anchor.percent} source`}
          title={`Connect from ${anchor.side} ${anchor.percent} source`}
          type="source"
          position={anchor.position}
          style={handleStyle(anchor)}
        />
      ))}
      <IsoEquipmentSymbol type={data.nodeType} visual={visual} />
      <div className="iso-equipment-caption">
        <strong>{data.label}</strong>
        <span>{visual.title}</span>
        {(data.capacity || data.processingTime) && (
          <small>
            {data.capacity ? `${data.capacity} cap` : 'No cap'} · {data.processingTime ? `${data.processingTime} min` : 'No time'}
          </small>
        )}
      </div>
      <div className="iso-equipment-standard">{visual.detail}</div>
    </div>
  );
}

function IsoEquipmentSymbol({ type, compact = false, visual: visualOverride }: { type: PlantNode['type']; compact?: boolean; visual?: EquipmentVisual }) {
  const visual = visualOverride ?? equipmentVisuals[type];
  return (
    <svg
      className={`iso-equipment-symbol ${compact ? 'compact' : ''}`}
      viewBox="0 0 120 100"
      role="img"
      aria-label={`${visual.title} ${visual.standard} · ${isaStyleNote}: ${visual.isaTag}`}
    >
      <title>{visual.standard} · {isaStyleNote}: {visual.isaTag}</title>
      <g className="iso-symbol-lines" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {renderIsoSymbol(type)}
      </g>
      <g className="isa-tag-bubble" aria-hidden="true">
        <circle cx="91" cy="21" r="17" />
        <text x="91" y="25" textAnchor="middle">{visual.isaTag}</text>
      </g>
    </svg>
  );
}

function renderIsoSymbol(type: PlantNode['type']) {
  switch (type) {
    case 'source':
    case 'sink':
      return (
        <>
          <path d="M18 78 H102" />
          <path d="M34 78 L60 34 L86 78" />
          <path d="M60 34 V18" />
        </>
      );
    case 'machine':
      return (
        <>
          <path d="M42 16 H78 L96 84 H24 Z" />
          <path d="M30 68 H90" />
          <path d="M42 68 V84" />
          <path d="M78 68 V84" />
          <circle cx="60" cy="45" r="13" />
          <path d="M60 18 V7" />
          <path d="M60 58 V68" />
        </>
      );
    case 'mixer':
      return (
        <>
          <path d="M16 34 H104 V68 H16 Z" />
          <path d="M16 51 H104" />
          <path d="M25 39 L43 63 L43 39 L61 63 L61 39 L79 63 L79 39 L96 63" />
          <path d="M8 51 H16" />
          <path d="M104 51 H112" />
        </>
      );
    case 'reactor':
      return (
        <>
          <circle cx="60" cy="12" r="7" />
          <path d="M60 19 V67" />
          <path d="M42 25 Q60 13 78 25 V72 Q60 86 42 72 Z" />
          <path d="M36 38 V74 Q60 92 84 74 V38" />
          <path d="M60 55 L48 48 V64 L73 54" />
          <path d="M25 54 H36" />
          <path d="M84 54 H95" />
        </>
      );
    case 'tank':
      return (
        <>
          <path d="M40 22 Q60 10 80 22 V74 Q60 88 40 74 Z" />
          <path d="M60 88 V98" />
          <path d="M28 40 H40" />
          <path d="M80 58 H92" />
        </>
      );
    case 'buffer':
      return (
        <>
          <path d="M42 18 H78 V82 H42 Z" />
          <path d="M29 34 H42" />
          <path d="M78 66 H91" />
          <path d="M60 82 V96" />
        </>
      );
    case 'silo':
      return (
        <>
          <path d="M39 18 H81 V62 L60 84 L39 62 Z" />
          <path d="M60 84 V98" />
          <path d="M28 34 H39" />
          <path d="M81 52 H92" />
        </>
      );
    case 'line':
      return (
        <>
          <rect x="18" y="40" width="84" height="24" rx="12" />
          <circle cx="32" cy="52" r="8" />
          <circle cx="88" cy="52" r="8" />
          <path d="M32 52 H88" />
          <path d="M102 52 H112" />
        </>
      );
    case 'packaging':
      return (
        <>
          <path d="M43 33 H77 V82 H43 Z" />
          <path d="M38 20 H82 L60 33 Z" />
          <path d="M51 20 L69 33" />
          <path d="M69 20 L51 33" />
          <path d="M43 54 H77" />
        </>
      );
    case 'dispatch':
      return (
        <>
          <path d="M18 44 H72 V72 H18 Z" />
          <path d="M72 52 H92 L104 64 V72 H72 Z" />
          <circle cx="36" cy="76" r="8" />
          <circle cx="88" cy="76" r="8" />
          <path d="M92 52 V64 H104" />
        </>
      );
    case 'custom':
      return (
        <>
          <path d="M28 24 H92 V76 H28 Z" />
          <path d="M20 50 H28" />
          <path d="M92 50 H100" />
          <path d="M42 38 H78" />
          <path d="M42 50 H78" />
          <path d="M42 62 H66" />
        </>
      );
    default:
      return <path d="M34 78 L60 22 L86 78 Z" />;
  }
}

function ExportPlantJsonDialog({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const titleId = 'export-plant-json-title';
  const json = serializePlantModelForExport(plant);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="properties-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">JSON export</p>
            <h2 id={titleId}>Export plant JSON</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close export JSON" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="json-field">
          Exported plant JSON
          <textarea readOnly value={json} />
        </label>
        <div className="modal-metadata">
          <span>Model: {plant.name}</span>
          <span>Copy this JSON to move the plant model between local ForgePlan instances.</span>
        </div>
      </section>
    </div>
  );
}

function ImportPlantJsonDialog({
  error,
  onImport,
  onClose,
}: {
  error: string | null;
  onImport: (json: string) => void;
  onClose: () => void;
}) {
  const titleId = 'import-plant-json-title';
  const [json, setJson] = useState('');
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="properties-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">JSON import</p>
            <h2 id={titleId}>Import plant JSON</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close import JSON" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="json-field">
          Plant JSON import
          <textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="Paste a ForgePlan plant JSON model here" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-metadata">
          <span>Import validates the JSON schema and readiness before replacing the canvas.</span>
          <span>After import, the model is persisted automatically in the local browser DB.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onImport(json)}>Import model</button>
        </div>
      </section>
    </div>
  );
}

function CreateCustomNodeDialog({ onCreate, onClose }: { onCreate: (input: CustomNodeInput) => void; onClose: () => void }) {
  const titleId = 'create-custom-node-title';
  const [name, setName] = useState('Custom equipment');
  const [customTypeName, setCustomTypeName] = useState('Custom equipment');
  const [isaTag, setIsaTag] = useState('USR-001');
  const [capacity, setCapacity] = useState('100');
  const [processingTime, setProcessingTime] = useState('15');
  const [customProperties, setCustomProperties] = useState('');

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="properties-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Custom equipment</p>
            <h2 id={titleId}>Create custom node</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close custom node creator" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-grid">
          <label>
            Custom node name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Custom equipment class
            <input value={customTypeName} onChange={(event) => setCustomTypeName(event.target.value)} />
          </label>
          <label>
            ISA tag
            <input value={isaTag} onChange={(event) => setIsaTag(event.target.value)} />
          </label>
          <label>
            Capacity
            <input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
          </label>
          <label>
            Processing time
            <input type="number" min="1" value={processingTime} onChange={(event) => setProcessingTime(event.target.value)} />
          </label>
          <label className="full-width-field">
            Custom properties
            <textarea
              placeholder="key=value\nowner=production"
              value={customProperties}
              onChange={(event) => setCustomProperties(event.target.value)}
            />
          </label>
        </div>

        <div className="modal-metadata">
          <span>Uses ForgePlan original ISA-5.1-style tag bubbles; no protected ISA chart is copied.</span>
          <span>Custom properties are stored as local-first metadata on the node.</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onClose}>Cancel</button>
          <button
            type="button"
            onClick={() => onCreate({
              name,
              customTypeName,
              isaTag,
              capacity: capacity === '' ? undefined : Number(capacity),
              processingTime: processingTime === '' ? undefined : Number(processingTime),
              customProperties: parseCustomProperties(customProperties),
            })}
          >
            Create node
          </button>
        </div>
      </section>
    </div>
  );
}

function NodePropertiesDialog({
  node,
  onChange,
  onClose,
}: {
  node: PlantNode;
  onChange: (patch: Partial<PlantNode>) => void;
  onClose: () => void;
}) {
  const titleId = `node-properties-title-${node.id}`;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="properties-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Equipment properties</p>
            <h2 id={titleId}>{node.name} properties</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close properties" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-grid">
          <label>
            Equipment name
            <input value={node.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label>
            Equipment type
            <select value={node.type} onChange={(event) => onChange({ type: event.target.value as PlantNode['type'] })}>
              {equipmentTypes.map((type) => (
                <option key={type} value={type}>{nodeLabels[type]}</option>
              ))}
            </select>
          </label>
          {node.type === 'custom' && (
            <>
              <label>
                Custom equipment class
                <input
                  value={metadataString(node.metadata, 'customTypeName') ?? ''}
                  onChange={(event) => onChange({ metadata: { ...node.metadata, customTypeName: event.target.value } })}
                />
              </label>
              <label>
                ISA tag
                <input
                  value={metadataString(node.metadata, 'isaTag') ?? ''}
                  onChange={(event) => onChange({ metadata: { ...node.metadata, isaTag: event.target.value } })}
                />
              </label>
            </>
          )}
          <label>
            Capacity
            <input
              type="number"
              min="1"
              value={node.capacity ?? ''}
              onChange={(event) => onChange({ capacity: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          </label>
          <label>
            Processing time
            <input
              type="number"
              min="1"
              value={node.processingTime ?? ''}
              onChange={(event) => onChange({ processingTime: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          </label>
          {node.type === 'custom' && (
            <label className="full-width-field">
              Custom properties
              <textarea
                value={formatCustomProperties(node.metadata.customProperties)}
                onChange={(event) => onChange({
                  metadata: { ...node.metadata, customProperties: parseCustomProperties(event.target.value) },
                })}
              />
            </label>
          )}
        </div>

        <div className="modal-metadata">
          <span>ID: {node.id}</span>
          <span>Position: x {Math.round(node.position.x)}, y {Math.round(node.position.y)}</span>
          <span>Compatible materials: {node.compatibleMaterials?.join(', ') || 'all'}</span>
        </div>
      </section>
    </div>
  );
}

function ConnectionPanel({ connections, onEdit }: { connections: PlantConnection[]; onEdit: (connectionId: string) => void }) {
  return (
    <div className="connections-panel" aria-label="Connection inspector">
      <h3>Connections</h3>
      <div className="connection-list">
        {connections.map((connection) => (
          <button
            key={connection.id}
            type="button"
            className={`connection-row ${connection.enabled ? '' : 'disabled'}`}
            aria-label={`Edit connection ${connection.id}`}
            onClick={() => onEdit(connection.id)}
          >
            <strong>{connection.sourceNodeId} → {connection.targetNodeId}</strong>
            <span>
              {connection.materialTypes?.join(', ') || 'all materials'} · {connection.capacity ?? '∞'} cap · {connection.transportTime ?? 0} min
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatPerimeterAnchorLabel(anchor: PerimeterAnchor): string {
  return `${anchor.side} · ${anchor.percent}%`;
}

function ConnectionPropertiesDialog({
  connection,
  onChange,
  onClose,
}: {
  connection: PlantConnection;
  onChange: (patch: Partial<PlantConnection>) => void;
  onClose: () => void;
}) {
  const titleId = `connection-properties-title-${connection.id}`;
  const [materialInput, setMaterialInput] = useState(connection.materialTypes?.join(', ') ?? '');
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="properties-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Connection properties</p>
            <h2 id={titleId}>{connection.id} connection properties</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close connection properties" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-grid">
          <label>
            Material types
            <input
              value={materialInput}
              onChange={(event) => {
                setMaterialInput(event.target.value);
                onChange({ materialTypes: parseMaterialTypes(event.target.value) });
              }}
            />
          </label>
          <label>
            Connection capacity
            <input
              type="number"
              min="1"
              value={connection.capacity ?? ''}
              onChange={(event) => onChange({ capacity: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          </label>
          <label>
            Transport time
            <input
              type="number"
              min="0"
              value={connection.transportTime ?? ''}
              onChange={(event) => onChange({ transportTime: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={connection.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            Connection enabled
          </label>
          <label>
            Source perimeter point
            <select
              value={connectionHandle(connection, 'sourceHandle')}
              onChange={(event) => onChange({ metadata: { ...(connection.metadata ?? {}), sourceHandle: event.target.value } })}
            >
              {perimeterConnectionAnchors.map((anchor) => {
                const id = perimeterHandleId(anchor, 'source');
                return <option key={id} value={id}>{formatPerimeterAnchorLabel(anchor)}</option>;
              })}
            </select>
          </label>
          <label>
            Target perimeter point
            <select
              value={connectionHandle(connection, 'targetHandle')}
              onChange={(event) => onChange({ metadata: { ...(connection.metadata ?? {}), targetHandle: event.target.value } })}
            >
              {perimeterConnectionAnchors.map((anchor) => {
                const id = perimeterHandleId(anchor, 'target');
                return <option key={id} value={id}>{formatPerimeterAnchorLabel(anchor)}</option>;
              })}
            </select>
          </label>
        </div>

        <div className="modal-metadata">
          <span>Source: {connection.sourceNodeId} · {connectionHandle(connection, 'sourceHandle')}</span>
          <span>Target: {connection.targetNodeId} · {connectionHandle(connection, 'targetHandle')}</span>
        </div>
      </section>
    </div>
  );
}

function ReadinessBadge({ status }: { status: ReturnType<typeof validatePlant>['status'] }) {
  return <div className={`readiness-badge ${status}`}>{status.replaceAll('_', ' ')}</div>;
}

function ScheduleTimeline({ schedule, plant }: { schedule: Schedule; plant: Plant }) {
  const scaleEnd = Math.max(
    plant.timeHorizon,
    schedule.kpis.makespan,
    ...schedule.operations.map((operation) => operation.end),
    ...plant.orders.map((order) => order.dueTime),
    1,
  );
  const ticks = buildTimelineTicks(scaleEnd);
  const lanes = plant.nodes
    .map((node) => ({
      node,
      operations: schedule.operations.filter((operation) => operation.nodeId === node.id),
    }))
    .filter((lane) => lane.operations.length > 0);

  return (
    <div className="timeline-panel gantt-panel" aria-label="Visual Gantt schedule">
      <div className="timeline-header gantt-header">
        <div>
          <p className="eyebrow">Planner view</p>
          <h4>Visual Gantt schedule</h4>
        </div>
        <span>0 → {scaleEnd} {plant.timeUnit}</span>
      </div>
      <div className="gantt-legend" aria-label="Gantt legend">
        <span><i className="legend-chip operation" aria-hidden="true" />Resource lanes</span>
        <span><i className="legend-chip due" aria-hidden="true" />Order due markers</span>
      </div>
      <div className="gantt-axis" aria-label="Gantt time axis">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${(tick / scaleEnd) * 100}%` }}>{tick}</span>
        ))}
      </div>
      <div className="timeline-rows gantt-rows">
        {lanes.map(({ node, operations }) => (
          <div className="timeline-row gantt-lane" key={node.id} aria-label={`${node.name} lane`}>
            <div className="timeline-resource">
              <strong>{node.name}</strong>
              <span>{nodeLabels[node.type]}</span>
            </div>
            <div className="timeline-track gantt-track">
              {plant.orders.map((order) => {
                const left = (order.dueTime / scaleEnd) * 100;
                return (
                  <div
                    className="gantt-due-marker"
                    key={`${node.id}-${order.id}`}
                    style={{ left: `${left}%` }}
                    title={`Due ${order.id} at ${order.dueTime}`}
                    aria-label={`Due ${order.id} at ${order.dueTime}`}
                  >
                    <span>Due {order.id} at {order.dueTime}</span>
                  </div>
                );
              })}
              {operations.map((operation) => {
                const left = (operation.start / scaleEnd) * 100;
                const width = Math.max(((operation.end - operation.start) / scaleEnd) * 100, 4);
                return (
                  <div
                    className="timeline-bar gantt-operation"
                    key={operation.id}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    aria-label={`${operation.orderId} on ${node.name} from ${operation.start} to ${operation.end}`}
                  >
                    <strong>{operation.orderId}</strong>
                    <span>{operation.start}–{operation.end} · {operation.quantity}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildTimelineTicks(scaleEnd: number): number[] {
  const step = Math.max(1, Math.ceil(scaleEnd / 4));
  return [0, step, step * 2, step * 3, scaleEnd].filter((tick, index, values) => values.indexOf(tick) === index);
}

function SolvePanel({ schedule, plant }: { schedule: Schedule | null; plant: Plant }) {
  return (
    <div className="solve-panel" aria-label="Solve feedback">
      <h3>Mock solve</h3>
      {!schedule ? (
        <p className="muted-dark">Run the mock solver to preview schedule feedback.</p>
      ) : (
        <>
          <div className={`solve-status ${schedule.status}`}>{schedule.status}</div>
          <div className="kpi-grid">
            <div>
              <strong>{schedule.kpis.makespan}</strong>
              <span>makespan</span>
            </div>
            <div>
              <strong>{schedule.kpis.lateOrders}</strong>
              <span>late orders</span>
            </div>
            <div>
              <strong>{schedule.kpis.totalTardiness}</strong>
              <span>tardiness</span>
            </div>
          </div>
          {schedule.violations.length > 0 && (
            <ul className="violation-list">
              {schedule.violations.map((violation) => (
                <li key={violation}>{violation}</li>
              ))}
            </ul>
          )}
          <ScheduleTimeline schedule={schedule} plant={plant} />
          <ol className="operation-list">
            {schedule.operations.map((operation) => {
              const node = plant.nodes.find((item) => item.id === operation.nodeId);
              return (
                <li key={operation.id}>
                  <strong>{node?.name ?? operation.nodeId}</strong>
                  <span>
                    {operation.start} → {operation.end} · {operation.quantity}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
