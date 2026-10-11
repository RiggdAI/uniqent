// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { markdownExtensions } from './markdown-extensions';

const roundTrip = (markdown: string): string =>
  new Editor({ extensions: markdownExtensions, content: markdown }).storage.markdown.getMarkdown();

describe('markdown editor extensions', () => {
  it('keeps filenames, domains and emails as plain text', () => {
    const md = 'Always update AGENTS.md and SOUL.md. Email ops@corp.com or see docs.python.org';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips explicit links', () => {
    const md = 'See [the docs](https://docs.example.com/guide).';
    expect(roundTrip(md)).toBe(md);
  });
});
