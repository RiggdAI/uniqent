import { Bundle } from '../src/bundle';

const MANIFEST = {
  specVersion: '0.1',
  name: 'test-brain',
  displayName: 'Test Brain',
  version: '0.1.0',
  description: 'A fixture brain.',
  author: { name: 'Test' },
  license: 'CC0-1.0',
  tags: ['test'],
  components: {
    identity: true,
    memory: { facts: 1, episodic: 0, hasProfile: false },
    skills: ['code-review'],
    mcp: ['github'],
    tools: [],
    tasks: [],
    channels: [],
  },
  credentials: [
    {
      ref: 'github_pat',
      label: 'GitHub PAT',
      type: 'apiKey',
      consumedBy: ['mcp:github'],
      required: true,
    },
  ],
  permissions: {
    filesystem: { read: [], write: [] },
    network: { endpoints: ['api.github.com'] },
    autonomy: 'suggest',
    spawnsProcesses: false,
  },
  compatibility: { targets: ['claude-code'] },
};

const FACT = {
  id: 'f1',
  kind: 'fact',
  text: 'The user prefers TypeScript.',
  createdAt: '2026-05-31T00:00:00.000Z',
  importance: 0.8,
};

const SERVER = {
  id: 'github',
  transport: 'streamable-http',
  url: 'https://api.githubcopilot.com/mcp/',
  auth: { type: 'bearer', credentialRef: 'github_pat' },
  tools: { include: 'all' },
};

/** A minimal bundle that passes validateBundle(). */
export function makeValidBundle(): Bundle {
  const b = Bundle.empty();
  b.set('uniqent.json', JSON.stringify(MANIFEST, null, 2));
  b.set('identity/persona.md', '# Persona\nA helpful development agent.\n');
  b.set('memory/facts.jsonl', JSON.stringify(FACT) + '\n');
  b.set('skills/code-review/SKILL.md', '---\nname: code-review\n---\nReview code.\n');
  b.set('mcp/servers.json', JSON.stringify({ servers: [SERVER] }, null, 2));
  return b;
}
