import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, type Node } from '@xyflow/react';
import { Download, Rocket, CheckCircle2, XCircle, Brain } from 'lucide-react';
import type { StudioState, CatalogView } from './types';
import { api } from './api';
import { buildGraph } from './canvas/graph';
import { nodeTypes } from './canvas/nodes';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';

// Lazy-loaded so the force-graph/d3 weight only ships when the brain is opened.
const MemoryBrain = lazy(() => import('./MemoryBrain').then((m) => ({ default: m.MemoryBrain })));

export function App() {
  const [state, setState] = useState<StudioState | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [error, setError] = useState('');
  const [brainOpen, setBrainOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.catalog(), api.state()])
      .then(([c, s]) => {
        setCatalog(c);
        setState(s);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  function apply(p: Promise<StudioState>): void {
    setBusy(true);
    setError('');
    p.then(setState)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  }

  async function doExport(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await api.export(true);
      const bytes = Uint8Array.from(atob(res.bytesBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`Exported ${res.filename} · signed ${res.signed} · verified ${res.verified}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const graph = useMemo(() => (state ? buildGraph(state) : { nodes: [], edges: [] }), [state]);

  if (error && !state)
    return <div className="grid h-screen place-items-center text-destructive">{error}</div>;
  if (!state || !catalog)
    return (
      <div className="grid h-screen place-items-center text-muted-foreground">
        Loading Uniqent Studio…
      </div>
    );

  const v = state.validation;
  const secrets = v.errors.filter((e) => e.code === 'secret').length;
  const credsRequired = state.manifest.credentials.filter((c) => c.required).length;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* Full-bleed canvas */}
      <div className="absolute inset-0">
        <ReactFlow
          key={graph.nodes.map((n) => n.id).join('|')}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_e, node: Node) => setSelection(node.id)}
          onPaneClick={() => setSelection(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.4 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            className="!bg-background"
          />
        </ReactFlow>
      </div>

      {graph.nodes.length <= 1 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-sm text-muted-foreground">
            Add components from the palette to build your brain
          </p>
        </div>
      )}

      {/* Floating header (bare, no box) */}
      <header className="absolute inset-x-4 top-3 z-20 flex h-12 items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
            U
          </span>
          Uniqent{' '}
          <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
            Studio
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {state.manifest.displayName}
          </span>
          <Button
            data-testid="brain-btn"
            variant="outline"
            size="sm"
            onClick={() => setBrainOpen(true)}
          >
            <Brain className="size-4" /> Brain
          </Button>
          <Button
            data-testid="install-btn"
            variant="outline"
            size="sm"
            onClick={() => setSelection('install')}
          >
            <Rocket className="size-4" /> Install
          </Button>
          <Button data-testid="export-btn" size="sm" disabled={busy} onClick={doExport}>
            <Download className="size-4" /> Export
          </Button>
        </div>
      </header>

      {/* Floating palette */}
      <div className="absolute bottom-14 left-3 top-[4.25rem] z-10 w-56 overflow-hidden rounded-xl border bg-card/80 shadow-lg backdrop-blur">
        <Palette
          state={state}
          catalog={catalog}
          apply={apply}
          selection={selection}
          onSelect={setSelection}
        />
      </div>

      {/* Floating inspector */}
      {selection && (
        <div className="absolute bottom-14 right-3 top-[4.25rem] z-10 w-80 overflow-hidden rounded-xl border bg-card/80 shadow-lg backdrop-blur">
          <Inspector
            selection={selection}
            state={state}
            catalog={catalog}
            apply={apply}
            onClose={() => setSelection(null)}
          />
        </div>
      )}

      {/* Floating status bar (bare, no box) */}
      <footer
        data-testid="status-bar"
        className="absolute inset-x-4 bottom-3 z-20 flex h-9 items-center gap-3 text-sm"
      >
        <span
          className={cn('flex items-center gap-1.5', v.ok ? 'text-success' : 'text-destructive')}
        >
          {v.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {v.ok ? 'valid' : `${v.errors.length} issue(s)`}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className={secrets === 0 ? 'text-muted-foreground' : 'text-destructive'}>
          {secrets} secrets
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{credsRequired} credential(s) required</span>
        {exportMsg && <span className="ml-auto truncate text-muted-foreground">{exportMsg}</span>}
        {error && <span className="ml-auto truncate text-destructive">{error}</span>}
      </footer>

      {brainOpen && (
        <Suspense fallback={null}>
          <MemoryBrain open onClose={() => setBrainOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
