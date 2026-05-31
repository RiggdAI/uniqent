#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { run } from './run.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });

run(process.argv.slice(2), {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
  prompt: (q) => rl.question(q),
})
  .then((code) => {
    rl.close();
    process.exit(code);
  })
  .catch((e: unknown) => {
    rl.close();
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  });
