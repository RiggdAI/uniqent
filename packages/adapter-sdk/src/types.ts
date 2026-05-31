import type { Bundle } from '@uniqent/core';

export interface DetectResult {
  present: boolean;
  version?: string;
  configRoot?: string;
}

/** Where to install. `root` is the framework project root (e.g. the dir containing `.claude/`). */
export interface InstallOptions {
  root: string;
}

export interface ExportOptions {
  root: string;
}

export interface PlanWrite {
  path: string;
  summary: string;
}

export type LossinessAction = 'truncated' | 'dropped' | 'transformed';

export interface Lossiness {
  component: string;
  issue: string;
  action: LossinessAction;
}

export interface InstallPlan {
  writes: PlanWrite[];
  mcpRegistrations: string[];
  channelRegistrations: string[];
  lossiness: Lossiness[];
  /** Credential refs that must be resolved before apply(). */
  requiresCredentials: string[];
}

export type ResolvedCredentials = Record<string, string>;

export interface InstallResult {
  written: string[];
  notes: string[];
}

/** One framework target. Install is a translation, not a copy. */
export interface Adapter {
  id: string;
  displayName: string;
  detect(opts: { root?: string }): Promise<DetectResult>;
  plan(bundle: Bundle, opts: InstallOptions): Promise<InstallPlan>;
  apply(
    bundle: Bundle,
    plan: InstallPlan,
    resolved: ResolvedCredentials,
    opts: InstallOptions,
  ): Promise<InstallResult>;
  export(opts: ExportOptions): Promise<Bundle>;
}
