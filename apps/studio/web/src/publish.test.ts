import { describe, it, expect } from 'vitest';
import { canPublish } from './publish';

describe('canPublish', () => {
  it('lets the native app publish with an empty field (it uses the `uniqent login` token)', () => {
    expect(canPublish('', true)).toBe(true);
  });
  it('still needs a typed token in the browser version', () => {
    expect(canPublish('   ', false)).toBe(false);
    expect(canPublish('unq_live_x', false)).toBe(true);
  });
});
