export interface ValidationIssue {
  path?: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface CredentialRequirement {
  ref: string;
  label: string;
  type: string;
  required: boolean;
  consumedBy: string[];
  help?: string;
}

export interface PermissionScope {
  filesystem: { read: string[]; write: string[] };
  network: { endpoints: string[] };
  autonomy: string;
  spawnsProcesses: boolean;
  notes?: string;
}

export interface Manifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  license: string;
  tags: string[];
  components: {
    identity: boolean;
    memory: { facts: number; episodic: number; hasProfile: boolean };
    skills: string[];
    mcp: string[];
    tools: string[];
    tasks: string[];
    channels: string[];
  };
  credentials: CredentialRequirement[];
  permissions: PermissionScope;
  compatibility: { targets: string[] };
}

export interface StudioState {
  manifest: Manifest;
  validation: ValidationResult;
}

export interface CatalogView {
  mcp: Array<{
    id: string;
    name: string;
    description: string;
    transport: string;
    credential?: string;
  }>;
  skills: Array<{ name: string; description: string }>;
  channels: Array<{
    id: string;
    name: string;
    description: string;
    kind: string;
    credential?: string;
  }>;
  targets: string[];
}

export interface InstallPlan {
  writes: Array<{ path: string; summary: string }>;
  mcpRegistrations: string[];
  channelRegistrations: string[];
  lossiness: Array<{ component: string; issue: string; action: string }>;
  requiresCredentials: string[];
}

export interface InstallResult {
  written: string[];
  notes: string[];
}

export interface TaskInput {
  name?: string;
  triggerType?: 'schedule' | 'event' | 'manual';
  cron?: string;
  event?: string;
  actionKind?: string;
  prompt?: string;
}

export interface ExportResult {
  filename: string;
  bytesBase64: string;
  signed: boolean;
  verified: boolean;
}

export interface McpHubResult {
  source: string;
  entry: {
    id: string;
    name: string;
    description: string;
    server: { transport: string; url?: string; command?: string };
  };
  credentials: CredentialRequirement[];
  homepage?: string;
  popularity?: number;
}

export interface SkillHubResult {
  source: string;
  name: string;
  description: string;
  skillUrl?: string;
  repo?: string;
  stars?: number;
}

export interface HubSearch<T> {
  results: T[];
  errors: Array<{ source: string; message: string }>;
}

export interface MemoryGraphNode {
  id: string;
  label: string;
  type: 'memory' | 'entity' | 'tag';
  kind?: string;
  degree: number;
}
export interface MemoryGraphEdge {
  source: string;
  target: string;
}
export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}
export interface ImportedMemoryItem {
  text: string;
  kind: string;
  entities: string[];
  tags: string[];
}

export interface MemoryPackResult {
  source: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  factCount: number;
  url: string;
}
export interface MemoryHubSearch {
  results: MemoryPackResult[];
  errors: Array<{ source: string; message: string }>;
}
