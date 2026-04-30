import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import App, {
  addCustomPlantNode,
  addPlantConnection,
  addProductToPlant,
  buildEquipmentFlowNodes,
  importPlantModelFromJson,
  serializePlantModelForExport,
  mergePositionChanges,
  movePlantConnectionEndpoint,
  movePlantNode,
  perimeterConnectionAnchors,
  persistPlantModelToBrowserDb,
  plantCanvasMinZoom,
  plantNodeDragExtent,
  reconnectPlantConnection,
  syncPlantNodePositions,
} from '../src/app/App.js';
import { createDemoPlant } from '../src/app/demoPlant.js';

describe('ForgePlan visual plant editor', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders each node as the ISO-style equipment symbol itself instead of a square card with an icon inside', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Visual Plant Editor MVP' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ForgePlan Demo Plant' })).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByTestId('forgeplan-flow-canvas')).toBeInTheDocument();
    const mixerNode = screen.getByLabelText('Mixer 1 mixer equipment node');
    expect(mixerNode).toBeInTheDocument();
    expect(mixerNode).not.toHaveClass('nodrag');
    expect(mixerNode).not.toHaveClass('equipment-node-card');
    expect(mixerNode).toHaveClass('iso-equipment-node');
    expect(mixerNode).toHaveAttribute('data-iso-symbol', 'mixer');
    expect(mixerNode.querySelector('.equipment-card-shell')).not.toBeInTheDocument();
    expect(mixerNode.querySelector('svg.iso-equipment-symbol')).toBeInTheDocument();
    expect(screen.getByText(/ISA-5\.1-style instrumentation tags/)).toBeInTheDocument();
    expect(screen.getByText(/ISO 10628-style equipment/)).toBeInTheDocument();
  });

  it('adds ISA-style tag bubbles to equipment symbols without copying protected standard charts', () => {
    render(<App />);

    const mixerNode = screen.getByLabelText('Mixer 1 mixer equipment node');
    const tagBubble = mixerNode.querySelector('.isa-tag-bubble');

    expect(tagBubble).toBeInTheDocument();
    expect(tagBubble?.querySelector('text')).toHaveTextContent('MIX');
    expect(mixerNode.querySelector('svg.iso-equipment-symbol')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('ISA-5.1-style instrumentation tag'),
    );
  });

  it('creates a custom plant node with its own ISA tag and custom properties', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Create custom node' }));

    expect(screen.getByRole('dialog', { name: 'Create custom node' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Custom node name'));
    await user.type(screen.getByLabelText('Custom node name'), 'CIP Skid');
    await user.clear(screen.getByLabelText('Custom equipment class'));
    await user.type(screen.getByLabelText('Custom equipment class'), 'CIP skid');
    await user.clear(screen.getByLabelText('ISA tag'));
    await user.type(screen.getByLabelText('ISA tag'), 'CIP-401');
    await user.clear(screen.getByLabelText('Capacity'));
    await user.type(screen.getByLabelText('Capacity'), '250');
    await user.clear(screen.getByLabelText('Processing time'));
    await user.type(screen.getByLabelText('Processing time'), '18');
    await user.clear(screen.getByLabelText('Custom properties'));
    await user.type(screen.getByLabelText('Custom properties'), 'cleaning=CIP\noperator=night shift');
    await user.click(screen.getByRole('button', { name: 'Create node' }));

    expect(screen.getByLabelText('CIP Skid custom equipment node')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open CIP Skid properties' }));
    expect(screen.getByRole('dialog', { name: 'CIP Skid properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom equipment class')).toHaveValue('CIP skid');
    expect(screen.getByLabelText('ISA tag')).toHaveValue('CIP-401');
    expect(screen.getByLabelText('Custom properties')).toHaveValue('cleaning=CIP\noperator=night shift');
  });

  it('adds a product with properties and bill-of-material dependencies through a pure helper', () => {
    const plant = createDemoPlant();
    const result = addProductToPlant(plant, {
      name: 'Premium Feed 18%',
      sku: 'PF-18',
      unit: 'kg',
      family: 'Finished feed',
      properties: { protein: '18%', allergen: 'none' },
      components: [{ productId: 'prod_feed_premix', quantity: 80 }],
    });

    const product = result.plant.products.find((item) => item.id === result.productId);
    expect(product).toMatchObject({
      id: 'prod_premium_feed_18',
      name: 'Premium Feed 18%',
      sku: 'PF-18',
      unit: 'kg',
      family: 'Finished feed',
      properties: { protein: '18%', allergen: 'none' },
      components: [{ productId: 'prod_feed_premix', quantity: 80 }],
    });
  });

  it('renders a product catalog screen with list, product form, properties, and dependencies', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Product catalog' }));

    expect(screen.getByRole('heading', { name: 'Product catalog & BOM' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Product list' })).toHaveTextContent('Complete Feed');
    expect(screen.getByRole('region', { name: 'Product list' })).toHaveTextContent('Feed Premix × 80 kg');
    expect(screen.getByRole('form', { name: 'Create product form' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Product name'));
    await user.type(screen.getByLabelText('Product name'), 'Premium Feed 18%');
    await user.clear(screen.getByLabelText('SKU'));
    await user.type(screen.getByLabelText('SKU'), 'PF-18');
    await user.clear(screen.getByLabelText('Properties'));
    await user.type(screen.getByLabelText('Properties'), 'protein=18%\ntexture=pellet');
    await user.selectOptions(screen.getByLabelText('Component product'), 'prod_feed_premix');
    await user.clear(screen.getByLabelText('Component quantity'));
    await user.type(screen.getByLabelText('Component quantity'), '80');
    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByText('Feed Premix × 80 kg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(screen.getByRole('region', { name: 'Product list' })).toHaveTextContent('Premium Feed 18%');
    expect(screen.getByRole('region', { name: 'Product list' })).toHaveTextContent('protein: 18%');
  });

  it('stores custom plant node metadata through a pure add helper', () => {
    const result = addCustomPlantNode(createDemoPlant(), {
      name: 'Quality Gate',
      customTypeName: 'QC gate',
      isaTag: 'QG-210',
      capacity: 40,
      processingTime: 12,
      customProperties: { owner: 'QA', risk: 'hold' },
    });

    const customNode = result.plant.nodes.find((node) => node.id === result.nodeId);
    expect(customNode).toMatchObject({
      id: 'node_custom',
      name: 'Quality Gate',
      type: 'custom',
      capacity: 40,
      processingTime: 12,
      metadata: {
        customTypeName: 'QC gate',
        isaTag: 'QG-210',
        customProperties: { owner: 'QA', risk: 'hold' },
      },
    });
  });

  it('keeps controlled React Flow nodes initialized with stable measured dimensions during fast drags', () => {
    const flowNodes = buildEquipmentFlowNodes(createDemoPlant(), 'node_mixer', () => undefined);

    expect(flowNodes).toHaveLength(3);
    expect(flowNodes.every((node) => node.measured?.width && node.measured.height)).toBe(true);
    expect(flowNodes.find((node) => node.id === 'node_mixer')?.measured).toEqual({ width: 136, height: 146 });
    expect(plantNodeDragExtent).toEqual([[-10_000, -10_000], [10_000, 10_000]]);
  });

  it('keeps a spacious React Flow node extent so zoomed-out drags are not clamped near the initial canvas', () => {
    const [[minX, minY], [maxX, maxY]] = plantNodeDragExtent;

    expect(minX).toBeLessThanOrEqual(-10_000);
    expect(minY).toBeLessThanOrEqual(-10_000);
    expect(maxX).toBeGreaterThanOrEqual(10_000);
    expect(maxY).toBeGreaterThanOrEqual(10_000);
    expect(maxX - minX).toBeGreaterThanOrEqual(20_000);
    expect(maxY - minY).toBeGreaterThanOrEqual(20_000);
    expect(plantCanvasMinZoom).toBeLessThanOrEqual(0.15);
  });

  it('updates plant node positions during drag changes so controlled React Flow nodes visibly follow the pointer', () => {
    const plant = createDemoPlant();

    const moved = movePlantNode(plant, 'node_mixer', { x: 380, y: 210 });
    const liveChanged = syncPlantNodePositions(plant, [
      { id: 'node_mixer', type: 'position', position: { x: 421, y: 222 }, dragging: true },
    ]);

    expect(moved.nodes.find((node) => node.id === 'node_mixer')?.position).toEqual({ x: 380, y: 210 });
    expect(liveChanged.nodes.find((node) => node.id === 'node_mixer')?.position).toEqual({ x: 421, y: 222 });
    expect(plant.nodes.find((node) => node.id === 'node_mixer')?.position).toEqual({ x: 300, y: 140 });
  });

  it('keeps the final position when many drag updates arrive quickly', () => {
    const plant = createDemoPlant();

    const rapidDrag = syncPlantNodePositions(plant, [
      { id: 'node_mixer', type: 'position', position: { x: 318, y: 151 }, dragging: true },
      { id: 'node_mixer', type: 'position', position: { x: 390, y: 210 }, dragging: true },
      { id: 'node_mixer', type: 'position', position: { x: 512, y: 284 }, dragging: true },
    ]);

    expect(rapidDrag.nodes.find((node) => node.id === 'node_mixer')?.position).toEqual({ x: 512, y: 284 });
  });

  it('keeps every pending node final position when drag changes are batched before the next frame', () => {
    const merged = mergePositionChanges(
      [
        { id: 'node_source', type: 'position', position: { x: 90, y: 150 }, dragging: true },
        { id: 'node_mixer', type: 'position', position: { x: 330, y: 170 }, dragging: true },
      ],
      [
        { id: 'node_mixer', type: 'position', position: { x: 512, y: 284 }, dragging: true },
        { id: 'node_dispatch', type: 'position', position: { x: 620, y: 190 }, dragging: true },
      ],
    );

    expect(merged).toEqual([
      { id: 'node_source', type: 'position', position: { x: 90, y: 150 }, dragging: true },
      { id: 'node_mixer', type: 'position', position: { x: 512, y: 284 }, dragging: true },
      { id: 'node_dispatch', type: 'position', position: { x: 620, y: 190 }, dragging: true },
    ]);
  });

  it('exposes dense perimeter connection hotspots without rendering persistent visible circles', () => {
    render(<App />);

    const mixerNode = screen.getByLabelText('Mixer 1 mixer equipment node');
    const middleRightSource = mixerNode.querySelector('[data-handleid="right-50-source"]');

    expect(perimeterConnectionAnchors).toHaveLength(20);
    expect(mixerNode.querySelectorAll('.iso-perimeter-handle.source')).toHaveLength(20);
    expect(mixerNode.querySelectorAll('.iso-perimeter-handle.target')).toHaveLength(20);
    expect(mixerNode.querySelector('[data-handleid="top-50-source"]')).toBeInTheDocument();
    expect(mixerNode.querySelector('[data-handleid="right-85-source"]')).toBeInTheDocument();
    expect(mixerNode.querySelector('[data-handleid="bottom-15-target"]')).toBeInTheDocument();
    expect(mixerNode.querySelector('[data-handleid="left-68-target"]')).toBeInTheDocument();
    expect(mixerNode.querySelector('.connection-perimeter-highlight')).toBeInTheDocument();
    expect(mixerNode.querySelector('.connection-perimeter-highlight')).toHaveAttribute('aria-hidden', 'true');
    expect(middleRightSource).toHaveClass('connection-hotspot');
    expect(middleRightSource).toHaveClass('continuous-perimeter-hotspot');
    expect(middleRightSource).toHaveAttribute('aria-label', 'Connection hotspot right 50 source');
  });

  it('shows separate visual affordances for selecting the node body versus creating connections on the perimeter', () => {
    render(<App />);

    const mixerNode = screen.getByLabelText('Mixer 1 mixer equipment node');
    const connectionHotspot = mixerNode.querySelector('[data-handleid="right-68-source"]');

    expect(mixerNode).toHaveAttribute('data-interaction-mode', 'select-node');
    expect(mixerNode.querySelector('.selection-mode-highlight')).toBeInTheDocument();
    expect(mixerNode.querySelector('.select-mode-hint')).toHaveTextContent('Select / drag node');
    expect(mixerNode.querySelector('.connection-mode-hint')).toHaveTextContent('Connect from perimeter');
    expect(connectionHotspot).toHaveAttribute('data-interaction-mode', 'connect-edge');
    expect(connectionHotspot).toHaveAttribute('title', 'Connect from right 68 source');
  });

  it('does not open node properties when clicking a perimeter handle to connect', () => {
    render(<App />);

    const mixerNode = screen.getByLabelText('Mixer 1 mixer equipment node');
    fireEvent.click(mixerNode.querySelector('[data-handleid="right-68-source"]')!);

    expect(screen.queryByRole('dialog', { name: 'Mixer 1 properties' })).not.toBeInTheDocument();
  });

  it('creates a new enabled plant connection from any dense perimeter point', () => {
    const plant = createDemoPlant();

    const connected = addPlantConnection(plant, {
      source: 'node_source',
      target: 'node_dispatch',
      sourceHandle: 'bottom-68-source',
      targetHandle: 'top-32-target',
    });

    const newConnection = connected.connections.at(-1);
    expect(newConnection).toMatchObject({
      sourceNodeId: 'node_source',
      targetNodeId: 'node_dispatch',
      enabled: true,
      materialTypes: ['mat_feed'],
      capacity: 100,
      transportTime: 0,
    });
    expect(newConnection?.id).toBe('conn_node_source_node_dispatch');
    expect(newConnection?.metadata).toMatchObject({ sourceHandle: 'bottom-68-source', targetHandle: 'top-32-target' });
  });

  it('moves existing connection endpoints around the node perimeter', () => {
    const plant = createDemoPlant();

    const movedSource = movePlantConnectionEndpoint(plant, 'conn_mixer_dispatch', 'source', 'left-85-source');
    const movedTarget = movePlantConnectionEndpoint(movedSource, 'conn_mixer_dispatch', 'target', 'right-32-target');
    const connection = movedTarget.connections.find((item) => item.id === 'conn_mixer_dispatch');

    expect(connection?.metadata).toMatchObject({ sourceHandle: 'left-85-source', targetHandle: 'right-32-target' });
  });

  it('reconnects an existing connection when an edge endpoint is dragged to another perimeter point', () => {
    const plant = createDemoPlant();

    const reconnected = reconnectPlantConnection(plant, 'conn_mixer_dispatch', {
      source: 'node_source',
      target: 'node_dispatch',
      sourceHandle: 'left-68-source',
      targetHandle: 'right-32-target',
    });
    const connection = reconnected.connections.find((item) => item.id === 'conn_mixer_dispatch');

    expect(connection).toMatchObject({ sourceNodeId: 'node_source', targetNodeId: 'node_dispatch' });
    expect(connection?.metadata).toMatchObject({ sourceHandle: 'left-68-source', targetHandle: 'right-32-target' });
    expect(reconnectPlantConnection(plant, 'conn_mixer_dispatch', { source: 'node_source', target: 'node_source' })).toBe(plant);
  });

  it('ignores invalid connection endpoints instead of creating broken edges', () => {
    const plant = createDemoPlant();

    expect(addPlantConnection(plant, { source: 'node_missing', target: 'node_dispatch' })).toBe(plant);
    expect(addPlantConnection(plant, { source: 'node_source', target: 'node_source' })).toBe(plant);
  });

  it('opens a connection properties popup and edits connection characteristics', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Edit connection conn_mixer_dispatch' }));

    expect(screen.getByRole('dialog', { name: 'conn_mixer_dispatch connection properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Material types')).toHaveValue('mat_feed');
    expect(screen.getByLabelText('Connection capacity')).toHaveValue(100);
    expect(screen.getByLabelText('Transport time')).toHaveValue(5);

    await user.clear(screen.getByLabelText('Material types'));
    await user.type(screen.getByLabelText('Material types'), 'mat_feed, mat_additive');
    await user.clear(screen.getByLabelText('Transport time'));
    await user.type(screen.getByLabelText('Transport time'), '12');
    await user.selectOptions(screen.getByLabelText('Source perimeter point'), 'bottom-68-source');
    await user.selectOptions(screen.getByLabelText('Target perimeter point'), 'top-32-target');
    await user.click(screen.getByLabelText('Connection enabled'));

    expect(screen.getByDisplayValue('mat_feed, mat_additive')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByLabelText('Source perimeter point')).toHaveValue('bottom-68-source');
    expect(screen.getByLabelText('Target perimeter point')).toHaveValue('top-32-target');
    expect(screen.getByText('Source: node_mixer · bottom-68-source')).toBeInTheDocument();
    expect(screen.getByText('Target: node_dispatch · top-32-target')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection enabled')).not.toBeChecked();
  });

  it('adds a mixer node and selects it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));

    expect(screen.getAllByText('Mixer 2').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Mixer 2 mixer equipment node')).toBeInTheDocument();
  });

  it('selects a node from the canvas without opening properties, and opens properties from the node action icon', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.click(screen.getByLabelText('Raw Input source equipment node'));

    expect(screen.queryByRole('dialog', { name: 'Raw Input properties' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Raw Input' })).toBeInTheDocument();
    expect(screen.getByLabelText('Raw Input source equipment node')).toHaveClass('selected');

    await user.click(screen.getByRole('button', { name: 'Open Raw Input properties' }));

    expect(screen.getByRole('dialog', { name: 'Raw Input properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Equipment name')).toHaveValue('Raw Input');
  });

  it('opens a properties popup from the node action icon and edits its characteristics', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Mixer 1 properties' }));

    expect(screen.getByRole('dialog', { name: 'Mixer 1 properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Equipment name')).toHaveValue('Mixer 1');
    expect(screen.getByLabelText('Equipment type')).toHaveValue('mixer');

    await user.clear(screen.getByLabelText('Equipment name'));
    await user.type(screen.getByLabelText('Equipment name'), 'Granuladora principal');
    await user.clear(screen.getByLabelText('Capacity'));
    await user.type(screen.getByLabelText('Capacity'), '175');

    expect(screen.getByLabelText('Granuladora principal mixer equipment node')).toBeInTheDocument();
    expect(screen.getByDisplayValue('175')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close properties' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('generates unique mixer ids even after a node type changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));
    await user.click(screen.getByRole('button', { name: 'Open Mixer 2 properties' }));
    await user.selectOptions(screen.getByLabelText('Equipment type'), 'tank');
    await user.click(screen.getByRole('button', { name: 'Close properties' }));

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));

    expect(screen.getByLabelText('Mixer 3 mixer equipment node')).toBeInTheDocument();
  });

  it('exports the current plant model as pretty JSON and imports a valid JSON model', () => {
    const plant = createDemoPlant();
    const json = serializePlantModelForExport(plant);

    expect(json).toContain('"name": "ForgePlan Demo Plant"');
    expect(json).toContain('\n  "nodes"');
    expect(importPlantModelFromJson(json)).toEqual(plant);

    const renamed = importPlantModelFromJson(json.replace('ForgePlan Demo Plant', 'Imported CIP Plant'));
    expect(renamed.name).toBe('Imported CIP Plant');
  });

  it('rejects invalid JSON imports before mutating the plant', () => {
    expect(() => importPlantModelFromJson('{bad json')).toThrow(/Invalid JSON/);
    expect(() => importPlantModelFromJson(JSON.stringify({ id: 'x', nodes: [] }))).toThrow(/Invalid plant model/);
  });

  it('opens import/export controls and imports a pasted JSON plant model', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(screen.getByRole('dialog', { name: 'Export plant JSON' })).toBeInTheDocument();
    expect((screen.getByLabelText('Exported plant JSON') as HTMLTextAreaElement).value).toContain('ForgePlan Demo Plant');
    await user.click(screen.getByRole('button', { name: 'Close export JSON' }));

    const importedPlant = { ...createDemoPlant(), id: 'plant_imported_cip', name: 'Imported CIP Plant' };
    await user.click(screen.getByRole('button', { name: 'Import JSON' }));
    fireEvent.change(screen.getByLabelText('Plant JSON import'), {
      target: { value: serializePlantModelForExport(importedPlant) },
    });
    await user.click(screen.getByRole('button', { name: 'Import model' }));

    expect(screen.getByRole('heading', { name: 'Imported CIP Plant' })).toBeInTheDocument();
    expect(screen.getByText(/Saved to local DB/)).toBeInTheDocument();
  });

  it('falls back to localStorage if opening IndexedDB fails while persisting the browser model', async () => {
    const plant = createDemoPlant();
    const originalIndexedDb = window.indexedDB;
    const failingIndexedDb = {
      open: () => {
        const request: { error: Error; onerror: ((event: Event) => void) | null } = {
          error: new Error('blocked IndexedDB'),
          onerror: null,
        };
        window.setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    Object.defineProperty(window, 'indexedDB', { configurable: true, value: failingIndexedDb });
    try {
      await expect(persistPlantModelToBrowserDb(plant)).rejects.toThrow('blocked IndexedDB');
      expect(window.localStorage.getItem('forgeplan.latestPlantId')).toBe(plant.id);
      expect(window.localStorage.getItem(`plants:${plant.id}`)).toContain('ForgePlan Demo Plant');
    } finally {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
    }
  });

  it('loads the latest model persisted in the local browser DB on startup', async () => {
    const persistedPlant = { ...createDemoPlant(), id: 'plant_persisted', name: 'Persisted CIP Plant' };
    window.localStorage.setItem('plants:plant_persisted', serializePlantModelForExport(persistedPlant));
    window.localStorage.setItem('forgeplan.latestPlantId', 'plant_persisted');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Persisted CIP Plant' })).toBeInTheDocument();
    expect(await screen.findByText(/Saved to local DB/)).toBeInTheDocument();
  });

  it('runs a mock solve and shows schedule feedback', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Run mock solve' }));

    expect(screen.getByLabelText('Solve feedback')).toHaveTextContent('feasible');
    expect(screen.getByText('makespan')).toBeInTheDocument();
    expect(screen.getByText('late orders')).toBeInTheDocument();
    expect(screen.getByText('tardiness')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual Gantt schedule')).toBeInTheDocument();
    expect(screen.getByText('Visual Gantt schedule')).toBeInTheDocument();
    expect(screen.getByText('Resource lanes')).toBeInTheDocument();
    expect(screen.getByText('Order due markers')).toBeInTheDocument();
    expect(screen.getByText('Due order_1 at 240')).toBeInTheDocument();
    expect(screen.getByLabelText('Mixer 1 lane')).toBeInTheDocument();
    expect(screen.getByLabelText('order_1 on Mixer 1 from 0 to 30')).toBeInTheDocument();
    expect(screen.getByText(/0–30/)).toBeInTheDocument();
    expect(screen.getAllByText(/0 → 30/).length).toBeGreaterThan(0);
  });
});
