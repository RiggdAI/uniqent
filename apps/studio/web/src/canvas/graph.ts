import { Position, type Node, type Edge } from '@xyflow/react';
import type { StudioState } from '../types';

const COL_AGENT = 0;
const COL_COMPONENT = 360;
const COL_CREDENTIAL = 760;
const ROW = 130;

const flow = { sourcePosition: Position.Right, targetPosition: Position.Left } as const;

/** Derive the react-flow graph (agent core → components → credentials they need) from state. */
export function buildGraph(state: StudioState): { nodes: Node[]; edges: Edge[] } {
  const m = state.manifest;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Components column, in a stable order.
  const components: Array<{ id: string; kind: string; label: string; sublabel: string }> = [];
  if (m.components.identity)
    components.push({ id: 'persona', kind: 'persona', label: 'Persona', sublabel: 'identity' });
  for (const id of m.components.mcp)
    components.push({ id: `mcp:${id}`, kind: 'mcp', label: id, sublabel: 'MCP server' });
  for (const name of m.components.skills)
    components.push({ id: `skill:${name}`, kind: 'skill', label: name, sublabel: 'skill' });
  if (m.components.memory.facts > 0 || m.components.memory.hasProfile)
    components.push({
      id: 'memory',
      kind: 'memory',
      label: 'Memory',
      sublabel: `${m.components.memory.facts} fact(s)`,
    });

  const span = Math.max(components.length - 1, 0) * ROW;
  const agentY = span / 2;

  nodes.push({
    id: 'agent',
    type: 'agent',
    position: { x: COL_AGENT, y: agentY },
    data: { name: m.name, displayName: m.displayName, valid: state.validation.ok },
    ...flow,
  });

  components.forEach((c, i) => {
    nodes.push({
      id: c.id,
      type: 'component',
      position: { x: COL_COMPONENT, y: i * ROW },
      data: { kind: c.kind, label: c.label, sublabel: c.sublabel },
      ...flow,
    });
    edges.push({ id: `e-agent-${c.id}`, source: 'agent', target: c.id });
  });

  m.credentials.forEach((c, i) => {
    const nid = `cred:${c.ref}`;
    nodes.push({
      id: nid,
      type: 'credential',
      position: { x: COL_CREDENTIAL, y: i * ROW },
      data: { ref: c.ref, label: c.label, type: c.type, required: c.required },
      ...flow,
    });
    for (const consumer of c.consumedBy) {
      // consumer ids ('mcp:github', 'channel:telegram') match component node ids
      edges.push({
        id: `e-${consumer}-${nid}`,
        source: consumer,
        target: nid,
        label: 'needs',
        animated: true,
        style: { stroke: 'hsl(var(--primary))' },
      });
    }
  });

  return { nodes, edges };
}

/** Map a clicked node id to an inspector selection key. */
export function selectionForNode(nodeId: string): string {
  return nodeId;
}
