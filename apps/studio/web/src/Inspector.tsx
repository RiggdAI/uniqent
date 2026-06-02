import { useEffect, useState } from 'react';
import { X, Trash2, KeyRound } from 'lucide-react';
import type {
  StudioState,
  CatalogView,
  InstallPlan,
  InstallResult,
  McpHubResult,
  SkillHubResult,
  MemoryPackResult,
  VaultImport,
} from './types';
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
  const [preview, setPreview] = useState<{
    items: Array<{ kind: string; text: string }>;
    skipped: number;
  } | null>(null);

  async function doPreview(): Promise<void> {
    const { items } = await api.previewMemory(bulk);
    const nonEmpty = bulk.split('\n').filter((l) => l.trim()).length;
    setPreview({ items, skipped: Math.max(nonEmpty - items.length, 0) });
  }

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
    } else if (file.name.endsWith('.md')) {
      apply(api.importMemory({ markdown: content })); // parse kinds + [[links]]/#tags
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
        <p className="text-xs text-muted-foreground">
          <b>Smart import</b> parses kinds (Decision/Preference/…) and wires up{' '}
          <code className="rounded bg-secondary px-1">[[entities]]</code> +{' '}
          <code className="rounded bg-secondary px-1">#tags</code> into the brain. Or one fact per
          line.
        </p>
        <Textarea
          data-testid="memory-bulk"
          className="min-h-[100px] text-[13px]"
          placeholder={
            '- Decision: standardized on [[Postgres]] #database\n- Prefers [[TypeScript]] + [[pnpm]] #conventions'
          }
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        />
        {preview && (
          <div className="space-y-1 rounded-lg border bg-secondary/30 p-2 text-xs">
            <div className="text-muted-foreground">
              {preview.items.length} parsed
              {preview.skipped > 0 && (
                <span className="text-amber-500">
                  {' '}
                  · {preview.skipped} line(s) skipped (headings)
                </span>
              )}
            </div>
            {preview.items.slice(0, 8).map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {it.kind}
                </Badge>
                <span className="truncate">{it.text}</span>
              </div>
            ))}
            {preview.items.length > 8 && (
              <div className="text-muted-foreground">+{preview.items.length - 8} more…</div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="memory-preview"
            variant="outline"
            size="sm"
            disabled={bulk.trim().length === 0}
            onClick={doPreview}
          >
            Preview
          </Button>
          <Button
            data-testid="memory-smart-import"
            size="sm"
            disabled={bulk.trim().length === 0}
            onClick={() => {
              apply(api.importMemory({ markdown: bulk }));
              setBulk('');
              setPreview(null);
            }}
          >
            Smart import
          </Button>
          <Button
            data-testid="memory-import-lines"
            variant="outline"
            size="sm"
            disabled={bulk.trim().length === 0}
            onClick={() => {
              apply(api.importMemory({ text: bulk }));
              setBulk('');
              setPreview(null);
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

      <VaultImportPanel apply={apply} />
    </div>
  );
}

/**
 * Import an existing Obsidian / "second-brain" vault (a local folder of markdown) straight into
 * the brain: SOUL.md → persona, USER.md → profile, MEMORY.md + notes → memory (journal/dated
 * notes become episodic). Preview first; the apply overwrites persona/profile only if you keep
 * the toggles on.
 */
function VaultImportPanel({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<VaultImport | null>(null);
  const [withPersona, setWithPersona] = useState(true);
  const [withProfile, setWithProfile] = useState(true);
  const [done, setDone] = useState<VaultImport['stats'] | null>(null);

  async function doPreview(): Promise<void> {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const { result } = await api.previewVault(dir.trim());
      setPreview(result);
    } catch (e) {
      setPreview(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.importVault(dir.trim(), {
        persona: withPersona,
        profile: withProfile,
      });
      apply(Promise.resolve(res.state));
      setDone(res.stats);
      setPreview(null);
      setDir('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <Label>Import a second-brain vault</Label>
      <p className="text-xs text-muted-foreground">
        Point at a local <b>Obsidian</b>/second-brain folder.{' '}
        <code className="rounded bg-secondary px-1">SOUL.md</code> → persona,{' '}
        <code className="rounded bg-secondary px-1">USER.md</code> → profile,{' '}
        <code className="rounded bg-secondary px-1">MEMORY.md</code> + notes → memory (journal/dated
        notes become episodic).
      </p>
      <div className="flex items-center gap-2">
        <Input
          data-testid="vault-dir"
          placeholder="/Users/you/Documents/MyVault"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
        />
        <Button
          data-testid="vault-preview"
          variant="outline"
          size="sm"
          disabled={busy || dir.trim().length === 0}
          onClick={doPreview}
        >
          Preview
        </Button>
      </div>
      {err && <div className="text-xs text-red-500">{err}</div>}
      {done && (
        <div className="rounded-lg border bg-secondary/30 p-2 text-xs text-muted-foreground">
          Imported {done.items} memory item(s) from {done.memoryFiles} note(s)
          {done.episodic > 0 && ` · ${done.episodic} episodic`}
          {done.personaFrom && ` · persona from ${done.personaFrom}`}
          {done.profileFrom && ` · profile from ${done.profileFrom}`}.
        </div>
      )}
      {preview && (
        <div className="space-y-2 rounded-lg border bg-secondary/30 p-2 text-xs">
          <div className="text-muted-foreground">
            {preview.stats.files} markdown file(s) · {preview.stats.items} memory item(s) from{' '}
            {preview.stats.memoryFiles} note(s)
            {preview.stats.episodic > 0 && (
              <span> · {preview.stats.episodic} episodic (scrubbed on export)</span>
            )}
          </div>
          {preview.persona && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withPersona}
                onChange={(e) => setWithPersona(e.target.checked)}
              />
              <span>
                Set persona from <b>{preview.stats.personaFrom}</b> (overwrites current)
              </span>
            </label>
          )}
          {preview.profile && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withProfile}
                onChange={(e) => setWithProfile(e.target.checked)}
              />
              <span>
                Set profile from <b>{preview.stats.profileFrom}</b> (
                {Object.keys(preview.profile).length} field(s))
              </span>
            </label>
          )}
          {preview.items.slice(0, 6).map((it, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {it.kind}
              </Badge>
              <span className="truncate">{it.text}</span>
            </div>
          ))}
          {preview.items.length > 6 && (
            <div className="text-muted-foreground">+{preview.items.length - 6} more…</div>
          )}
          <Button data-testid="vault-import" size="sm" disabled={busy} onClick={doImport}>
            Import into brain
          </Button>
        </div>
      )}
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

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function CustomSkillEditor({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [name, setName] = useState('');
  const [md, setMd] = useState('');
  const [url, setUrl] = useState('');
  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMd(await f.text());
    if (!name) {
      const base = f.name.replace(/\.md$/i, '');
      setName(base.toLowerCase() === 'skill' ? 'imported-skill' : base);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add a skill from a SKILL.md — paste or upload.
      </p>
      <div className="space-y-1.5">
        <Label>Name (slug)</Label>
        <Input
          data-testid="custom-skill-name"
          placeholder="e.g. release-notes"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>SKILL.md</Label>
        <Textarea
          data-testid="custom-skill-md"
          className="min-h-[160px] font-mono text-[13px]"
          placeholder={'---\nname: release-notes\ndescription: …\n---\n\n# Release notes\n…'}
          value={md}
          onChange={(e) => setMd(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          data-testid="custom-skill-add"
          disabled={name.trim().length === 0}
          onClick={() => {
            apply(api.addCustomSkill(name.trim(), md));
            setName('');
            setMd('');
          }}
        >
          Add skill
        </Button>
        <Button asChild variant="outline" size="sm">
          <label className="cursor-pointer">
            Upload SKILL.md
            <input type="file" accept=".md,text/markdown" className="hidden" onChange={onFile} />
          </label>
        </Button>
      </div>

      <div className="space-y-2 border-t pt-3">
        <Label>Install from URL</Label>
        <p className="text-xs text-muted-foreground">Fetch a SKILL.md from anywhere.</p>
        <Input
          data-testid="custom-skill-url"
          placeholder="https://example.com/skills/triage/SKILL.md"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          data-testid="custom-skill-url-add"
          variant="outline"
          size="sm"
          disabled={url.trim().length === 0}
          onClick={() => {
            apply(api.importSkillFromUrl(url.trim()));
            setUrl('');
          }}
        >
          Import from URL
        </Button>
      </div>
    </div>
  );
}

function CustomMcpEditor({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [id, setId] = useState('');
  const [transport, setTransport] = useState('streamable-http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [authType, setAuthType] = useState('none');
  const [credentialRef, setCredentialRef] = useState('');
  const [headerName, setHeaderName] = useState('');
  const stdio = transport === 'stdio';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text()) as { servers?: unknown[] } | unknown[];
      const servers = Array.isArray(json) ? json : (json.servers ?? []);
      apply(api.importMcpServers(servers));
    } catch {
      /* ignore bad file */
    }
  }

  function add(): void {
    const server: Record<string, unknown> = { id: id.trim(), transport, tools: { include: 'all' } };
    if (stdio) {
      server.command = command.trim();
      if (args.trim()) server.args = args.trim().split(/\s+/);
    } else {
      server.url = url.trim();
    }
    const auth: Record<string, unknown> = { type: authType };
    if (authType !== 'none' && credentialRef.trim()) auth.credentialRef = credentialRef.trim();
    if (authType === 'header' && headerName.trim()) auth.headerName = headerName.trim();
    server.auth = auth;
    apply(api.addCustomMcp(server));
    setId('');
    setUrl('');
    setCommand('');
    setArgs('');
    setCredentialRef('');
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Add an MCP server, or import a servers.json.</p>
      <div className="space-y-1.5">
        <Label>Server id</Label>
        <Input
          data-testid="custom-mcp-id"
          placeholder="e.g. linear"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Transport</Label>
        <select
          data-testid="custom-mcp-transport"
          className={selectClass}
          value={transport}
          onChange={(e) => setTransport(e.target.value)}
        >
          <option value="streamable-http">streamable-http</option>
          <option value="sse">sse</option>
          <option value="stdio">stdio</option>
        </select>
      </div>
      {stdio ? (
        <>
          <div className="space-y-1.5">
            <Label>Command</Label>
            <Input placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Args (space-separated)</Label>
            <Input
              placeholder="-y @scope/server"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label>URL</Label>
          <Input
            data-testid="custom-mcp-url"
            placeholder="https://api.example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Auth</Label>
        <select
          className={selectClass}
          value={authType}
          onChange={(e) => setAuthType(e.target.value)}
        >
          <option value="none">none</option>
          <option value="bearer">bearer</option>
          <option value="header">header</option>
          <option value="oauth2">oauth2</option>
        </select>
      </div>
      {authType !== 'none' && (
        <div className="space-y-1.5">
          <Label>Credential ref</Label>
          <Input
            placeholder="e.g. linear_api_key"
            value={credentialRef}
            onChange={(e) => setCredentialRef(e.target.value)}
          />
        </div>
      )}
      {authType === 'header' && (
        <div className="space-y-1.5">
          <Label>Header name</Label>
          <Input
            placeholder="X-Api-Key"
            value={headerName}
            onChange={(e) => setHeaderName(e.target.value)}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button data-testid="custom-mcp-add" disabled={id.trim().length === 0} onClick={add}>
          Add server
        </Button>
        <Button asChild variant="outline" size="sm">
          <label className="cursor-pointer">
            Import servers.json
            <input type="file" accept=".json" className="hidden" onChange={onFile} />
          </label>
        </Button>
      </div>
    </div>
  );
}

function InstallPanel({ catalog }: { catalog: CatalogView }) {
  const [target, setTarget] = useState(catalog.targets[0] ?? 'claude-code');
  const [root, setRoot] = useState('');
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [result, setResult] = useState<InstallResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function preview(): Promise<void> {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      setPlan(await api.installPlan(target, root.trim()));
    } catch (e) {
      setErr(String(e));
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }

  async function doInstall(): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      setResult(await api.install(target, root.trim(), creds));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = plan ? plan.requiresCredentials.filter((r) => !creds[r]?.trim()) : [];

  // A plan is for a specific target+root; changing either invalidates it so the
  // credential gate can't pass against a stale plan.
  function changeTarget(v: string): void {
    setTarget(v);
    setPlan(null);
    setResult(null);
  }
  function changeRoot(v: string): void {
    setRoot(v);
    setPlan(null);
    setResult(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Install this brain into a local framework.</p>
      <div className="space-y-1.5">
        <Label>Target</Label>
        <select
          className={selectClass}
          value={target}
          onChange={(e) => changeTarget(e.target.value)}
        >
          {catalog.targets.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Project root (absolute path)</Label>
        <Input
          data-testid="install-root"
          placeholder="/Users/you/my-project"
          value={root}
          onChange={(e) => changeRoot(e.target.value)}
        />
      </div>
      <Button
        data-testid="install-preview"
        variant="outline"
        disabled={busy || !root.trim()}
        onClick={preview}
      >
        Preview plan
      </Button>

      {plan && (
        <div className="space-y-3 border-t pt-3">
          <div className="text-xs text-muted-foreground">
            {plan.writes.length} file(s) will be written.
          </div>
          {plan.lossiness.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {plan.lossiness.map((l, i) => (
                <li key={i}>
                  <span className="text-amber-400">{l.action}</span>: {l.component}
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
                onChange={(e) => setCreds((c) => ({ ...c, [ref]: e.target.value }))}
              />
            </div>
          ))}
          <Button
            data-testid="install-apply"
            disabled={busy || missing.length > 0}
            onClick={doInstall}
          >
            Install into {target}
          </Button>
        </div>
      )}

      {result && (
        <div className="space-y-1 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          <div className="font-medium">Installed {result.written.length} file(s).</div>
          {result.notes.map((n, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              {n}
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

/** Manage "a hub is just a hosted index.json" URLs; shared by both hub panels (session state). */
function HubIndexManager() {
  const [indexes, setIndexes] = useState<string[]>([]);
  const [url, setUrl] = useState('');

  useEffect(() => {
    api
      .hubIndexes()
      .then((r) => setIndexes(r.indexes))
      .catch(() => {});
  }, []);

  function save(next: string[]): void {
    api
      .setHubIndexes(next)
      .then((r) => setIndexes(r.indexes))
      .catch(() => {});
  }

  return (
    <details className="rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none text-muted-foreground">
        Custom hubs{indexes.length > 0 ? ` (${indexes.length})` : ''}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          Point at any hosted <code>index.json</code> ({'{ mcp, skills }'}) — a team list, no
          service needed. Included in every hub search below.
        </p>
        {indexes.map((u) => (
          <div key={u} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs">{u}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              data-testid={`hub-index-remove-${u}`}
              onClick={() => save(indexes.filter((x) => x !== u))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            data-testid="hub-index-url"
            placeholder="https://example.com/hub/index.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) {
                save([...new Set([...indexes, url.trim()])]);
                setUrl('');
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            data-testid="hub-index-add"
            disabled={!url.trim()}
            onClick={() => {
              save([...new Set([...indexes, url.trim()])]);
              setUrl('');
            }}
          >
            Add hub
          </Button>
        </div>
      </div>
    </details>
  );
}

function HubMcpPanel({
  state,
  apply,
}: {
  state: StudioState;
  apply: (p: Promise<StudioState>) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<McpHubResult[]>([]);
  const [errors, setErrors] = useState<Array<{ source: string; message: string }>>([]);
  const [searched, setSearched] = useState(false);
  const added = new Set(state.manifest.components.mcp);

  async function run(): Promise<void> {
    setLoading(true);
    try {
      const r = await api.hubMcp(query);
      setResults(r.results);
      setErrors(r.errors);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Search the MCP Registry and Smithery. Adding a server brings its credential requirements.
      </p>
      <HubIndexManager />
      <div className="flex gap-2">
        <Input
          data-testid="hub-mcp-query"
          placeholder="e.g. github, postgres, slack"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Button data-testid="hub-mcp-search" onClick={() => run()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {errors.map((e) => (
        <p key={e.source} className="text-xs text-amber-500">
          {e.source} unavailable: {e.message}
        </p>
      ))}
      {searched && results.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No servers found.</p>
      )}
      <div className="space-y-2">
        {results.map((r) => {
          const isAdded = added.has(r.entry.id);
          return (
            <div key={`${r.source}:${r.entry.id}`} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.entry.name}</span>
                    <Badge variant="secondary">{r.source}</Badge>
                    {typeof r.popularity === 'number' && (
                      <span className="text-[11px] text-muted-foreground">{r.popularity} uses</span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {r.entry.description}
                  </p>
                  {r.credentials.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      needs {r.credentials.map((c) => c.ref).join(', ')}
                    </p>
                  )}
                </div>
                <Button
                  data-testid={`hub-mcp-add-${r.entry.id}`}
                  size="sm"
                  variant={isAdded ? 'secondary' : 'outline'}
                  disabled={isAdded}
                  onClick={() => apply(api.addHubMcp(r))}
                >
                  {isAdded ? 'Added' : 'Add'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HubSkillPanel({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SkillHubResult[]>([]);
  const [errors, setErrors] = useState<Array<{ source: string; message: string }>>([]);
  const [searched, setSearched] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function run(): Promise<void> {
    setLoading(true);
    try {
      const r = await api.hubSkills(query);
      setResults(r.results);
      setErrors(r.errors);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Search GitHub for skill repos (a SKILL.md). Adding imports the SKILL.md from the repo root.
      </p>
      <HubIndexManager />
      <div className="flex gap-2">
        <Input
          data-testid="hub-skill-query"
          placeholder="e.g. code review, security"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Button data-testid="hub-skill-search" onClick={() => run()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {errors.map((e) => (
        <p key={e.source} className="text-xs text-amber-500">
          {e.source} unavailable: {e.message}
        </p>
      ))}
      {searched && results.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No skills found.</p>
      )}
      <div className="space-y-2">
        {results.map((r) => {
          const key = r.skillUrl ?? r.name;
          const isAdded = added.has(key);
          return (
            <div key={key} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <Badge variant="secondary">{r.source}</Badge>
                    {typeof r.stars === 'number' && (
                      <span className="text-[11px] text-muted-foreground">★{r.stars}</span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {r.description}
                  </p>
                  {r.repo && <p className="mt-1 text-[11px] text-muted-foreground">{r.repo}</p>}
                </div>
                <Button
                  data-testid={`hub-skill-add-${r.name}`}
                  size="sm"
                  variant={isAdded ? 'secondary' : 'outline'}
                  disabled={isAdded || !r.skillUrl}
                  onClick={() => {
                    if (!r.skillUrl) return;
                    apply(api.addHubSkill(r.skillUrl));
                    setAdded((prev) => new Set(prev).add(key));
                  }}
                >
                  {isAdded ? 'Added' : 'Add'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PROFILE_SUGGESTIONS = [
  'Role',
  'About',
  'Working style',
  'Key context',
  'Stakeholders',
  'Tools & setup',
];

/** Structured "who the user/agent is" editor → memory/profile → USER.md. */
function ProfilePanel({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    api
      .getProfile()
      .then((r) => {
        const entries = Object.entries(r.profile ?? {});
        setRows(entries.map(([key, value]) => ({ key, value: String(value) })));
      })
      .catch(() => {});
  }, []);

  const usedKeys = new Set(rows.map((r) => r.key.trim().toLowerCase()));
  const setRow = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (key = '') => setRows((rs) => [...rs, { key, value: '' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  function save(): void {
    const profile: Record<string, string> = {};
    for (const { key, value } of rows) {
      const k = key.trim();
      if (k && value.trim()) profile[k] = value.trim();
    }
    apply(api.setProfile(profile));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Who the user/agent is — role, preferences, context. Travels as the profile and becomes{' '}
        <code className="rounded bg-secondary px-1">USER.md</code> on install. The core of handing a
        brain to the next person.
      </p>

      {rows.map((row, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border p-2">
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-44 font-medium"
              placeholder="Field name"
              value={row.key}
              onChange={(e) => setRow(i, { key: e.target.value })}
              data-testid={`profile-key-${i}`}
            />
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-1.5"
              onClick={() => removeRow(i)}
              aria-label="Remove field"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea
            className="min-h-[52px] text-[13px]"
            placeholder="…"
            value={row.value}
            onChange={(e) => setRow(i, { value: e.target.value })}
            data-testid={`profile-value-${i}`}
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5">
        {PROFILE_SUGGESTIONS.filter((s) => !usedKeys.has(s.toLowerCase())).map((s) => (
          <Button key={s} size="sm" variant="outline" className="h-7" onClick={() => addRow(s)}>
            + {s}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="h-7" onClick={() => addRow()}>
          + Custom field
        </Button>
      </div>

      <Button data-testid="profile-save" onClick={save}>
        Save profile
      </Button>
    </div>
  );
}

/** Browse the hosted memory hub (uniqent.ai) and add a pack's facts to the brain. */
function MemoryHubPanel({ apply }: { apply: (p: Promise<StudioState>) => void }) {
  const [registry, setRegistry] = useState('https://uniqent.ai');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MemoryPackResult[]>([]);
  const [errors, setErrors] = useState<Array<{ source: string; message: string }>>([]);
  const [searched, setSearched] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function run(): Promise<void> {
    setLoading(true);
    try {
      const r = await api.memoryHub(query, registry);
      setResults(r.results);
      setErrors(r.errors);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pull a shareable memory pack from the hub into this brain — decisions, conventions, context.
      </p>
      <details className="rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">Registry</summary>
        <Input
          className="mt-2 h-8"
          value={registry}
          onChange={(e) => setRegistry(e.target.value)}
          data-testid="memory-hub-registry"
        />
      </details>
      <div className="flex gap-2">
        <Input
          data-testid="memory-hub-query"
          placeholder="e.g. architecture, onboarding"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Button data-testid="memory-hub-search" onClick={() => run()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {errors.map((e) => (
        <p key={e.source} className="text-xs text-amber-500">
          {e.source} unavailable: {e.message}
        </p>
      ))}
      {searched && results.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No memory packs found.</p>
      )}
      <div className="space-y-2">
        {results.map((r) => {
          const isAdded = added.has(r.slug);
          return (
            <div key={r.slug} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {r.description}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {r.factCount} facts{r.tags.length ? ` · ${r.tags.join(', ')}` : ''}
                  </p>
                </div>
                <Button
                  data-testid={`memory-hub-add-${r.slug}`}
                  size="sm"
                  variant={isAdded ? 'secondary' : 'outline'}
                  disabled={isAdded}
                  onClick={() => {
                    apply(api.addMemoryPack(r.slug, registry));
                    setAdded((prev) => new Set(prev).add(r.slug));
                  }}
                >
                  {isAdded ? 'Added' : 'Add'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function titleFor(selection: string): string {
  if (selection === 'memory-hub') return 'Browse memory hub';
  if (selection === 'profile') return 'Profile (USER.md)';
  if (selection === 'hub-mcp') return 'Browse MCP hubs';
  if (selection === 'hub-skills') return 'Browse skill hubs';
  if (selection === 'install') return 'Install';
  if (selection === 'agent') return 'Config';
  if (selection === 'persona') return 'Persona';
  if (selection === 'memory') return 'Memory';
  if (selection === 'new-task') return 'New flow';
  if (selection === 'new-skill') return 'Custom skill';
  if (selection === 'new-mcp') return 'Custom MCP';
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
    <aside className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">{titleFor(selection)}</span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close inspector">
          <X className="size-4" />
        </Button>
      </div>
      <div className="uq-scroll flex-1 overflow-auto p-4">
        {selection === 'agent' && <ConfigEditor state={state} catalog={catalog} apply={apply} />}
        {selection === 'persona' && <PersonaEditor state={state} catalog={catalog} apply={apply} />}
        {selection === 'memory' && <MemoryEditor state={state} catalog={catalog} apply={apply} />}
        {selection === 'profile' && <ProfilePanel apply={apply} />}
        {selection === 'memory-hub' && <MemoryHubPanel apply={apply} />}
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
        {selection === 'new-skill' && <CustomSkillEditor apply={apply} />}
        {selection === 'new-mcp' && <CustomMcpEditor apply={apply} />}
        {selection === 'hub-mcp' && <HubMcpPanel state={state} apply={apply} />}
        {selection === 'hub-skills' && <HubSkillPanel apply={apply} />}
        {selection === 'install' && <InstallPanel catalog={catalog} />}
        {selection.startsWith('cred:') && (
          <CredentialDetails refId={selection.slice(5)} state={state} />
        )}
      </div>
    </aside>
  );
}
