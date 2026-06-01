import { useEffect, useMemo, useState } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from 'd3-force';
import { X, Brain } from 'lucide-react';
import { Button } from './components/ui/button';
import { api } from './api';
import type { MemoryGraph, MemoryGraphNode } from './types';

const W = 920;
const H = 600;

// Node colors by type / memory kind.
const KIND_COLOR: Record<string, string> = {
  fact: '#60a5fa', // blue
  decision: '#f59e0b', // amber
  preference: '#34d399', // green
  milestone: '#a78bfa', // purple
  episodic: '#94a3b8', // slate
};
function colorFor(n: MemoryGraphNode): string {
  if (n.type === 'entity') return '#2dd4bf'; // teal
  if (n.type === 'tag') return '#e879f9'; // fuchsia
  return KIND_COLOR[n.kind ?? 'fact'] ?? '#60a5fa';
}
function radiusFor(n: MemoryGraphNode): number {
  return Math.min(6 + n.degree * 2.2, 20);
}

interface SimNode extends SimulationNodeDatum, MemoryGraphNode {}

/** Compute a static force-directed layout for the graph (synchronous, deterministic-ish). */
function layout(graph: MemoryGraph): {
  nodes: SimNode[];
  links: Array<[SimNode, SimNode]>;
  viewBox: string;
} {
  const nodes: SimNode[] = graph.nodes.map((n, i) => ({
    ...n,
    // Seed positions on a ring so the (unseeded) sim converges the same way each run.
    x: W / 2 + Math.cos((i / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * 200,
    y: H / 2 + Math.sin((i / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * 200,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = graph.edges
    .map((e) => [byId.get(e.source), byId.get(e.target)] as [SimNode, SimNode])
    .filter((l): l is [SimNode, SimNode] => Boolean(l[0] && l[1]));

  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(-220))
    .force(
      'link',
      forceLink(links.map(([source, target]) => ({ source, target })))
        .distance(64)
        .strength(0.4),
    )
    .force('center', forceCenter(W / 2, H / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((n) => radiusFor(n) + 6),
    )
    .stop();
  for (let i = 0; i < 320; i++) sim.tick();

  // Auto-fit: bound the viewBox to the laid-out nodes (+ approximate label width to the right)
  // so nothing is clipped however far the force spreads them.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = radiusFor(n);
    const labelW = Math.min(n.label.length, 28) * (n.type === 'memory' ? 5.2 : 6.4) + 14;
    minX = Math.min(minX, (n.x ?? 0) - r);
    minY = Math.min(minY, (n.y ?? 0) - r - 8);
    maxX = Math.max(maxX, (n.x ?? 0) + r + labelW);
    maxY = Math.max(maxY, (n.y ?? 0) + r + 8);
  }
  const pad = 28;
  const viewBox = Number.isFinite(minX)
    ? `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
    : `0 0 ${W} ${H}`;
  return { nodes, links, viewBox };
}

export function MemoryBrain({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .memoryGraph()
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, [open]);

  const laidOut = useMemo(() => (graph ? layout(graph) : null), [graph]);

  if (!open) return null;

  const counts = graph
    ? {
        mem: graph.nodes.filter((n) => n.type === 'memory').length,
        ent: graph.nodes.filter((n) => n.type === 'entity').length,
        tag: graph.nodes.filter((n) => n.type === 'tag').length,
      }
    : { mem: 0, ent: 0, tag: 0 };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-6 backdrop-blur-sm">
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Brain className="size-4 text-primary" /> Memory brain
            <span className="ml-2 font-normal text-muted-foreground">
              {counts.mem} memories · {counts.ent} entities · {counts.tag} tags
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close memory brain">
            <X className="size-4" />
          </Button>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Building graph…
            </div>
          )}
          {!loading && graph && graph.nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-muted-foreground">
              No memory yet. Add facts that reference{' '}
              <code className="mx-1 rounded bg-secondary px-1">[[entities]]</code> and{' '}
              <code className="mx-1 rounded bg-secondary px-1">#tags</code> — they wire up here into
              a connected brain.
            </div>
          )}
          {!loading && laidOut && graph && graph.nodes.length > 0 && (
            <svg
              viewBox={laidOut.viewBox}
              preserveAspectRatio="xMidYMid meet"
              className="h-full w-full"
              data-testid="memory-brain-svg"
            >
              {laidOut.links.map(([a, b], i) => (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              ))}
              {laidOut.nodes.map((n) => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                  <circle r={radiusFor(n)} fill={colorFor(n)} fillOpacity={0.9} />
                  {(n.type !== 'memory' || n.degree > 0 || laidOut.nodes.length <= 30) && (
                    <text
                      x={radiusFor(n) + 3}
                      y={3}
                      className="fill-foreground"
                      fontSize={n.type === 'memory' ? 9 : 11}
                      fontWeight={n.type === 'memory' ? 400 : 600}
                    >
                      {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <Legend color="#2dd4bf" label="entity ([[…]])" />
          <Legend color="#e879f9" label="tag (#…)" />
          <Legend color="#60a5fa" label="fact" />
          <Legend color="#f59e0b" label="decision" />
          <Legend color="#34d399" label="preference" />
          <Legend color="#a78bfa" label="milestone" />
          <span className="ml-auto">node size = connections</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
