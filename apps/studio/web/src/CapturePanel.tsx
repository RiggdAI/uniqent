import { useState } from 'react';
import type { TargetId } from '@uniqent/builder/brain';
import type { StudioState } from './types';
import { api } from './api';
import type { CaptureResult } from './capture';
import { PURE_ADAPTERS } from './install';
import { OUTSIDE_ALLOWED, TargetChoiceList, useTargetPicker } from './TargetPick';
import { errorText } from './lib/utils';
import { Button } from './components/ui/button';
import { DroppedLines } from './DroppedLines';

/**
 * Capture an agent from a framework on this machine (or a dropped folder, `dir`) and replace the
 * brain on the canvas with it. Episodic and personal memory are left out; the result lists what
 * was captured, the credentials to re-supply and everything left out or not loaded.
 */
export function CapturePanel({
  dir,
  apply,
}: {
  dir: string | null;
  apply: (p: Promise<StudioState>) => void;
}) {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  function restart(): void {
    setResult(null);
    setErr('');
    setFailed(false);
  }

  const picker = useTargetPicker(dir, restart, setErr);
  const { target } = picker.pick;
  const { root } = picker;

  async function capture(t: TargetId, r: string): Promise<void> {
    setBusy(true);
    restart();
    try {
      const res = await api.capture(t, r);
      apply(Promise.resolve(res.state));
      setResult(res);
    } catch (e) {
      setErr(errorText(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** "Choose folder…" next to Rust's outside-the-allowed-folders refusal, then capture again. */
  async function grantAndRetry(t: TargetId, r: string): Promise<void> {
    try {
      if (!(await api.chooseFolder())) return;
    } catch (e) {
      setErr(errorText(e));
      return;
    }
    await capture(t, r);
  }

  const c = result?.state.manifest.components;
  const credentials = result?.state.manifest.credentials ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Capture an agent from a framework on this machine. Episodic and personal memory are left
        out; credentials are captured as requirements, never values.
      </p>
      <TargetChoiceList name="capture" picker={picker} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="capture-choose"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={picker.chooseFolder}
        >
          Choose folder…
        </Button>
        <Button
          data-testid="capture-run"
          size="sm"
          disabled={busy || !target || !root}
          onClick={() => target && root && capture(target, root)}
        >
          Replace current brain with captured agent
        </Button>
      </div>

      {result && c && target && (
        <div
          data-testid="capture-result"
          className="space-y-1 rounded-md border border-success/30 bg-success/10 p-3 text-xs"
        >
          <div className="text-sm font-medium text-success">
            Captured from {PURE_ADAPTERS[target].displayName}.
          </div>
          <div data-testid="capture-counts">
            persona {c.identity ? 'yes' : 'no'} · {c.skills.length} skill(s) · {c.mcp.length} MCP
            server(s) · {c.memory.facts} memory item(s) · profile{' '}
            {c.memory.hasProfile ? 'yes' : 'no'} · {c.channels.length} channel(s) · {c.tasks.length}{' '}
            task(s)
          </div>
          {credentials.length > 0 && (
            <div data-testid="capture-credentials">
              credentials to re-supply on install: {credentials.map((cr) => cr.ref).join(', ')}
            </div>
          )}
          <div data-testid="capture-removed">
            left out: {result.removed.episodic} episodic, {result.removed.personal} personal memory
            items
          </div>
          <DroppedLines testid="capture-dropped" dropped={result.dropped} />
        </div>
      )}
      {err && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{err}</p>
          {failed && target && root && err.includes(OUTSIDE_ALLOWED) && (
            <Button
              data-testid="capture-grant"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => grantAndRetry(target, root)}
            >
              Choose folder…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
