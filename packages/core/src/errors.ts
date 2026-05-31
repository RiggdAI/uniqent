import type { SecretFinding } from './secret-scan.js';
import type { Issue } from './validate.js';

export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleFormatError';
  }
}

export class SecretScanError extends Error {
  readonly findings: SecretFinding[];
  constructor(findings: SecretFinding[]) {
    super(`secret scan failed: ${findings.length} likely secret(s) found`);
    this.name = 'SecretScanError';
    this.findings = findings;
  }
}

export class BundleValidationError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`bundle validation failed: ${issues.length} error(s)`);
    this.name = 'BundleValidationError';
    this.issues = issues;
  }
}
