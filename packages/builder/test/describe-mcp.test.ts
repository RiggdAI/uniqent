import { describe, it, expect } from 'vitest';
import { safe } from '../src/describe-mcp';

const RLO = String.fromCharCode(0x202e);
const LRI = String.fromCharCode(0x2066);
const ESC = String.fromCharCode(0x1b);

describe('safe', () => {
  it('blanks bidi overrides, control characters and newlines, and strips ANSI escapes', () => {
    expect(safe(`a${RLO}b${LRI}c\nd${ESC}[31me`)).toBe('a b c de');
  });
});
