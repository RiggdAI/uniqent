import type { PureAdapter } from '@uniqent/adapter-sdk/pure';
import { capture, captureInputs } from './capture.js';
import { inputs, planInstall, translate } from './translate.js';

/** Browser-safe Claude Code translation + capture (shared by the CLI and Studio). */
export const claudeCodePure: PureAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  inputs,
  plan: planInstall,
  translate,
  captureInputs,
  capture,
};
export { McpConfigParseError, MissingCredentialError, toClaudeMcpEntry } from './mcp.js';
export { CredentialScopeError } from '@uniqent/adapter-sdk/pure';
export { ManagedSectionError, MANAGED_BEGIN, MANAGED_END } from './agents-md.js';
