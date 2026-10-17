import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, type Node } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import {
  Download,
  Rocket,
  CheckCircle2,
  XCircle,
  Brain,
  FolderOpen,
  ScanSearch,
  X,
} from 'lucide-react';
import type { StudioState, CatalogView, OpenedBundle } from './types';
import { api } from './api';
import { openStep, routeDrop, type DropAction, type DroppedItem } from './capture';
import { DroppedLines } from './DroppedLines';
import { buildGraph } from './canvas/graph';
import { nodeTypes } from './canvas/nodes';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { Button } from './components/ui/button';
import { cn, errorText } from './lib/utils';

/** Where a bundle to open comes from: the native open dialog or a file Rust granted from a drop. */
type OpenSource = { kind: 'dialog' } | { kind: 'dropped'; path: string };

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
  // What the last Open (dialog or drop) loaded: its signature and every line it could not hold.
  const [opened, setOpened] = useState<OpenedBundle | null>(null);
  // The last window drop: what to do with it, and why Rust refused any dropped path.
  const [drop, setDrop] = useState<DropAction | null>(null);
  const [dropRefused, setDropRefused] = useState<string[]>([]);
  // A dropped folder handed to the vault or capture panel.
  const [droppedDir, setDroppedDir] = useState<string | null>(null);
  // An Open waiting for the user to confirm it may replace the current brain.
  const [confirmOpen, setConfirmOpen] = useState<OpenSource | null>(null);
  // The current state for the drop listener, which is registered once.
  const stateRef = useRef<StudioState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
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

  // Drops are granted by Rust from the OS event; the payload only lists what it granted.
  useEffect(() => {
    const unlisten = [
      listen<DroppedItem[]>('studio://dropped', (e) => {
        setDropRefused([]);
        const action = routeDrop(e.payload);
        if (action.kind === 'open-bundle') {
          setDrop(null);
          requestOpen({ kind: 'dropped', path: action.path });
        } else {
          setConfirmOpen(null);
          setDrop(action);
        }
      }),
      listen<string[]>('studio://drop-refused', (e) => setDropRefused(e.payload)),
    ];
    return () => unlisten.forEach((u) => void u.then((stop) => stop()));
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
      const path = await api.saveBundle();
      if (path) setExportMsg(`Saved ${path} (signed)`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** Swap in an opened bundle (dialog or drop); null = the dialog was cancelled. */
  async function openWith(p: Promise<OpenedBundle | null>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await p;
      if (!res) return;
      setState(res.state);
      setSelection(null);
      setOpened(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function startOpen(source: OpenSource): void {
    setConfirmOpen(null);
    void openWith(source.kind === 'dialog' ? api.openBundle() : api.openDroppedBundle(source.path));
  }

  /** Open now over an empty brain, else ask first: opening replaces the brain (see openStep). */
  function requestOpen(source: OpenSource): void {
    const current = stateRef.current;
    if (!current) {
      setError('Studio is still loading the brain; open the bundle again in a moment');
      return;
    }
    if (openStep(current) === 'open') startOpen(source);
    else setConfirmOpen(source);
  }

  /** Hand a dropped folder to the vault import or capture panel. */
  function openDroppedDir(dir: string, panel: 'vault' | 'capture'): void {
    setDroppedDir(dir);
    setSelection(panel);
    setDrop(null);
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
            data-testid="open-btn"
            aria-label="Open"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setDrop(null);
              requestOpen({ kind: 'dialog' });
            }}
          >
            <FolderOpen className="size-4" /> <span className="hidden sm:inline">Open…</span>
          </Button>
          <Button
            data-testid="capture-btn"
            aria-label="Capture an agent"
            variant="outline"
            size="sm"
            onClick={() => {
              setDroppedDir(null);
              setSelection('capture');
            }}
          >
            <ScanSearch className="size-4" /> <span className="hidden sm:inline">Capture</span>
          </Button>
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
            droppedDir={droppedDir}
            onReplaced={() => setOpened(null)}
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
        {error && (
          <span title={error} className="ml-auto truncate text-destructive">
            {error}
          </span>
        )}
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

      {opened && (
        <div
          data-testid="open-report"
          className="absolute right-3 top-17 z-30 max-h-72 w-[min(28rem,calc(100vw-1.5rem))] space-y-2 overflow-auto rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium">Opened {opened.state.manifest.displayName}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close open report"
              onClick={() => setOpened(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {opened.signature === 'unsigned' && (
            <p data-testid="open-unsigned" className="text-amber-400">
              This bundle is unsigned: Studio cannot tell who made it or whether it was changed.
            </p>
          )}
          <DroppedLines testid="open-dropped" dropped={opened.dropped} />
        </div>
      )}

      {(drop || dropRefused.length > 0 || confirmOpen) && (
        <div
          data-testid="drop-panel"
          className="absolute left-1/2 top-17 z-30 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 space-y-2 rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-sm"
        >
          <div className="flex items-start justify-between gap-2">
            {drop?.kind === 'choose-vault-or-capture' ? (
              <span className="min-w-0 truncate">
                Dropped folder <code>{drop.dir}</code>
              </span>
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close drop panel"
              onClick={() => {
                setDrop(null);
                setDropRefused([]);
                setConfirmOpen(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          {drop?.kind === 'choose-vault-or-capture' && (
            <div className="flex gap-2">
              <Button
                data-testid="drop-vault"
                variant="outline"
                size="sm"
                onClick={() => openDroppedDir(drop.dir, 'vault')}
              >
                Import as vault
              </Button>
              <Button
                data-testid="drop-capture"
                variant="outline"
                size="sm"
                onClick={() => openDroppedDir(drop.dir, 'capture')}
              >
                Capture agent
              </Button>
            </div>
          )}
          {confirmOpen && (
            <div className="space-y-2">
              <p data-testid="open-replace-warning">
                Opening{' '}
                {confirmOpen.kind === 'dropped' ? <code>{confirmOpen.path}</code> : 'a bundle'}{' '}
                replaces the current brain, {state.manifest.displayName}; Studio does not keep it.
                Export it first to keep it.
              </p>
              <div className="flex gap-2">
                <Button
                  data-testid="open-replace-confirm"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => startOpen(confirmOpen)}
                >
                  Open — replaces the current brain
                </Button>
                <Button
                  data-testid="open-replace-cancel"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmOpen(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {drop?.kind === 'unsupported' && (
            <p data-testid="drop-unsupported">drop a .uniqent file or a folder</p>
          )}
          {dropRefused.length > 0 && (
            <ul data-testid="drop-refused" className="space-y-1 text-destructive">
              {dropRefused.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
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
