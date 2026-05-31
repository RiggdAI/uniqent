import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant, type Node } from '@xyflow/react';
import { Download, CheckCircle2, XCircle } from 'lucide-react';
import type { StudioState, CatalogView } from './types';
import { api } from './api';
import { buildGraph } from './canvas/graph';
import { nodeTypes } from './canvas/nodes';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';

export function App() {
  const [state, setState] = useState<StudioState | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [error, setError] = useState('');

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
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            U
          </span>
          Uniqent{' '}
          <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
            Studio
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{state.manifest.displayName}</span>
          <Button data-testid="export-btn" disabled={busy} onClick={doExport}>
            <Download className="size-4" /> Export .uniqent
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette
          state={state}
          catalog={catalog}
          apply={apply}
          selection={selection}
          onSelect={setSelection}
        />

        <div className="relative min-w-0 flex-1">
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
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.3}
            proOptions={{ hideAttribution: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              className="!bg-background"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
          {graph.nodes.length <= 1 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="text-sm text-muted-foreground">
                Add components from the palette to build your brain →
              </p>
            </div>
          )}
        </div>

        {selection && (
          <Inspector
            selection={selection}
            state={state}
            catalog={catalog}
            apply={apply}
            onClose={() => setSelection(null)}
          />
        )}
      </div>

      <footer
        data-testid="status-bar"
        className="flex h-10 shrink-0 items-center gap-3 border-t px-5 text-sm"
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
        {exportMsg && <span className="ml-auto text-muted-foreground">{exportMsg}</span>}
        {error && <span className="ml-auto text-destructive">{error}</span>}
      </footer>
    </div>
  );
}
