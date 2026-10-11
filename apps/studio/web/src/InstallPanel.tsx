import { useState } from 'react';
import { displayPath, OWNER_ONLY } from '@uniqent/adapter-sdk/pure';
import { nextStep, type TargetId } from '@uniqent/builder/brain';
import type { InstallPlan, InstallResult } from './types';
import { api } from './api';
import { PURE_ADAPTERS, type ReviewedInstall } from './install';
import { OUTSIDE_ALLOWED, TargetChoiceList, useTargetPicker } from './TargetPick';
import { errorText } from './lib/utils';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

type InstallStep = 'plan' | 'review' | 'install';

export function InstallPanel() {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  // Credential values live only here, in the translate call and in the bytes handed to Rust.
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [review, setReview] = useState<ReviewedInstall | null>(null);
  const [result, setResult] = useState<(InstallResult & { next: string }) | null>(null);
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState<InstallStep | null>(null);
  const [busy, setBusy] = useState(false);

  /** A plan is for one target + root; changing either invalidates every later step. */
  function restart(): void {
    setPlan(null);
    setReview(null);
    setCreds({});
    setResult(null);
    setErr('');
    setFailed(null);
  }

  const picker = useTargetPicker(null, restart, setErr);
  const { target } = picker.pick;
  const { root } = picker;

  async function run(step: InstallStep, action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setErr('');
    setFailed(null);
    try {
      await action();
    } catch (e) {
      setErr(errorText(e));
      setFailed(step);
    } finally {
      setBusy(false);
    }
  }

  const preview = (t: TargetId, r: string) =>
    run('plan', async () => {
      setPlan(null);
      setReview(null);
      setResult(null);
      setPlan(await api.installPlan(t, r));
    });

  const reviewChanges = (t: TargetId, r: string) =>
    run('review', async () => setReview(await api.installPreview(t, r, creds)));

  const install = (t: TargetId, r: string, reviewed: ReviewedInstall) =>
    run('install', async () => {
      const res = await api.install(t, r, creds, reviewed);
      setResult({ ...res, next: nextStep(t, r) });
      setCreds({});
      setReview(null);
      setPlan(null);
    });

  /** "Choose folder…" next to Rust's outside-the-allowed-folders refusal, then the same step again. */
  async function grantAndRetry(): Promise<void> {
    try {
      if (!(await api.chooseFolder())) return;
    } catch (e) {
      setErr(errorText(e));
      return;
    }
    if (!target || !root) {
      setErr('choose a framework and its folder above, then run the step again');
      setFailed(null);
      return;
    }
    if (failed === 'plan') await preview(target, root);
    if (failed === 'review') await reviewChanges(target, root);
    if (failed === 'install') {
      if (!review) {
        setErr('the reviewed changes are gone; review the changes again');
        setFailed(null);
        return;
      }
      await install(target, root, review);
    }
  }

  const missing = plan ? plan.requiresCredentials.filter((r) => !creds[r]?.trim()) : [];
  const targetName = target ? PURE_ADAPTERS[target].displayName : '';

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Install this brain into a local framework.</p>
      <TargetChoiceList name="install" picker={picker} />
      <div className="flex items-center gap-2">
        <Button
          data-testid="install-choose"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={picker.chooseFolder}
        >
          Choose folder…
        </Button>
        <Button
          data-testid="install-preview"
          variant="outline"
          size="sm"
          disabled={busy || !target || !root}
          onClick={() => target && root && preview(target, root)}
        >
          Preview plan
        </Button>
      </div>

      {plan && target && root && (
        <div className="space-y-3 border-t pt-3 text-xs">
          <div className="text-muted-foreground">Dry run — nothing written yet.</div>
          <ul data-testid="install-plan-writes" className="space-y-1">
            {plan.writes.map((w, i) => (
              <li key={i}>
                write <code>{w.path}</code>{' '}
                <span className="text-muted-foreground">({w.summary})</span>
              </li>
            ))}
          </ul>
          {plan.mcpRegistrations.length > 0 && (
            <div>MCP servers registered: {plan.mcpRegistrations.join(', ')}</div>
          )}
          {plan.channelRegistrations.length > 0 && (
            <div>Channels registered: {plan.channelRegistrations.join(', ')}</div>
          )}
          {plan.lossiness.length > 0 && (
            <ul data-testid="install-lossiness" className="space-y-1 text-muted-foreground">
              {plan.lossiness.map((l, i) => (
                <li key={i}>
                  <span className="text-amber-400">{l.action}</span>: {l.component} — {l.issue}
                </li>
              ))}
            </ul>
          )}
          {plan.requiresCredentials.map((ref) => (
            <div className="space-y-1.5" key={ref}>
              <Label>credential: {ref}</Label>
              <Input
                data-testid={`install-cred-${ref}`}
                type="password"
                placeholder="resolved locally, never stored in the bundle"
                value={creds[ref] ?? ''}
                onChange={(e) => {
                  setCreds((c) => ({ ...c, [ref]: e.target.value }));
                  setReview(null);
                }}
              />
            </div>
          ))}
          <Button
            data-testid="install-review"
            variant="outline"
            size="sm"
            disabled={busy || missing.length > 0}
            onClick={() => reviewChanges(target, root)}
          >
            Review changes
          </Button>
        </div>
      )}

      {review && target && root && (
        <div className="space-y-2 border-t pt-3 text-xs">
          <div className="font-medium">These files will be written (paths relative to {root}):</div>
          <ul data-testid="install-review-writes" className="space-y-1">
            {review.writes.map((w, i) => (
              <li key={i}>
                <code>{displayPath(root, w)}</code>
                {w.mode === OWNER_ONLY && (
                  <span className="text-muted-foreground"> (owner-only, holds credentials)</span>
                )}
              </li>
            ))}
          </ul>
          {review.notes.length > 0 && (
            <ul data-testid="install-review-notes" className="space-y-1 text-muted-foreground">
              {review.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <Button
            data-testid="install-confirm"
            disabled={busy}
            onClick={() => install(target, root, review)}
          >
            Install into {targetName}
          </Button>
        </div>
      )}

      {result && (
        <div className="space-y-1 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          <div className="font-medium">Installed {result.written.length} file(s).</div>
          <ul className="text-xs text-muted-foreground">
            {result.written.map((w, i) => (
              <li key={i}>
                <code>{w}</code>
              </li>
            ))}
          </ul>
          {result.notes.map((n, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              note: {n}
            </div>
          ))}
          <div data-testid="install-next" className="text-xs">
            {result.next}
          </div>
        </div>
      )}
      {err && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{err}</p>
          {failed && err.includes(OUTSIDE_ALLOWED) && (
            <Button
              data-testid="install-grant"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={grantAndRetry}
            >
              Choose folder…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
