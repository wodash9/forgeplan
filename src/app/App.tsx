import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Plant, PlantNode, Schedule } from '../domain/types.js';
import { createScenario } from '../domain/defaults.js';
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
};

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: PlantNode['type'];
  capacity?: number | undefined;
}

export default function App() {
  const [plant, setPlant] = useState<Plant>(() => createDemoPlant());
  const [selectedNodeId, setSelectedNodeId] = useState('node_mixer');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const validation = useMemo(() => validatePlant(plant), [plant]);
  const scenario = useMemo(() => createScenario(plant), [plant]);
  const selectedNode = plant.nodes.find((node) => node.id === selectedNodeId) ?? plant.nodes[0];

  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      plant.nodes.map((node) => ({
        id: node.id,
        type: 'default',
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          label: node.name,
          nodeType: node.type,
          capacity: node.capacity,
        },
        className: `plant-flow-node ${node.type}`,
      })),
    [plant.nodes, selectedNodeId],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      plant.connections.map((connection) => ({
        id: connection.id,
        source: connection.sourceNodeId,
        target: connection.targetNodeId,
        label: connection.materialTypes?.join(', '),
        animated: connection.enabled,
      })),
    [plant.connections],
  );

  const updateSelectedNode = (patch: Partial<PlantNode>) => {
    if (!selectedNode) return;
    setPlant((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === selectedNode.id ? { ...node, ...patch } : node)),
    }));
    setSchedule(null);
  };

  const addMixer = () => {
    const nextIndex = plant.nodes.filter((node) => node.type === 'mixer').length + 1;
    const id = `node_mixer_${nextIndex}`;
    const mixer = createNode(id, `Mixer ${nextIndex}`, 'mixer', 280 + nextIndex * 36, 260, {
      capacity: 100,
      processingTime: 30,
    });
    setPlant((current) => ({ ...current, nodes: [...current.nodes, mixer] }));
    setSelectedNodeId(id);
    setSchedule(null);
  };

  const runMockSolve = () => {
    const solverModel = buildSolverModel(plant, scenario);
    const result = mockSolverAdapter.solve(solverModel);
    setSchedule(result.schedule);
  };

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<Node<FlowNodeData>>>((_, node) => {
    setPlant((current) => ({
      ...current,
      nodes: current.nodes.map((plantNode) =>
        plantNode.id === node.id ? { ...plantNode, position: { x: node.position.x, y: node.position.y } } : plantNode,
      ),
    }));
    setSchedule(null);
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

      <main className="workspace-grid">
        <aside className="panel palette" aria-label="Plant palette">
          <p className="eyebrow">Palette</p>
          <h2>Add equipment</h2>
          <button type="button" onClick={addMixer}>Add mixer</button>
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
        </aside>

        <section className="panel canvas-panel" aria-label="Plant canvas">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Plant model</p>
              <h2>{plant.name}</h2>
            </div>
            <span>{plant.orders.length} order ready</span>
          </div>
          <div className="flow-surface" data-testid="forgeplan-flow-canvas">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              fitView
              onNodeClick={handleNodeClick}
              onNodeDragStop={handleNodeDragStop}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </section>

        <aside className="panel inspector" aria-label="Node inspector">
          <p className="eyebrow">Inspector</p>
          {selectedNode ? (
            <>
              <h2>{selectedNode.name}</h2>
              <label>
                Name
                <input value={selectedNode.name} onChange={(event) => updateSelectedNode({ name: event.target.value })} />
              </label>
              <label>
                Capacity
                <input
                  type="number"
                  min="1"
                  value={selectedNode.capacity ?? ''}
                  onChange={(event) => updateSelectedNode({ capacity: event.target.value === '' ? undefined : Number(event.target.value) })}
                />
              </label>
              <label>
                Processing time
                <input
                  type="number"
                  min="1"
                  value={selectedNode.processingTime ?? ''}
                  onChange={(event) =>
                    updateSelectedNode({ processingTime: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                />
              </label>
            </>
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

          <SolvePanel schedule={schedule} />
        </aside>
      </main>
    </div>
  );
}

function ReadinessBadge({ status }: { status: ReturnType<typeof validatePlant>['status'] }) {
  return <div className={`readiness-badge ${status}`}>{status.replaceAll('_', ' ')}</div>;
}

function SolvePanel({ schedule }: { schedule: Schedule | null }) {
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
          <ol className="operation-list">
            {schedule.operations.map((operation) => (
              <li key={operation.id}>
                <strong>{operation.nodeId}</strong>
                <span>
                  {operation.start} → {operation.end} · {operation.quantity}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
