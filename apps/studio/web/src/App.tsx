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
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(
    () => localStorage.getItem('uq.palette.collapsed') === '1',
  );
  function togglePalette(): void {
    setPaletteCollapsed((c) => {
      const next = !c;
      localStorage.setItem('uq.palette.collapsed', next ? '1' : '0');
      return next;
    });
  }

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
            className="bg-background!"
          />
        </ReactFlow>
      </div>

      {graph.nodes.length <= 1 && (
        <p
          data-testid="empty-hint"
          className="pointer-events-none absolute inset-x-4 bottom-16 text-center text-sm text-muted-foreground"
        >
          Add components from the palette to build your brain
        </p>
      )}

      {/* Floating header (bare, no box) */}
      <header className="absolute inset-x-4 top-3 z-20 flex h-12 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
            U
          </span>
          <span className="hidden sm:inline">Uniqent</span>
          <span className="bg-linear-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
            Studio
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {state.manifest.displayName}
          </span>
          <Button
            data-testid="brain-btn"
            aria-label="Memory brain"
            variant="outline"
            size="sm"
            onClick={() => setBrainOpen(true)}
          >
            <Brain className="size-4" /> <span className="hidden sm:inline">Brain</span>
          </Button>
          <Button
            data-testid="install-btn"
            aria-label="Install"
            variant="outline"
            size="sm"
            onClick={() => setSelection('install')}
          >
            <Rocket className="size-4" /> <span className="hidden sm:inline">Install</span>
          </Button>
          <Button
            data-testid="export-btn"
            aria-label="Export"
            size="sm"
            disabled={busy}
            onClick={doExport}
          >
            <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </header>

      {/* Floating palette */}
      <div
        className={cn(
          'absolute bottom-14 left-3 top-17 z-10 overflow-hidden rounded-xl border bg-card/80 shadow-lg backdrop-blur-sm transition-[width] duration-200',
          paletteCollapsed ? 'w-14' : 'w-56',
        )}
      >
        <Palette
          state={state}
          catalog={catalog}
          apply={apply}
          selection={selection}
          onSelect={setSelection}
          collapsed={paletteCollapsed}
          onToggleCollapse={togglePalette}
        />
      </div>

      {/* Floating inspector */}
      {selection && (
        <div className="absolute bottom-14 left-3 right-3 top-17 z-10 overflow-hidden rounded-xl border bg-card/80 shadow-lg backdrop-blur-sm sm:left-auto sm:w-80">
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
        className="absolute inset-x-4 bottom-3 z-20 flex h-9 items-center gap-3 overflow-hidden whitespace-nowrap text-sm"
      >
        <button
          type="button"
          data-testid="issues-toggle"
          disabled={v.ok}
          onClick={() => setIssuesOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1.5',
            v.ok ? 'text-success' : 'text-destructive underline-offset-4 hover:underline',
          )}
        >
          {v.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {v.ok ? 'valid' : `${v.errors.length} issue(s)`}
        </button>
        <span className="text-muted-foreground">·</span>
        <span className={secrets === 0 ? 'text-muted-foreground' : 'text-destructive'}>
          {secrets} secrets
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{credsRequired} credential(s) required</span>
        {exportMsg && <span className="ml-auto truncate text-muted-foreground">{exportMsg}</span>}
        {error && <span className="ml-auto truncate text-destructive">{error}</span>}
      </footer>

      {issuesOpen && !v.ok && (
        <div
          data-testid="issues-panel"
          className="absolute bottom-14 left-3 z-30 max-h-72 w-[min(32rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-sm"
        >
          <p className="mb-2 font-medium text-destructive">
            The bundle is invalid — fix these before export or install:
          </p>
          <ul className="space-y-2">
            {v.errors.map((e, i) => (
              <li key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                    {e.code}
                  </span>
                  {e.path && <span className="font-mono text-muted-foreground">{e.path}</span>}
                </div>
                <p className="wrap-break-word">{e.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brainOpen && (
        <Suspense fallback={null}>
          <MemoryBrain open onClose={() => setBrainOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
