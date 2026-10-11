/**
 * Capture an agent from the native app, in the CLI's `uniqent export` order: read the framework
 * setup (Rust `read_inputs`) → the adapter's pure capture → scrub episodic and personal memory →
 * the fail-closed secret scan and validation → load it as the session (Rust `load_bundle_files`).
 * Also the pure routing of a window drop.
 */
import { scanForSecrets, validateBundle } from '@uniqent/core/pure';
import { gatherInputs } from '@uniqent/adapter-sdk/pure';
import { scrubPrivateMemory, type ScrubReport, type TargetId } from '@uniqent/builder/brain';
import { toBase64 } from './bytes';
import { PURE_ADAPTERS, readViaRust, targetContext } from './install';
import { call } from './native';
import type { LoadedBundle, StudioState } from './types';

export interface CaptureResult {
  state: StudioState;
  /** The episodic and personal memory items left out of the session. */
  removed: ScrubReport;
  /** What the session could not hold (Rust `load_bundle_files`). */
  dropped: string[];
}

/** The captured bundle failed the export gate; nothing was loaded. */
export class CaptureRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureRefusedError';
  }
}

/** Read a framework setup via Rust, capture it with the shared pure adapter, scrub private memory, load it into the session. */
export async function captureAgent(target: TargetId, root: string): Promise<CaptureResult> {
  const pure = PURE_ADAPTERS[target];
  const ctx = await targetContext(root);
  const read = await gatherInputs((r, asked) => pure.captureInputs(r, ctx, asked), readViaRust);
  // Scrub first, as the CLI export does: the gate checks exactly what would be loaded.
  const { bundle, removed } = scrubPrivateMemory(pure.capture(read, ctx));
  const findings = scanForSecrets(bundle);
  if (findings.length > 0) {
    const where = findings.map((f) => `${f.kind} in ${f.path}`).join(', ');
    throw new CaptureRefusedError(
      `capture pulled in ${findings.length} likely secret(s) (${where}); refusing to load it. ` +
        'Remove the value from the source agent, then capture again.',
    );
  }
  const validation = validateBundle(bundle);
  if (!validation.ok)
    throw new CaptureRefusedError(
      `captured bundle is invalid: ${validation.errors.map((e) => e.message).join('; ')}`,
    );
  // Loading replaces the current brain: never with an empty one from a wrong folder.
  const c = bundle.manifest().components;
  const counts = [c.skills, c.mcp, c.tools, c.channels, c.tasks].map((list) => list.length);
  if (!c.identity && !c.memory.hasProfile && c.memory.facts === 0 && counts.every((n) => n === 0))
    throw new CaptureRefusedError(
      `found nothing to capture from ${pure.displayName} at ${root} (no persona, skills, MCP servers, memory, profile, tools, channels or tasks); check the framework and folder`,
    );
  const files = [...bundle.entries()].map(([path, bytes]) => ({
    path,
    bytesBase64: toBase64(bytes),
  }));
  const { state, dropped } = await call<LoadedBundle>('load_bundle_files', { files });
  return { state, removed, dropped };
}

/** One entry of the Rust `studio://dropped` payload. */
export interface DroppedItem {
  path: string;
  kind: 'dir' | 'file';
}

export type DropAction =
  | { kind: 'open-bundle'; path: string }
  | { kind: 'choose-vault-or-capture'; dir: string }
  | { kind: 'unsupported' };

/** Pure routing for a drop: a single `.uniqent` file opens, a single folder offers vault/capture, anything else is unsupported. */
export function routeDrop(items: DroppedItem[]): DropAction {
  if (items.length !== 1) return { kind: 'unsupported' };
  const [item] = items as [DroppedItem];
  if (item.kind === 'dir') return { kind: 'choose-vault-or-capture', dir: item.path };
  if (item.path.endsWith('.uniqent')) return { kind: 'open-bundle', path: item.path };
  return { kind: 'unsupported' };
}
