import type { PureAdapter } from '@uniqent/adapter-sdk/pure';
import { capture, captureInputs } from './capture.js';
import { inputs, planInstall, translate } from './translate.js';

/** Browser-safe Hermes translation + capture (shared by the CLI and Studio). */
export const hermesPure: PureAdapter = {
  id: 'hermes',
  displayName: 'Hermes',
  inputs,
  plan: planInstall,
  translate,
  captureInputs,
  capture,
};
export {
  MissingCredentialError,
  UndeclaredCredentialError,
  EnvKeyConflictError,
  skillTarget,
} from './translate.js';
export { DuplicateSkillError } from './capture.js';
export { HermesConfigError } from './config.js';
export { MEMORY_MAX, USER_MAX, ENTRY_DELIMITER } from './memory.js';
