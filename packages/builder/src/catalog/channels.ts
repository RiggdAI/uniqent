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
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Reach the agent on WhatsApp via the WhatsApp Business Cloud API.',
    channel: {
      id: 'whatsapp',
      kind: 'whatsapp',
      credentialRef: 'whatsapp_token',
      // Non-secret: the recipient sets their WhatsApp Business phone number id at install.
      config: { phone_number_id: '' },
    },
    credential: {
      ref: 'whatsapp_token',
      label: 'WhatsApp Business Token',
      type: 'bearer',
      consumedBy: [],
      required: true,
      help: 'From Meta → WhatsApp (Business Cloud API): a permanent access token. Also set the channel config phone_number_id.',
    },
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Two-way SMS, e.g. via Twilio.',
    channel: {
      id: 'sms',
      kind: 'sms',
      credentialRef: 'twilio_auth_token',
      // Non-secret: the recipient sets their account sid and sending number at install.
      config: { account_sid: '', from_number: '' },
    },
    credential: {
      ref: 'twilio_auth_token',
      label: 'Twilio Auth Token',
      type: 'apiKey',
      consumedBy: [],
      required: true,
      help: 'From the Twilio console. Also set the channel config account_sid and from_number.',
    },
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Reach the agent over email via an email provider API.',
    channel: { id: 'email', kind: 'email', credentialRef: 'email_api_key' },
    credential: {
      ref: 'email_api_key',
      label: 'Email API Key',
      type: 'apiKey',
      consumedBy: [],
      required: true,
      help: 'An API key from your email provider (e.g. Postmark, Resend, or SendGrid).',
    },
  },
  {
    id: 'webhook',
    name: 'Webhook',
    description: 'Receive events through an inbound HTTP webhook.',
    channel: { id: 'webhook', kind: 'webhook', credentialRef: 'webhook_secret' },
    credential: {
      ref: 'webhook_secret',
      label: 'Webhook Signing Secret',
      type: 'apiKey',
      consumedBy: [],
      required: false,
      help: 'Optional shared secret used to verify inbound webhook signatures.',
    },
  },
];
