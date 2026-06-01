import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { X, Brain, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from './components/ui/button';
import { api } from './api';
import type { MemoryGraph, MemoryGraphNode } from './types';

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
  return Math.min(3 + n.degree * 1.4, 12);
}

type GraphNode = MemoryGraphNode & { x?: number; y?: number };
type GraphData = { nodes: GraphNode[]; links: Array<{ source: string; target: string }> };

export function MemoryBrain({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .memoryGraph()
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, [open]);

  // Track the graph container size for the canvas.
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open, graph]);

  const data: GraphData = useMemo(
    () => ({
      nodes: (graph?.nodes ?? []).map((n) => ({ ...n })),
      links: (graph?.edges ?? []).map((e) => ({ source: e.source, target: e.target })),
    }),
    [graph],
  );

  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = radiusFor(node);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = colorFor(node);
      ctx.globalAlpha = node.type === 'memory' ? 0.95 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      // Labels: always for well-connected hubs; otherwise only when zoomed in.
      const showLabel = node.degree >= 3 || globalScale > 2.2 || node === hover;
      if (showLabel) {
        const label = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label;
        const fontSize = Math.max(node.type === 'memory' ? 3.5 : 4.5, 11 / globalScale);
        ctx.font = `${node.type === 'memory' ? '' : '600 '}${fontSize}px ui-sans-serif, system-ui`;
        ctx.fillStyle = 'rgba(226,232,240,0.92)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, (node.x ?? 0) + r + 1.5, node.y ?? 0);
      }
    },
    [hover],
  );

  const zoomBy = (factor: number) => fgRef.current?.zoom((fgRef.current.zoom() ?? 1) * factor, 250);
  const fit = () => fgRef.current?.zoomToFit(400, 40);

  if (!open) return null;

  const counts = graph
    ? {
        mem: graph.nodes.filter((n) => n.type === 'memory').length,
        ent: graph.nodes.filter((n) => n.type === 'entity').length,
        tag: graph.nodes.filter((n) => n.type === 'tag').length,
      }
    : { mem: 0, ent: 0, tag: 0 };
  const empty = !loading && graph !== null && graph.nodes.length === 0;

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

        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden"
          data-testid="memory-brain"
        >
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Building graph…
            </div>
          )}
          {empty && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-muted-foreground">
              No memory yet. Add facts that reference{' '}
              <code className="mx-1 rounded bg-secondary px-1">[[entities]]</code> and{' '}
              <code className="mx-1 rounded bg-secondary px-1">#tags</code> — they wire up here into
              a connected brain.
            </div>
          )}
          {!loading && !empty && graph && (
            <>
              <ForceGraph2D<GraphNode>
                ref={fgRef}
                width={size.w}
                height={size.h}
                graphData={data}
                backgroundColor="transparent"
                nodeRelSize={1}
                nodeVal={(n) => radiusFor(n) * radiusFor(n) * 0.18}
                nodeColor={(n) => colorFor(n)}
                nodeLabel={(n) => n.label}
                linkColor={() => 'rgba(148,163,184,0.28)'}
                linkWidth={0.5}
                cooldownTicks={120}
                onEngineStop={fit}
                onNodeHover={(n) => setHover((n as GraphNode) ?? null)}
                onNodeClick={(n) =>
                  fgRef.current?.centerAt((n as GraphNode).x, (n as GraphNode).y, 400)
                }
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => 'replace'}
              />
              <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => zoomBy(1.4)}
                  aria-label="Zoom in"
                >
                  <ZoomIn className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => zoomBy(0.7)}
                  aria-label="Zoom out"
                >
                  <ZoomOut className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={fit}
                  aria-label="Fit to view"
                >
                  <Maximize className="size-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <Legend color="#2dd4bf" label="entity ([[…]])" />
          <Legend color="#e879f9" label="tag (#…)" />
          <Legend color="#60a5fa" label="fact" />
          <Legend color="#f59e0b" label="decision" />
          <Legend color="#34d399" label="preference" />
          <Legend color="#a78bfa" label="milestone" />
          <span className="ml-auto">scroll = zoom · drag = pan/move · hover = label</span>
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
