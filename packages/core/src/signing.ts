import * as ed from '@noble/ed25519';
import { Bundle, PATHS } from './bundle.js';
import { canonicalDigest } from './digest.js';
import { scanForSecrets } from './secret-scan.js';
import { SecretScanError } from './errors.js';

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export interface Keypair {
  privateKey: string;
  publicKey: string;
}

export interface VerifyResult {
  signed: boolean;
  valid: boolean;
  reason?: string;
  publicKey?: string;
}

export async function generateKeypair(): Promise<Keypair> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { privateKey: toHex(priv), publicKey: toHex(pub) };
}

/** Runs the secret-scan gate, signs the canonical digest, returns a new signed Bundle. */
export async function sign(bundle: Bundle, privateKeyHex: string): Promise<Bundle> {
  const findings = scanForSecrets(bundle);
  if (findings.length) throw new SecretScanError(findings);

  const digest = canonicalDigest(bundle);
  const priv = fromHex(privateKeyHex);
  const pub = await ed.getPublicKeyAsync(priv);
  const sig = await ed.signAsync(enc.encode(digest), priv);

  const signature = {
    algorithm: 'ed25519' as const,
    publicKey: toHex(pub),
    digestAlgorithm: 'sha256' as const,
    digest,
    signature: toHex(sig),
    signedAt: new Date().toISOString(),
  };

  const out = Bundle.fromFiles(new Map(bundle.entries()));
  out.set(PATHS.signature, JSON.stringify(signature, null, 2));
  return out;
}

export async function verify(bundle: Bundle): Promise<VerifyResult> {
  const signature = bundle.signature();
  if (!signature) return { signed: false, valid: false };

  const recomputed = canonicalDigest(bundle);
  if (recomputed !== signature.digest) {
    return {
      signed: true,
      valid: false,
      reason: 'digest mismatch (content changed)',
      publicKey: signature.publicKey,
    };
  }
  const ok = await ed.verifyAsync(
    fromHex(signature.signature),
    enc.encode(signature.digest),
    fromHex(signature.publicKey),
  );
  return {
    signed: true,
    valid: ok,
    reason: ok ? undefined : 'invalid signature',
    publicKey: signature.publicKey,
  };
}
