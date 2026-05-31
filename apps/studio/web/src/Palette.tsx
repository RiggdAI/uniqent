import { Brain, Boxes, Sparkles, Database, Settings, Plus, Check, Workflow } from 'lucide-react';
import type { ComponentType } from 'react';
import type { StudioState, CatalogView } from './types';
import { api } from './api';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';

interface PaletteProps {
  state: StudioState;
  catalog: CatalogView;
  apply: (p: Promise<StudioState>) => void;
  selection: string | null;
  onSelect: (s: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function SelectRow({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function AddRow({
  label,
  added,
  onAdd,
  testid,
}: {
  label: string;
  added: boolean;
  onAdd: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-secondary/40">
      <span className="truncate text-muted-foreground">{label}</span>
      <Button
        data-testid={testid}
        size="sm"
        variant={added ? 'secondary' : 'outline'}
        disabled={added}
        onClick={onAdd}
        className="h-7 px-2"
      >
        {added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
      </Button>
    </div>
  );
}

export function Palette({ state, catalog, apply, selection, onSelect }: PaletteProps) {
  const mcpAdded = new Set(state.manifest.components.mcp);
  const skillAdded = new Set(state.manifest.components.skills);
  const channelAdded = new Set(state.manifest.components.channels);
  return (
    <nav className="flex w-60 shrink-0 flex-col gap-5 overflow-auto border-r bg-card/40 p-3">
      <Section title="Identity">
        <SelectRow
          icon={Brain}
          label="Persona"
          active={selection === 'persona'}
          onClick={() => onSelect('persona')}
        />
      </Section>

      <Section title="Stack (MCP)">
        {catalog.mcp.map((m) => (
          <AddRow
            key={m.id}
            label={m.name}
            added={mcpAdded.has(m.id)}
            onAdd={() => apply(api.addMcp(m.id))}
            testid={`add-mcp-${m.id}`}
          />
        ))}
      </Section>

      <Section title="Skills">
        {catalog.skills.map((s) => (
          <AddRow
            key={s.name}
            label={s.name}
            added={skillAdded.has(s.name)}
            onAdd={() => apply(api.addSkill(s.name))}
            testid={`add-skill-${s.name}`}
          />
        ))}
      </Section>

      <Section title="Memory">
        <SelectRow
          icon={Database}
          label="Add facts"
          active={selection === 'memory'}
          onClick={() => onSelect('memory')}
        />
      </Section>

      <Section title="Channels">
        {catalog.channels.map((c) => (
          <AddRow
            key={c.id}
            label={c.name}
            added={channelAdded.has(c.id)}
            onAdd={() => apply(api.addChannel(c.id))}
            testid={`add-channel-${c.id}`}
          />
        ))}
      </Section>

      <Section title="Flows">
        <SelectRow
          icon={Workflow}
          label="Add task"
          active={selection === 'new-task'}
          onClick={() => onSelect('new-task')}
        />
      </Section>

      <Section title="Settings">
        <SelectRow
          icon={Settings}
          label="Config"
          active={selection === 'agent'}
          onClick={() => onSelect('agent')}
        />
      </Section>

      <div className="mt-auto px-2 text-[11px] text-muted-foreground">
        <Boxes className="mb-1 size-4" />
        Add components from the palette, then wire credentials on the canvas.
        <Sparkles className="ml-1 inline size-3" />
      </div>
    </nav>
  );
}
