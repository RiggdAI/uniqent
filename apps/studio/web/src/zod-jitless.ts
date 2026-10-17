import { config } from 'zod';

// The CSP forbids eval, so zod's `new Function` JIT probe would be reported as a violation even
// though zod catches it. Imported first in main.tsx so it runs before any schema parses.
config({ jitless: true });
