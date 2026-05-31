import type { Channel, CredentialRequirement } from '@uniqent/spec';

export interface ChannelCatalogEntry {
  id: string;
  name: string;
  description: string;
  channel: Channel;
  credential?: CredentialRequirement;
}

/** Curated messaging surfaces the agent can be reached on. */
export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Reach the agent through a Telegram bot.',
    channel: { id: 'telegram', kind: 'telegram', credentialRef: 'telegram_bot_token' },
    credential: {
      ref: 'telegram_bot_token',
      label: 'Telegram Bot Token',
      type: 'bearer',
      consumedBy: [],
      required: true,
      help: 'Create a bot with @BotFather and copy its token.',
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Talk to the agent from a Slack workspace.',
    channel: { id: 'slack', kind: 'slack', credentialRef: 'slack_bot_token' },
    credential: {
      ref: 'slack_bot_token',
      label: 'Slack Bot Token',
      type: 'bearer',
      consumedBy: [],
      required: true,
      help: 'Create a Slack app, add a bot user, and install it to your workspace.',
    },
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Run the agent as a Discord bot.',
    channel: { id: 'discord', kind: 'discord', credentialRef: 'discord_bot_token' },
    credential: {
      ref: 'discord_bot_token',
      label: 'Discord Bot Token',
      type: 'bearer',
      consumedBy: [],
      required: true,
      help: 'Create an application in the Discord developer portal and add a bot.',
    },
  },
];
