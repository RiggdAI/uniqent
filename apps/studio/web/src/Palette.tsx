import {
  Brain,
  Boxes,
  Sparkles,
  Database,
  Settings,
  Plus,
  Check,
  Workflow,
  Globe,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
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
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// The icon-rail entries when collapsed: the panels you navigate to (catalog "add" rows
// stay in the expanded view). Each jumps straight to its inspector panel.
const RAIL: Array<{ icon: ComponentType<{ className?: string }>; key: string; label: string }> = [
  { icon: Brain, key: 'persona', label: 'Persona' },
  { icon: Boxes, key: 'new-mcp', label: 'Tools & data (MCP)' },
  { icon: Sparkles, key: 'new-skill', label: 'Skills' },
  { icon: Database, key: 'memory', label: 'Memory' },
  { icon: UserRound, key: 'profile', label: 'Profile' },
  { icon: Workflow, key: 'new-task', label: 'Flows' },
  { icon: Settings, key: 'agent', label: 'Config' },
];

function IconButton({
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
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
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

export function Palette({
  state,
  catalog,
  apply,
  selection,
  onSelect,
  collapsed,
  onToggleCollapse,
}: PaletteProps) {
  const skillAdded = new Set(state.manifest.components.skills);
  const channelAdded = new Set(state.manifest.components.channels);

  if (collapsed) {
    return (
      <nav className="uq-scroll flex h-full flex-col items-center gap-1 overflow-auto p-2">
        <button
          title="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={onToggleCollapse}
          className="mb-1 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        {RAIL.map((it) => (
          <IconButton
            key={it.key}
            icon={it.icon}
            label={it.label}
            active={selection === it.key}
            onClick={() => onSelect(it.key)}
          />
        ))}
      </nav>
    );
  }

  return (
    <nav className="uq-scroll flex h-full flex-col gap-5 overflow-auto p-3">
      <div className="-mb-2 flex justify-end">
        <button
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={onToggleCollapse}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <Section title="Identity">
        <SelectRow
          icon={Brain}
          label="Persona"
          active={selection === 'persona'}
          onClick={() => onSelect('persona')}
        />
      </Section>

      <Section title="Tools & data (MCP)">
        <SelectRow
          icon={Boxes}
          label="Add or import…"
          active={selection === 'new-mcp'}
          onClick={() => onSelect('new-mcp')}
        />
        <SelectRow
          icon={Globe}
          label="Browse hubs…"
          active={selection === 'hub-mcp'}
          onClick={() => onSelect('hub-mcp')}
        />
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
        <SelectRow
          icon={Sparkles}
          label="Custom / import…"
          active={selection === 'new-skill'}
          onClick={() => onSelect('new-skill')}
        />
        <SelectRow
          icon={Globe}
          label="Browse hubs…"
          active={selection === 'hub-skills'}
          onClick={() => onSelect('hub-skills')}
        />
      </Section>

      <Section title="Memory">
        <SelectRow
          icon={Database}
          label="Add facts"
          active={selection === 'memory'}
          onClick={() => onSelect('memory')}
        />
        <SelectRow
          icon={UserRound}
          label="Profile (USER.md)"
          active={selection === 'profile'}
          onClick={() => onSelect('profile')}
        />
        <SelectRow
          icon={Globe}
          label="Browse memory hub…"
          active={selection === 'memory-hub'}
          onClick={() => onSelect('memory-hub')}
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
