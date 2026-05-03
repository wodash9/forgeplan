import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App, {
  addCustomPlantNode,
  addPlantConnection,
  addProductToPlant,
  buildEquipmentFlowNodes,
  buildProductDependencyGraph,
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
import { validatePlant } from '../src/validation/validatePlant.js';

describe('ForgePlan visual plant editor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('uses the PFG production plant from the PDF as the default model', () => {
    const plant = createDemoPlant();
    const nodeIds = plant.nodes.map((node) => node.id);
    const connectionPairs = plant.connections.map((connection) => `${connection.sourceNodeId}->${connection.targetNodeId}`);

    expect(plant.name).toBe('PFG Feed Production Plant');
    expect(nodeIds).toEqual(expect.arrayContaining([
      'node_raw_supply',
      'node_dosing_line',
      'node_intermediate_silo_1',
      'node_intermediate_silo_4',
      'node_granulation_line_1',
      'node_granulation_line_2',
      'node_final_silo_1',
      'node_final_silo_3',
      'node_expedition_line_1',
      'node_expedition_line_2',
    ]));
    expect(plant.nodes.find((node) => node.id === 'node_dosing_line')).toMatchObject({
      name: 'Línia Dosificació LD',
      type: 'line',
      productionMode: 'batch',
      metadata: expect.objectContaining({ pfgStage: 'dosification' }),
    });
    expect(plant.nodes.find((node) => node.id === 'node_granulation_line_1')).toMatchObject({ productionMode: 'continuous' });
    expect(connectionPairs).toEqual(expect.arrayContaining([
      'node_dosing_line->node_intermediate_silo_1',
      'node_intermediate_silo_1->node_granulation_line_1',
      'node_granulation_line_1->node_final_silo_1',
      'node_final_silo_1->node_expedition_line_1',
    ]));
    expect(validatePlant(plant).status).toBe('ready');
  });

  it('renders each node as the ISO-style equipment symbol itself instead of a square card with an icon inside', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Centro operativo de planificación' })).toBeInTheDocument();
    expect(screen.getByText(/Modelo de planta.*demanda.*cuellos de botella/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PFG Feed Production Plant' })).toBeInTheDocument();
    expect(screen.getByText('Modelo validado')).toBeInTheDocument();
    expect(screen.getByTestId('forgeplan-flow-canvas')).toBeInTheDocument();
    const dosingLineNode = screen.getByLabelText('Línia Dosificació LD line equipment node');
    expect(dosingLineNode).toBeInTheDocument();
    expect(dosingLineNode).toHaveClass('selected');
    expect(dosingLineNode).not.toHaveClass('nodrag');
    expect(dosingLineNode).not.toHaveClass('equipment-node-card');
    expect(dosingLineNode).toHaveClass('iso-equipment-node');
    expect(dosingLineNode).toHaveAttribute('data-iso-symbol', 'line');
    expect(dosingLineNode.querySelector('.equipment-card-shell')).not.toBeInTheDocument();
    expect(dosingLineNode.querySelector('svg.iso-equipment-symbol')).toBeInTheDocument();
    expect(screen.getByText(/ISA-5\.1-style instrumentation tags/)).toBeInTheDocument();
    expect(screen.getByText(/ISO 10628-style equipment/)).toBeInTheDocument();
  });

  it('adds ISA-style tag bubbles to equipment symbols without copying protected standard charts', () => {
    render(<App />);

    const dosingLineNode = screen.getByLabelText('Línia Dosificació LD line equipment node');
    const tagBubble = dosingLineNode.querySelector('.isa-tag-bubble');

    expect(tagBubble).toBeInTheDocument();
    expect(tagBubble?.querySelector('text')).toHaveTextContent('LD');
    expect(dosingLineNode.querySelector('svg.iso-equipment-symbol')).toHaveAttribute(
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
    expect(screen.getAllByText('15').length).toBeGreaterThan(0);
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

  it('builds and renders a product dependency graph so BOM relationships are visible at a glance', async () => {
    const user = userEvent.setup();
    const graph = buildProductDependencyGraph(createDemoPlant().products);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'prod_feed_premix',
      'prod_vitamin_pack',
      'prod_complete_feed',
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceProductId: 'prod_feed_premix',
        targetProductId: 'prod_complete_feed',
        label: '80 kg',
      }),
      expect.objectContaining({
        sourceProductId: 'prod_vitamin_pack',
        targetProductId: 'prod_complete_feed',
        label: '2 kg',
      }),
    ]));

    const longNameGraph = buildProductDependencyGraph([
      {
        id: 'prod_micro_ingredient_preparation_with_extended_description',
        name: 'Micro Ingredient Preparation With Extended Description',
        sku: 'MICRO-INGREDIENT-PREPARATION-EXTENDED',
        unit: 'kg',
        family: 'Intermediate family with long label',
        properties: {},
        components: [],
      },
    ]);
    expect(longNameGraph.nodes[0]).toMatchObject({
      name: 'Micro Ingredient Preparation With Extended Description',
      displayName: 'Micro Ingredient…',
      titleTextLength: 146,
      displayMeta: 'MICRO-INGREDIENT…',
      metaTextLength: 146,
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Product catalog' }));

    const graphRegion = screen.getByRole('region', { name: 'Product dependency graph' });
    expect(graphRegion).toHaveTextContent('Product dependency graph');
    expect(graphRegion).toHaveTextContent('Feed Premix → Complete Feed');
    expect(graphRegion).toHaveTextContent('Vitamin Pack → Complete Feed');
    expect(graphRegion.querySelector('[data-dependency-edge="prod_feed_premix-to-prod_complete_feed"]')).toBeInTheDocument();
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

  it('tracks continuous and batch production mode on processing equipment', async () => {
    const plant = createDemoPlant();
    const mixer = plant.nodes.find((node) => node.id === 'node_dosing_line');
    const flowNodes = buildEquipmentFlowNodes(plant, 'node_dosing_line', () => undefined);

    expect(mixer?.productionMode).toBe('batch');
    expect(flowNodes.find((node) => node.id === 'node_dosing_line')?.data).toMatchObject({
      productionMode: 'batch',
      productionModeLabel: 'Batch production',
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Línia Dosificació LD properties' }));
    expect(screen.getByLabelText('Production mode')).toHaveValue('batch');

    await user.selectOptions(screen.getByLabelText('Production mode'), 'continuous');

    expect(screen.getByLabelText('Production mode')).toHaveValue('continuous');
    expect(screen.getByLabelText('Línia Dosificació LD line equipment node')).toHaveTextContent('Continuous production');
  });

  it('keeps controlled React Flow nodes initialized with stable measured dimensions during fast drags', () => {
    const flowNodes = buildEquipmentFlowNodes(createDemoPlant(), 'node_dosing_line', () => undefined);

    expect(flowNodes).toHaveLength(14);
    expect(flowNodes.every((node) => node.measured?.width && node.measured.height)).toBe(true);
    expect(flowNodes.find((node) => node.id === 'node_dosing_line')?.measured).toEqual({ width: 136, height: 146 });
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

    const moved = movePlantNode(plant, 'node_dosing_line', { x: 380, y: 210 });
    const liveChanged = syncPlantNodePositions(plant, [
      { id: 'node_dosing_line', type: 'position', position: { x: 421, y: 222 }, dragging: true },
    ]);

    expect(moved.nodes.find((node) => node.id === 'node_dosing_line')?.position).toEqual({ x: 380, y: 210 });
    expect(liveChanged.nodes.find((node) => node.id === 'node_dosing_line')?.position).toEqual({ x: 421, y: 222 });
    expect(plant.nodes.find((node) => node.id === 'node_dosing_line')?.position).toEqual({ x: 260, y: 280 });
  });

  it('keeps the final position when many drag updates arrive quickly', () => {
    const plant = createDemoPlant();

    const rapidDrag = syncPlantNodePositions(plant, [
      { id: 'node_dosing_line', type: 'position', position: { x: 318, y: 151 }, dragging: true },
      { id: 'node_dosing_line', type: 'position', position: { x: 390, y: 210 }, dragging: true },
      { id: 'node_dosing_line', type: 'position', position: { x: 512, y: 284 }, dragging: true },
    ]);

    expect(rapidDrag.nodes.find((node) => node.id === 'node_dosing_line')?.position).toEqual({ x: 512, y: 284 });
  });

  it('keeps every pending node final position when drag changes are batched before the next frame', () => {
    const merged = mergePositionChanges(
      [
        { id: 'node_raw_supply', type: 'position', position: { x: 90, y: 150 }, dragging: true },
        { id: 'node_dosing_line', type: 'position', position: { x: 330, y: 170 }, dragging: true },
      ],
      [
        { id: 'node_dosing_line', type: 'position', position: { x: 512, y: 284 }, dragging: true },
        { id: 'node_truck_pickup', type: 'position', position: { x: 620, y: 190 }, dragging: true },
      ],
    );

    expect(merged).toEqual([
      { id: 'node_raw_supply', type: 'position', position: { x: 90, y: 150 }, dragging: true },
      { id: 'node_dosing_line', type: 'position', position: { x: 512, y: 284 }, dragging: true },
      { id: 'node_truck_pickup', type: 'position', position: { x: 620, y: 190 }, dragging: true },
    ]);
  });

  it('exposes dense perimeter connection hotspots without rendering persistent visible circles', () => {
    render(<App />);

    const dosingLineNode = screen.getByLabelText('Línia Dosificació LD line equipment node');
    const middleRightSource = dosingLineNode.querySelector('[data-handleid="right-50-source"]');

    expect(perimeterConnectionAnchors).toHaveLength(20);
    expect(dosingLineNode.querySelectorAll('.iso-perimeter-handle.source')).toHaveLength(20);
    expect(dosingLineNode.querySelectorAll('.iso-perimeter-handle.target')).toHaveLength(20);
    expect(dosingLineNode.querySelector('[data-handleid="top-50-source"]')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('[data-handleid="right-85-source"]')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('[data-handleid="bottom-15-target"]')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('[data-handleid="left-68-target"]')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('.connection-perimeter-highlight')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('.connection-perimeter-highlight')).toHaveAttribute('aria-hidden', 'true');
    expect(middleRightSource).toHaveClass('connection-hotspot');
    expect(middleRightSource).toHaveClass('continuous-perimeter-hotspot');
    expect(middleRightSource).toHaveAttribute('aria-label', 'Connection hotspot right 50 source');
  });

  it('shows separate visual affordances for selecting the node body versus creating connections on the perimeter', () => {
    render(<App />);

    const dosingLineNode = screen.getByLabelText('Línia Dosificació LD line equipment node');
    const connectionHotspot = dosingLineNode.querySelector('[data-handleid="right-68-source"]');

    expect(dosingLineNode).toHaveAttribute('data-interaction-mode', 'select-node');
    expect(dosingLineNode.querySelector('.selection-mode-highlight')).toBeInTheDocument();
    expect(dosingLineNode.querySelector('.select-mode-hint')).toHaveTextContent('Select / drag node');
    expect(dosingLineNode.querySelector('.connection-mode-hint')).toHaveTextContent('Connect from perimeter');
    expect(connectionHotspot).toHaveAttribute('data-interaction-mode', 'connect-edge');
    expect(connectionHotspot).toHaveAttribute('title', 'Connect from right 68 source');
  });

  it('does not open node properties when clicking a perimeter handle to connect', () => {
    render(<App />);

    const dosingLineNode = screen.getByLabelText('Línia Dosificació LD line equipment node');
    fireEvent.click(dosingLineNode.querySelector('[data-handleid="right-68-source"]')!);

    expect(screen.queryByRole('dialog', { name: 'Línia Dosificació LD properties' })).not.toBeInTheDocument();
  });

  it('creates a new enabled plant connection from any dense perimeter point', () => {
    const plant = createDemoPlant();

    const connected = addPlantConnection(plant, {
      source: 'node_raw_supply',
      target: 'node_truck_pickup',
      sourceHandle: 'bottom-68-source',
      targetHandle: 'top-32-target',
    });

    const newConnection = connected.connections.at(-1);
    expect(newConnection).toMatchObject({
      sourceNodeId: 'node_raw_supply',
      targetNodeId: 'node_truck_pickup',
      enabled: true,
      materialTypes: ['mat_feed'],
      capacity: 100,
      transportTime: 0,
    });
    expect(newConnection?.id).toBe('conn_node_raw_supply_node_truck_pickup');
    expect(newConnection?.metadata).toMatchObject({ sourceHandle: 'bottom-68-source', targetHandle: 'top-32-target' });
  });

  it('moves existing connection endpoints around the node perimeter', () => {
    const plant = createDemoPlant();

    const movedSource = movePlantConnectionEndpoint(plant, 'conn_le1_dispatch', 'source', 'left-85-source');
    const movedTarget = movePlantConnectionEndpoint(movedSource, 'conn_le1_dispatch', 'target', 'right-32-target');
    const connection = movedTarget.connections.find((item) => item.id === 'conn_le1_dispatch');

    expect(connection?.metadata).toMatchObject({ sourceHandle: 'left-85-source', targetHandle: 'right-32-target' });
  });

  it('reconnects an existing connection when an edge endpoint is dragged to another perimeter point', () => {
    const plant = createDemoPlant();

    const reconnected = reconnectPlantConnection(plant, 'conn_le1_dispatch', {
      source: 'node_raw_supply',
      target: 'node_truck_pickup',
      sourceHandle: 'left-68-source',
      targetHandle: 'right-32-target',
    });
    const connection = reconnected.connections.find((item) => item.id === 'conn_le1_dispatch');

    expect(connection).toMatchObject({ sourceNodeId: 'node_raw_supply', targetNodeId: 'node_truck_pickup' });
    expect(connection?.metadata).toMatchObject({ sourceHandle: 'left-68-source', targetHandle: 'right-32-target' });
    expect(reconnectPlantConnection(plant, 'conn_le1_dispatch', { source: 'node_raw_supply', target: 'node_raw_supply' })).toBe(plant);
  });

  it('ignores invalid connection endpoints instead of creating broken edges', () => {
    const plant = createDemoPlant();

    expect(addPlantConnection(plant, { source: 'node_missing', target: 'node_truck_pickup' })).toBe(plant);
    expect(addPlantConnection(plant, { source: 'node_raw_supply', target: 'node_raw_supply' })).toBe(plant);
  });

  it('opens a connection properties popup and edits connection characteristics', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Edit connection conn_le1_dispatch' }));

    expect(screen.getByRole('dialog', { name: 'conn_le1_dispatch connection properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Material types')).toHaveValue('mat_feed');
    expect(screen.getByLabelText('Connection capacity')).toHaveValue(120);
    expect(screen.getByLabelText('Transport time')).toHaveValue(0);

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
    expect(screen.getByText('Source: node_expedition_line_1 · bottom-68-source')).toBeInTheDocument();
    expect(screen.getByText('Target: node_truck_pickup · top-32-target')).toBeInTheDocument();
    expect(screen.getByLabelText('Connection enabled')).not.toBeChecked();
  });

  it('adds a mixer node and selects it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));

    expect(screen.getAllByText('Mixer 1').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Mixer 1 mixer equipment node')).toBeInTheDocument();
  });

  it('selects a node from the canvas without opening properties, and opens properties from the node action icon', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.click(screen.getByLabelText('Raw material availability source equipment node'));

    expect(screen.queryByRole('dialog', { name: 'Raw material availability properties' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Raw material availability' })).toBeInTheDocument();
    expect(screen.getByLabelText('Raw material availability source equipment node')).toHaveClass('selected');

    await user.click(screen.getByRole('button', { name: 'Open Raw material availability properties' }));

    expect(screen.getByRole('dialog', { name: 'Raw material availability properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Equipment name')).toHaveValue('Raw material availability');
  });

  it('opens a properties popup from the node action icon and edits its characteristics', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open Línia Dosificació LD properties' }));

    expect(screen.getByRole('dialog', { name: 'Línia Dosificació LD properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Equipment name')).toHaveValue('Línia Dosificació LD');
    expect(screen.getByLabelText('Equipment type')).toHaveValue('line');

    await user.clear(screen.getByLabelText('Equipment name'));
    await user.type(screen.getByLabelText('Equipment name'), 'Granuladora principal');
    await user.clear(screen.getByLabelText('Capacity'));
    await user.type(screen.getByLabelText('Capacity'), '175');

    expect(screen.getByLabelText('Granuladora principal line equipment node')).toBeInTheDocument();
    expect(screen.getByDisplayValue('175')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close properties' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('generates unique mixer ids even after a node type changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));
    await user.click(screen.getByRole('button', { name: 'Open Mixer 1 properties' }));
    await user.selectOptions(screen.getByLabelText('Equipment type'), 'tank');
    await user.click(screen.getByRole('button', { name: 'Close properties' }));

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));

    expect(screen.getByLabelText('Mixer 2 mixer equipment node')).toBeInTheDocument();
  });

  it('exports the current plant model as pretty JSON and imports a valid JSON model', () => {
    const plant = createDemoPlant();
    const json = serializePlantModelForExport(plant);

    expect(json).toContain('"name": "PFG Feed Production Plant"');
    expect(json).toContain('\n  "nodes"');
    expect(importPlantModelFromJson(json)).toEqual(plant);

    const renamed = importPlantModelFromJson(json.replace('PFG Feed Production Plant', 'Imported CIP Plant'));
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
    expect((screen.getByLabelText('Exported plant JSON') as HTMLTextAreaElement).value).toContain('PFG Feed Production Plant');
    await user.click(screen.getByRole('button', { name: 'Close export JSON' }));

    const importedPlant = { ...createDemoPlant(), id: 'plant_imported_cip', name: 'Imported CIP Plant' };
    await user.click(screen.getByRole('button', { name: 'Import JSON' }));
    fireEvent.change(screen.getByLabelText('Plant JSON import'), {
      target: { value: serializePlantModelForExport(importedPlant) },
    });
    await user.click(screen.getByRole('button', { name: 'Import model' }));

    expect(screen.getByRole('heading', { name: 'Imported CIP Plant' })).toBeInTheDocument();
    expect(screen.getAllByText(/Saved to local DB/).length).toBeGreaterThan(0);
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
      expect(window.localStorage.getItem(`plants:${plant.id}`)).toContain('PFG Feed Production Plant');
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
    await waitFor(() => expect(screen.getAllByText(/Saved to local DB/).length).toBeGreaterThan(0));
  });

  it('renders planner-facing orders and lets the planner edit demo demand', async () => {
    const user = userEvent.setup();
    render(<App />);

    const ordersPanel = screen.getByRole('region', { name: 'Pedidos a planificar' });
    expect(ordersPanel).toHaveTextContent('order_1');
    expect(ordersPanel).toHaveTextContent('Feed product flow');
    expect(ordersPanel).toHaveTextContent('80 kg');
    expect(ordersPanel).toHaveTextContent('Entrega: 420 minute');
    expect(ordersPanel).toHaveTextContent('Prioridad: 1');

    await user.clear(screen.getByLabelText('Cantidad de order_1'));
    await user.type(screen.getByLabelText('Cantidad de order_1'), '95');

    expect(ordersPanel).toHaveTextContent('95 kg');
  });

  it('runs the planner demo solve and explains the result in planner language', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getAllByText('Solver demo').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Planificar pedidos' }));

    expect(screen.getByLabelText('Solve feedback')).toHaveTextContent('feasible');
    expect(screen.getByText('makespan')).toBeInTheDocument();
    expect(screen.getByText('late orders')).toBeInTheDocument();
    expect(screen.getByText('tardiness')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Qué ha pasado' })).toHaveTextContent('Cuello de botella probable');
    expect(screen.getByRole('region', { name: 'Qué ha pasado' })).toHaveTextContent('Siguiente acción');
    expect(screen.getByLabelText('Visual Gantt schedule')).toBeInTheDocument();
    expect(screen.getByText('Visual Gantt schedule')).toBeInTheDocument();
    expect(screen.getByText('Resource lanes')).toBeInTheDocument();
    expect(screen.getByText('Order due markers')).toBeInTheDocument();
    expect(screen.getAllByText('Due order_1 at 420').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Línia Dosificació LD lane')).toBeInTheDocument();
    expect(screen.getByLabelText('order_1 on Línia Dosificació LD from 0 to 45')).toBeInTheDocument();
    expect(screen.getByText(/0–45/)).toBeInTheDocument();
    expect(screen.getAllByText(/0 → 45/).length).toBeGreaterThan(0);
  });

  it('sends the current plant to the local CP-SAT API when the planner selects the real solver path', async () => {
    const user = userEvent.setup();
    const cpSatSchedule = {
      id: 'schedule_cp_sat_ui_test',
      plantId: 'plant_pfg_feed_production',
      scenarioId: 'scenario_cp_sat_ui_test',
      status: 'optimal',
      strategy: 'cp_sat',
      operations: [{
        id: 'scheduled_order_1_cp_sat',
        orderId: 'order_1',
        nodeId: 'node_dosing_line',
        materialId: 'mat_feed',
        start: 0,
        end: 45,
        quantity: 80,
      }],
      kpis: { lateOrders: 0, totalTardiness: 0, makespan: 45 },
      violations: [],
      explanations: ['Solved by local CP-SAT test API.'],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'plant_pfg_feed_production' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'optimal',
        issues: [],
        scenario: { id: 'scenario_cp_sat_ui_test', plantId: 'plant_pfg_feed_production' },
        schedule: cpSatSchedule,
      }), { status: 201 }));

    render(<App />);

    await user.selectOptions(screen.getByLabelText('Estrategia de planificación'), 'cp_sat');
    await user.clear(screen.getByLabelText('Límite CP-SAT (s)'));
    await user.type(screen.getByLabelText('Límite CP-SAT (s)'), '9');
    await user.clear(screen.getByLabelText('Workers CP-SAT'));
    await user.type(screen.getByLabelText('Workers CP-SAT'), '2');
    await user.click(screen.getByRole('button', { name: 'Planificar pedidos' }));

    await waitFor(() => expect(screen.getByLabelText('Solve feedback')).toHaveTextContent('optimal'));
    expect(screen.getByText('CP-SAT local')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:8787/api/plants');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      id: 'plant_pfg_feed_production',
      orders: expect.arrayContaining([expect.objectContaining({ id: 'order_1', quantity: 80 })]),
    });
    expect(fetchMock.mock.calls[1]![0]).toBe('http://127.0.0.1:8787/api/solve/cp-sat');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      plantId: 'plant_pfg_feed_production',
      timeLimitSeconds: 9,
      workers: 2,
    });
  });
});
