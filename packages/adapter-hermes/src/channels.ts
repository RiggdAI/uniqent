import type { ChannelKind } from '@uniqent/spec';

/**
 * The single env var Hermes' gateway reads to enable a channel kind from $HERMES_HOME/.env
 * (hermes-agent gateway/config.py PLATFORM_TOKEN_ENV_NAMES and _apply_env_overrides).
 * Kinds missing here need multi-field platform setup (`hermes gateway setup`) and are reported
 * as lossiness instead of installed.
 */
export const CHANNEL_TOKEN_ENV: Partial<Record<ChannelKind, string>> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
};
