import { useMemo, useState } from 'react';

import type { Plant, PlantNode } from '../domain/types.js';
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

export default function App() {
  const [plant, setPlant] = useState<Plant>(() => createDemoPlant());
  const [selectedNodeId, setSelectedNodeId] = useState('node_mixer');
  const validation = useMemo(() => validatePlant(plant), [plant]);
  const selectedNode = plant.nodes.find((node) => node.id === selectedNodeId) ?? plant.nodes[0];

  const updateSelectedNode = (patch: Partial<PlantNode>) => {
    if (!selectedNode) return;
    setPlant((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === selectedNode.id ? { ...node, ...patch } : node)),
    }));
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
  };

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
          <div className="canvas-surface">
            <svg className="connection-layer" aria-hidden="true">
              {plant.connections.map((connection) => {
                const source = plant.nodes.find((node) => node.id === connection.sourceNodeId);
                const target = plant.nodes.find((node) => node.id === connection.targetNodeId);
                if (!source || !target) return null;
                return (
                  <line
                    key={connection.id}
                    x1={source.position.x + 86}
                    y1={source.position.y + 34}
                    x2={target.position.x}
                    y2={target.position.y + 34}
                  />
                );
              })}
            </svg>
            {plant.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`plant-node ${node.type} ${node.id === selectedNode?.id ? 'selected' : ''}`}
                style={{ left: node.position.x, top: node.position.y }}
                onClick={() => setSelectedNodeId(node.id)}
                aria-pressed={node.id === selectedNode?.id}
              >
                <span className="node-type">{nodeLabels[node.type]}</span>
                <strong>{node.name}</strong>
                {node.capacity !== undefined && <small>{node.capacity} cap</small>}
              </button>
            ))}
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
        </aside>
      </main>
    </div>
  );
}

function ReadinessBadge({ status }: { status: ReturnType<typeof validatePlant>['status'] }) {
  return <div className={`readiness-badge ${status}`}>{status.replaceAll('_', ' ')}</div>;
}
