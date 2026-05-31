import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Boxes, Brain, Cpu, Database, KeyRound, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '../lib/utils';

const handleClass = '!h-2 !w-2 !rounded-full !border !border-border !bg-muted-foreground/40';

export function AgentNode({ data, selected }: NodeProps) {
  const d = data as { displayName: string; valid: boolean };
  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-card px-5 py-4 shadow-lg transition-colors',
        selected ? 'border-primary' : 'border-primary/40',
      )}
    >
      <Handle type="source" position={Position.Right} className={handleClass} />
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
          <Cpu className="size-5" />
        </span>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Agent</div>
          <div className="font-semibold leading-tight">{d.displayName}</div>
        </div>
      </div>
      <div
        className={cn('mt-2 text-xs font-medium', d.valid ? 'text-success' : 'text-destructive')}
      >
        {d.valid ? '✓ valid' : '✕ incomplete'}
      </div>
    </div>
  );
}

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  persona: Brain,
  mcp: Boxes,
  skill: Sparkles,
  memory: Database,
};

export function ComponentNode({ data, selected }: NodeProps) {
  const d = data as { kind: string; label: string; sublabel: string };
  const Icon = ICONS[d.kind] ?? Boxes;
  return (
    <div
      className={cn(
        'w-48 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
      )}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Handle type="source" position={Position.Right} className={handleClass} />
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <div className="truncate font-medium">{d.label}</div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{d.sublabel}</div>
    </div>
  );
}

export function CredentialNode({ data, selected }: NodeProps) {
  const d = data as { ref: string; type: string; required: boolean };
  return (
    <div
      className={cn(
        'w-48 rounded-lg border border-dashed bg-card px-4 py-3 shadow-sm transition-colors',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-amber-400" />
        <div className="truncate font-medium">{d.ref}</div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {d.required ? 'required' : 'optional'} · {d.type}
      </div>
    </div>
  );
}

export const nodeTypes = {
  agent: AgentNode,
  component: ComponentNode,
  credential: CredentialNode,
};
