import type { PureAdapter } from '@uniqent/adapter-sdk/pure';
import { capture, captureInputs } from './capture.js';
import { inputs, planInstall, translate } from './translate.js';

/** Browser-safe OpenClaw translation + capture (shared by the CLI and Studio). */
export const openClawPure: PureAdapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  inputs,
  plan: planInstall,
  translate,
  captureInputs,
  capture,
};
export { MissingCredentialError, EnvNameCollisionError } from './translate.js';
export { ManagedSectionError, MANAGED_BEGIN, MANAGED_END } from './workspace.js';
export { OpenClawConfigError } from './config.js';
export { EnvValueEncodingError, InvalidEnvNameError } from './env.js';
