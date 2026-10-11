import { describe, expect, it } from 'vitest';
import { folderChoices, installChoices } from './targets';
import type { FrameworkHomes } from './types';

const homes = (hermes: boolean, openclaw: boolean): FrameworkHomes => ({
  home: '/home/u',
  targets: [
    { id: 'hermes', root: '/home/u/.hermes', present: hermes, error: null },
    { id: 'openclaw', root: '/home/u/.openclaw', present: openclaw, error: null },
  ],
  claudeCodeUser: false,
});

describe('installChoices', () => {
  it('preselects the only framework found', () => {
    const { choices, preselected } = installChoices(homes(true, false));
    expect(preselected).toBe('hermes');
    expect(choices.map((c) => [c.id, c.root, c.present])).toEqual([
      ['claude-code', null, false],
      ['hermes', '/home/u/.hermes', true],
      ['openclaw', '/home/u/.openclaw', false],
    ]);
  });

  it('keeps two found frameworks a choice', () => {
    expect(installChoices(homes(true, true)).preselected).toBeNull();
  });

  it('gives Claude Code no root until a folder is picked, even when ~/.claude exists', () => {
    const { choices, preselected } = installChoices({
      ...homes(false, false),
      claudeCodeUser: true,
    });
    expect(preselected).toBe('claude-code');
    expect(choices.find((c) => c.id === 'claude-code')?.root).toBeNull();
  });

  it('keeps an unusable home in the list with its reason', () => {
    const error = 'the hermes folder / contains your home folder, so Studio will not use it';
    const { choices } = installChoices({
      ...homes(false, false),
      targets: [{ id: 'hermes', root: '/', present: false, error }],
    });
    expect(choices.find((c) => c.id === 'hermes')).toEqual({
      id: 'hermes',
      root: '/',
      present: false,
      error,
    });
  });
});

describe('folderChoices', () => {
  it('offers every framework a picked folder holds, rooted at the folder', () => {
    expect(folderChoices('/p', ['.claude', 'openclaw.json'])).toEqual([
      { id: 'claude-code', root: '/p', present: true, error: null },
      { id: 'openclaw', root: '/p', present: true, error: null },
    ]);
  });
});
