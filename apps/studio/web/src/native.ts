/**
 * Native (Tauri) implementations of the Studio API that need network or shared parsing logic.
 * The logic is the same pure TypeScript the CLI uses (@uniqent/builder/{hubs,memory}); network
 * goes through Tauri's plugin-http (https only, see capabilities/default.json) and every
 * session change or file read is a Rust command.
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  searchMcpHubs,
  searchSkillHubs,
  defaultMcpSources,
  defaultSkillSources,
  searchMemoryHub,
  fetchMemoryPack,
  publishMemoryPack,
  skillNameFor,
  fetchSkillMd,
  DEFAULT_MEMORY_REGISTRY,
  type FetchFn,
  type MemoryPackUpload,
} from '@uniqent/builder/hubs';
import { importVault, memoryGraph, type VaultFile } from '@uniqent/builder/memory';
import { PROJECT_MARKERS } from '@uniqent/builder/brain';
import type {
  StudioState,
  HubSearch,
  McpHubResult,
  SkillHubResult,
  MemoryHubSearch,
  MemoryGraph,
  VaultImport,
  FrameworkHomes,
} from './types';

const fetchFn: FetchFn = (input, init) => tauriFetch(input, init);

/**
 * invoke() rejects with the Rust command's plain error string; rethrow it as an Error (same
 * message) so every panel's `(e as Error).message` shows it.
 */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

const readVault = (dir: string) => call<VaultFile[]>('read_vault', { dir });

export async function hubMcp(query: string): Promise<HubSearch<McpHubResult>> {
  const jsonIndexUrls = await call<string[]>('hub_indexes');
  return searchMcpHubs(query, defaultMcpSources({ fetch: fetchFn, jsonIndexUrls }));
}

export async function hubSkills(query: string): Promise<HubSearch<SkillHubResult>> {
  const jsonIndexUrls = await call<string[]>('hub_indexes');
  return searchSkillHubs(
    query,
    defaultSkillSources({ fetch: fetchFn, jsonIndexUrls, githubToken: undefined }),
  );
}

export function addHubMcp(result: McpHubResult): Promise<StudioState> {
  return call<StudioState>('add_mcp_hub_result', {
    server: result.entry.server,
    credentials: result.credentials,
  });
}

export async function addHubSkill(url: string, name: string): Promise<StudioState> {
  const skillMd = await fetchSkillMd(fetchFn, url, undefined);
  return call<StudioState>('add_custom_skill', { name, skillMd });
}

export async function importSkillFromUrl(url: string): Promise<StudioState> {
  const skillMd = await fetchSkillMd(fetchFn, url, undefined);
  return call<StudioState>('add_custom_skill', { name: skillNameFor(url, skillMd), skillMd });
}

export async function hubIndexes(): Promise<{ indexes: string[] }> {
  return { indexes: await call<string[]>('hub_indexes') };
}

export async function setHubIndexes(urls: string[]): Promise<{ indexes: string[] }> {
  return { indexes: await call<string[]>('set_hub_indexes', { urls }) };
}

export async function previewVault(
  dir: string,
): Promise<{ result: VaultImport; graph: MemoryGraph }> {
  const result = importVault(await readVault(dir));
  const graph = memoryGraph(
    result.items.map((it, i) => ({ id: `v${i}`, text: it.text, kind: it.kind })),
  );
  return { result, graph };
}

export async function importVaultDir(
  dir: string,
  opts: { persona: boolean; profile: boolean },
): Promise<{ state: StudioState; stats: VaultImport['stats'] }> {
  const result = importVault(await readVault(dir));
  if (result.persona && opts.persona) await call('set_persona', { persona: result.persona });
  if (result.profile && opts.profile) await call('set_profile', { profile: result.profile });
  const state = await call<StudioState>('import_memory', {
    payload: {
      items: result.items.map((it) => ({ text: it.text, kind: it.kind, source: it.source })),
    },
  });
  return { state, stats: result.stats };
}

export function memoryHub(query: string, registry: string): Promise<MemoryHubSearch> {
  return searchMemoryHub(fetchFn, query, registry || DEFAULT_MEMORY_REGISTRY, undefined);
}

export async function addMemoryPack(slug: string, registry: string): Promise<StudioState> {
  const facts = await fetchMemoryPack(
    fetchFn,
    registry || DEFAULT_MEMORY_REGISTRY,
    slug,
    undefined,
  );
  return call<StudioState>('import_memory', {
    payload: { items: facts.map((f) => ({ text: f.text, kind: f.kind })) },
  });
}

export async function publishMemory(
  typedToken: string,
  registry: string,
): Promise<{ result: { slug: string; factCount: number; url?: string; persisted?: boolean } }> {
  const reg = registry || DEFAULT_MEMORY_REGISTRY;
  const token =
    typedToken.trim() || (await call<string | null>('registry_token', { registry: reg }));
  if (!token) {
    throw new Error(`not signed in to ${reg}: run \`uniqent login\` or paste a publish token`);
  }
  const pack = await call<MemoryPackUpload>('publish_payload');
  return { result: await publishMemoryPack(fetchFn, reg, token, pack, undefined) };
}

export function chooseFolder(): Promise<string | null> {
  return call<string | null>('pick_folder');
}

export function frameworkHomes(): Promise<FrameworkHomes> {
  return call<FrameworkHomes>('framework_homes');
}

/** Which project markers (PROJECT_MARKERS) a picked folder holds. */
export function folderMarkers(dir: string): Promise<string[]> {
  return call<string[]>('folder_markers', { dir, names: [...PROJECT_MARKERS] });
}
