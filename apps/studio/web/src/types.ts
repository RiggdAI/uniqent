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
