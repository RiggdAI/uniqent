#!/usr/bin/env node
import { Writable } from 'node:stream';
import { createInterface, type Interface } from 'node:readline/promises';
import { run, type CliIo } from './run.js';

// Echo is suppressed while a secret is typed; readline writes through this stream.
let muted = false;
const output = new Writable({
  write(chunk: Buffer, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
let rl: Interface | undefined;
const readline = (): Interface =>
  (rl ??= createInterface({ input: process.stdin, output, terminal: true }));

// Prompts exist only on an interactive terminal; otherwise commands fail with a
// "pass --yes / --cred" message instead of reading a closed/piped stdin.
const interactive: Pick<CliIo, 'prompt' | 'promptSecret'> = process.stdin.isTTY
  ? {
      prompt: (q) => readline().question(q),
      promptSecret: async (q) => {
        const r = readline();
        process.stdout.write(q);
        muted = true;
        try {
          return await r.question('');
        } finally {
          muted = false;
          process.stdout.write('\n');
        }
      },
    }
  : {};

run(process.argv.slice(2), {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
  ...interactive,
})
  .then((code) => {
    rl?.close();
    process.exit(code);
  })
  .catch((e: unknown) => {
    rl?.close();
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  });
