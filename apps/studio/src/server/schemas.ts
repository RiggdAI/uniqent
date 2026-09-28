import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  CredentialRequirement,
  IsoUtcDateTime,
  Manifest,
  McpServer,
  MemoryItem,
  MemoryKind,
  Slug,
} from '@uniqent/spec';
import { cronProblem } from './cron.js';

/**
 * Runtime schemas for every Studio API request body. Field rules reuse the spec schemas so the API
 * rejects exactly what would otherwise make the brain invalid. Unknown extra fields are ignored.
 */

const NonEmpty = z.string().trim().min(1, 'is required');
const AbsolutePath = NonEmpty.refine(isAbsolute, {
  message: 'must be an absolute path (e.g. /Users/me/project)',
});
const HttpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u), { message: 'must be an http(s) URL' });
const Importance = MemoryItem.shape.importance;
const Visibility = z.enum(['shareable', 'personal']);

/** Partial brain metadata: each field present must satisfy the manifest schema. */
export const MetaBody = Manifest.pick({
  name: true,
  displayName: true,
  version: true,
  description: true,
  author: true,
  license: true,
  tags: true,
}).partial();

export const TargetsBody = z.object({ targets: z.array(z.string()) });
export const PersonaBody = z.object({ persona: z.string() });
export const ReadmeBody = z.object({ readme: z.string() });
export const AvatarBody = z.object({ dataUrl: z.string() });
export const TextBody = z.object({ text: z.string() });
export const IdBody = z.object({ id: NonEmpty });
export const NameBody = z.object({ name: NonEmpty });
export const QueryBody = z.object({ query: z.string() });
export const UrlBody = z.object({ url: HttpUrl });
export const HubSkillAddBody = z.object({ url: HttpUrl, name: z.string().trim().pipe(Slug) });
export const ExportBody = z.object({ sign: z.boolean() });
export const HubIndexesBody = z.object({ urls: z.array(z.string()) });

export const MemoryBody = z.object({
  text: NonEmpty,
  importance: Importance,
  visibility: Visibility.optional(),
});

/** One imported memory item (e.g. a .jsonl line); blank text is skipped by the session. */
const ImportItem = z.object({
  text: z.string(),
  id: z.string().optional(),
  kind: MemoryKind.optional(),
  createdAt: IsoUtcDateTime.optional(),
  importance: Importance,
  visibility: Visibility.optional(),
});
export const MemoryImportBody = z
  .object({
    items: z.array(ImportItem).optional(),
    markdown: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((b) => b.items !== undefined || b.markdown !== undefined || b.text !== undefined, {
    message: 'one of items[], markdown or text is required',
  });

export const VaultPreviewBody = z.object({ dir: AbsolutePath });
export const VaultImportBody = z.object({
  dir: AbsolutePath,
  persona: z.boolean().optional(),
  profile: z.boolean().optional(),
});

export const MemoryHubSearchBody = z.object({ query: z.string(), registry: HttpUrl.optional() });
export const MemoryHubPublishBody = z.object({ token: NonEmpty, registry: HttpUrl.optional() });
export const MemoryHubAddBody = z.object({ slug: NonEmpty, registry: HttpUrl.optional() });

/** Profile fields: distinct field names (after trimming) mapped to text values. */
export const ProfileBody = z.object({
  profile: z.record(z.string(), z.string()).superRefine((profile, ctx) => {
    const seen = new Set<string>();
    for (const key of Object.keys(profile)) {
      const k = key.trim();
      if (seen.has(k)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate profile field "${k}"` });
      }
      seen.add(k);
    }
  }),
});

export const CustomSkillBody = z.object({
  name: z.string().trim().pipe(Slug),
  skillMd: z.string(),
});

/** A custom MCP server; the full McpServer schema is applied after Studio's defaults are merged. */
export const CustomMcpBody = z.object({ id: NonEmpty }).passthrough();
export const McpImportBody = z.object({ servers: z.array(z.record(z.string(), z.unknown())) });

export const TaskBody = z
  .object({
    name: z.string().optional(),
    triggerType: z.enum(['schedule', 'event', 'manual']),
    cron: z.string().optional(),
    event: z.string().optional(),
    actionKind: z.string().optional(),
    prompt: z.string().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.triggerType === 'schedule') {
      const cron = t.cron?.trim() ?? '';
      const problem = cron ? cronProblem(cron) : 'a cron expression is required';
      if (problem) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cron'],
          message: `invalid cron "${cron}": ${problem} — e.g. "0 9 * * *" (daily at 09:00)`,
        });
      }
    }
    if (t.triggerType === 'event' && !t.event?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event'], message: 'is required' });
    }
  });

export const InstallPlanBody = z.object({ target: NonEmpty, root: AbsolutePath });
export const InstallBody = InstallPlanBody.extend({
  creds: z.record(z.string(), z.string()),
});

export const HubMcpAddBody = z.object({
  result: z.object({
    source: z.string(),
    entry: z.object({
      id: NonEmpty,
      name: z.string(),
      description: z.string(),
      server: McpServer,
      credential: CredentialRequirement.optional(),
    }),
    credentials: z.array(CredentialRequirement),
    homepage: z.string().optional(),
    popularity: z.number().optional(),
  }),
});
