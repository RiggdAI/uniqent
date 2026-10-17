/**
 * Whether Publish can run. The native app falls back to the token `uniqent login` stored, so an
 * empty field is fine there; the browser version has no access to it and needs a typed token.
 */
export function canPublish(token: string, native: boolean): boolean {
  return native || token.trim().length > 0;
}
