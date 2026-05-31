import { useState } from 'react';
import { X, Trash2, KeyRound } from 'lucide-react';
import type { StudioState, CatalogView } from './types';
import { api } from './api';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Label } from './components/ui/label';
import { Badge } from './components/ui/badge';

interface InspectorProps {
  selection: string;
  state: StudioState;
  catalog: CatalogView;
  apply: (p: Promise<StudioState>) => void;
  onClose: () => void;
}

function Field({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function PersonaEditor({ state, apply }: Omit<InspectorProps, 'selection' | 'onClose'>) {
  const [persona, setPersona] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Personality, voice, role, and goals.</p>
      <Textarea
        data-testid="persona-input"
        className="min-h-[240px] font-mono text-[13px] leading-relaxed"
        placeholder={'# Persona\nYou are a helpful, precise engineering assistant…'}
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <Badge variant={state.manifest.components.identity ? 'success' : 'outline'}>
          {state.manifest.components.identity ? 'identity set' : 'no identity yet'}
        </Badge>
        <Button data-testid="persona-save" onClick={() => apply(api.setPersona(persona))}>
          Save persona
        </Button>
      </div>
    </div>
  );
}

function MemoryEditor({ state, apply }: Omit<InspectorProps, 'selection' | 'onClose'>) {
  const [text, setText] = useState('');
  const [importance, setImportance] = useState('0.5');
  const [bulk, setBulk] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const content = await file.text();
    if (file.name.endsWith('.jsonl')) {
      const items = content
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as unknown;
          } catch {
            return { text: l };
          }
        });
      apply(api.importMemory({ items }));
    } else {
      apply(api.importMemory({ text: content }));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Durable facts the agent should carry.</p>
      <div className="space-y-1.5">
        <Label>New fact</Label>
        <Input
          data-testid="memory-text"
          placeholder="e.g. The user prefers TypeScript and pnpm."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Label>Importance</Label>
          <Input
            className="w-24"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
          />
        </div>
        <Button
          data-testid="memory-add"
          disabled={text.length === 0}
          onClick={() => {
            apply(api.addMemory(text, Number(importance)));
            setText('');
          }}
        >
          Add fact
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        facts stored: {state.manifest.components.memory.facts}
      </p>

      <div className="space-y-2 border-t pt-3">
        <Label>Bulk import</Label>
        <p className="text-xs text-muted-foreground">One fact per line.</p>
        <Textarea
          data-testid="memory-bulk"
          className="min-h-[100px] text-[13px]"
          placeholder={'Ships small, focused PRs.\nReviews own code before requesting review.'}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            data-testid="memory-import-lines"
            variant="outline"
            size="sm"
            disabled={bulk.trim().length === 0}
            onClick={() => {
              apply(api.importMemory({ text: bulk }));
              setBulk('');
            }}
          >
            Import lines
          </Button>
          <Button asChild variant="outline" size="sm">
            <label className="cursor-pointer">
              Upload .txt/.md/.jsonl
              <input
                type="file"
                accept=".txt,.md,.jsonl,.json,text/plain"
                className="hidden"
                onChange={onFile}
              />
            </label>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfigEditor({ state, apply }: Omit<InspectorProps, 'selection' | 'onClose'>) {
  const m = state.manifest;
  const [name, setName] = useState(m.name);
  const [displayName, setDisplayName] = useState(m.displayName);
  const [version, setVersion] = useState(m.version);
  const [description, setDescription] = useState(m.description);
  const [tags, setTags] = useState(m.tags.join(', '));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Bundle metadata.</p>
      <Field label="Name (slug)" value={name} onChange={setName} testid="config-name" />
      <Field label="Display name" value={displayName} onChange={setDisplayName} />
      <Field label="Version" value={version} onChange={setVersion} />
      <Field label="Description" value={description} onChange={setDescription} />
      <Field label="Tags (comma-separated)" value={tags} onChange={setTags} />
      <Button
        data-testid="config-apply"
        onClick={() =>
          apply(
            api.setMeta({
              name,
              displayName,
              version,
              description,
              tags: tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            }),
          )
        }
      >
        Apply config
      </Button>
    </div>
  );
}

function McpDetails({
  id,
  catalog,
  apply,
  onClose,
}: {
  id: string;
  catalog: CatalogView;
  apply: (p: Promise<StudioState>) => void;
  onClose: () => void;
}) {
  const entry = catalog.mcp.find((m) => m.id === id);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{entry?.description ?? 'MCP server.'}</p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{entry?.transport ?? 'mcp'}</Badge>
        {entry?.credential && (
          <Badge>
            <KeyRound className="mr-1 size-3" /> {entry.credential}
          </Badge>
        )}
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          apply(api.removeMcp(id));
          onClose();
        }}
      >
        <Trash2 className="size-4" /> Remove server
      </Button>
    </div>
  );
}

function SkillDetails({
  name,
  catalog,
  apply,
  onClose,
}: {
  name: string;
  catalog: CatalogView;
  apply: (p: Promise<StudioState>) => void;
  onClose: () => void;
}) {
  const entry = catalog.skills.find((s) => s.name === name);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{entry?.description ?? 'Skill.'}</p>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          apply(api.removeSkill(name));
          onClose();
        }}
      >
        <Trash2 className="size-4" /> Remove skill
      </Button>
    </div>
  );
}

function CredentialDetails({ refId, state }: { refId: string; state: StudioState }) {
  const c = state.manifest.credentials.find((x) => x.ref === refId);
  if (!c) return <p className="text-sm text-muted-foreground">Unknown credential.</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{c.label}</div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{c.type}</Badge>
        <Badge variant={c.required ? 'default' : 'secondary'}>
          {c.required ? 'required' : 'optional'}
        </Badge>
      </div>
      <p className="text-muted-foreground">used by {c.consumedBy.join(', ') || 'nothing yet'}</p>
      <p className="text-xs text-muted-foreground">
        Resolved locally at install — never stored in the bundle.
      </p>
    </div>
  );
}

function ChannelDetails({
  id,
  catalog,
  apply,
  onClose,
}: {
  id: string;
  catalog: CatalogView;
  apply: (p: Promise<StudioState>) => void;
  onClose: () => void;
}) {
  const entry = catalog.channels.find((c) => c.id === id);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{entry?.description ?? 'Messaging channel.'}</p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{entry?.kind ?? 'channel'}</Badge>
        {entry?.credential && (
          <Badge>
            <KeyRound className="mr-1 size-3" /> {entry.credential}
          </Badge>
        )}
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          apply(api.removeChannel(id));
          onClose();
        }}
      >
        <Trash2 className="size-4" /> Remove channel
      </Button>
    </div>
  );
}

function TaskDetails({
  id,
  apply,
  onClose,
}: {
  id: string;
  apply: (p: Promise<StudioState>) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Automation / flow.</p>
      <Badge variant="secondary">{id}</Badge>
      <div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            apply(api.removeTask(id));
            onClose();
          }}
        >
          <Trash2 className="size-4" /> Remove flow
        </Button>
      </div>
    </div>
  );
}

function TaskEditor({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<'schedule' | 'event' | 'manual'>('schedule');
  const [cron, setCron] = useState('0 9 * * *');
  const [event, setEvent] = useState('mention');
  const [prompt, setPrompt] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">An automation the agent runs on a trigger.</p>
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input
          data-testid="task-name"
          placeholder="e.g. Daily PR triage"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Trigger</Label>
        <select
          data-testid="task-trigger"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as 'schedule' | 'event' | 'manual')}
        >
          <option value="schedule">Schedule (cron)</option>
          <option value="event">Event</option>
          <option value="manual">Manual</option>
        </select>
      </div>
      {triggerType === 'schedule' && (
        <div className="space-y-1.5">
          <Label>Cron</Label>
          <Input value={cron} onChange={(e) => setCron(e.target.value)} />
        </div>
      )}
      {triggerType === 'event' && (
        <div className="space-y-1.5">
          <Label>Event</Label>
          <Input value={event} onChange={(e) => setEvent(e.target.value)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Action prompt</Label>
        <Textarea
          className="min-h-[80px] text-[13px]"
          placeholder="What should the agent do when this fires?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <Button
        data-testid="task-add"
        onClick={() => {
          apply(api.addTask({ name, triggerType, cron, event, prompt }));
          setName('');
          setPrompt('');
        }}
      >
        Add flow
      </Button>
    </div>
  );
}

function titleFor(selection: string): string {
  if (selection === 'agent') return 'Config';
  if (selection === 'persona') return 'Persona';
  if (selection === 'memory') return 'Memory';
  if (selection === 'new-task') return 'New flow';
  if (selection.startsWith('mcp:')) return selection.slice(4);
  if (selection.startsWith('skill:')) return selection.slice(6);
  if (selection.startsWith('channel:')) return selection.slice(8);
  if (selection.startsWith('task:')) return selection.slice(5);
  if (selection.startsWith('cred:')) return 'Credential';
  return 'Inspector';
}

export function Inspector(props: InspectorProps) {
  const { selection, state, catalog, apply, onClose } = props;
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card/40">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">{titleFor(selection)}</span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close inspector">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {selection === 'agent' && <ConfigEditor state={state} catalog={catalog} apply={apply} />}
        {selection === 'persona' && <PersonaEditor state={state} catalog={catalog} apply={apply} />}
        {selection === 'memory' && <MemoryEditor state={state} catalog={catalog} apply={apply} />}
        {selection.startsWith('mcp:') && (
          <McpDetails id={selection.slice(4)} catalog={catalog} apply={apply} onClose={onClose} />
        )}
        {selection.startsWith('skill:') && (
          <SkillDetails
            name={selection.slice(6)}
            catalog={catalog}
            apply={apply}
            onClose={onClose}
          />
        )}
        {selection.startsWith('channel:') && (
          <ChannelDetails
            id={selection.slice(8)}
            catalog={catalog}
            apply={apply}
            onClose={onClose}
          />
        )}
        {selection.startsWith('task:') && (
          <TaskDetails id={selection.slice(5)} apply={apply} onClose={onClose} />
        )}
        {selection === 'new-task' && <TaskEditor apply={apply} />}
        {selection.startsWith('cred:') && (
          <CredentialDetails refId={selection.slice(5)} state={state} />
        )}
      </div>
    </aside>
  );
}
