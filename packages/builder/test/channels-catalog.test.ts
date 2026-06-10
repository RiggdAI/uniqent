import { describe, it, expect } from 'vitest';
import { ChannelKind } from '@uniqent/spec';
import { CHANNEL_CATALOG } from '../src/catalog/channels.js';
import { Brain } from '../src/brain.js';

describe('channel catalog', () => {
  it('covers every channel kind the spec supports', () => {
    const kinds = new Set(CHANNEL_CATALOG.map((e) => e.channel.kind));
    for (const k of ChannelKind.options) {
      expect(kinds.has(k), `missing channel catalog entry for "${k}"`).toBe(true);
    }
  });

  it('every catalog channel with a credentialRef ships a matching credential', () => {
    for (const e of CHANNEL_CATALOG) {
      if (e.channel.credentialRef) {
        expect(e.credential?.ref, `${e.id} credential ref`).toBe(e.channel.credentialRef);
      }
    }
  });

  it('adding WhatsApp from the catalog wires the channel + its credential', () => {
    const brain = Brain.create({
      name: 'wa-test',
      displayName: 'WA Test',
      version: '0.1.0',
      description: 'x',
      author: { name: 'Uniqent' },
      license: 'CC0-1.0',
      tags: [],
    });
    brain.setPersona('You are a WhatsApp support agent.');
    brain.setTargets(['hermes']);
    brain.addChannelFromCatalog('whatsapp');
    const bundle = brain.toBundle();
    const manifest = JSON.parse(new TextDecoder().decode(bundle.get('uniqent.json')!));
    expect(manifest.components.channels).toContain('whatsapp');
    const cred = manifest.credentials.find((c: { ref: string }) => c.ref === 'whatsapp_token');
    expect(cred).toBeDefined();
    expect(cred.consumedBy).toContain('channel:whatsapp'); // auto-synced
  });
});
