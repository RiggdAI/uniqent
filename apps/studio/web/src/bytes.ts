/** Base64 over the IPC boundary (Rust's `bytesBase64` fields), without Node's `Buffer`. */

// String.fromCharCode(...chunk) takes one argument per byte; 32 KiB stays under engine limits.
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return btoa(parts.join(''));
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
