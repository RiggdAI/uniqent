import { z } from 'zod';

/** What fires a task. */
export const TaskTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('schedule'), cron: z.string().min(1) }),
  z.object({ type: z.literal('event'), event: z.string().min(1) }),
  z.object({ type: z.literal('manual') }),
]);
export type TaskTrigger = z.infer<typeof TaskTrigger>;

/** An automation: a trigger plus an action (e.g. a daily briefing). One per tasks/*.json. */
export const Task = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trigger: TaskTrigger,
  action: z.object({
    /** Action kind, e.g. "prompt" | "tool" | "skill". */
    kind: z.string().min(1),
    prompt: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  enabled: z.boolean(),
  description: z.string().optional(),
});
export type Task = z.infer<typeof Task>;
