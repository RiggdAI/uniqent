import { z } from 'zod';

export const ChannelKind = z.enum([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'sms',
  'email',
  'webhook',
]);
export type ChannelKind = z.infer<typeof ChannelKind>;

/** A messaging surface the agent is reachable on. */
export const Channel = z.object({
  id: z.string().min(1),
  kind: ChannelKind,
  /** Resolved locally at install; never a secret value. */
  credentialRef: z.string().optional(),
  /** Non-secret channel configuration (e.g. allowed chat ids). */
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});
export type Channel = z.infer<typeof Channel>;

/** Contents of channels/channels.json. */
export const ChannelsFile = z.object({
  channels: z.array(Channel),
});
export type ChannelsFile = z.infer<typeof ChannelsFile>;
