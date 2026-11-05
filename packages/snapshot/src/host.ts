/**
 * Canonical site identity (plan §3 "Trust snapshot", arch §7.7).
 *
 *   site key = WHATWG URL host of an https: URL
 *            = IDNA (UTS-46) -> punycode, lowercased, non-default port preserved, :443 dropped.
 *
 * No suffix matching anywhere: `foo.swap.example` is not `swap.example`.
 * Trailing-dot hosts are distinct origins in browsers and are rejected as snapshot keys.
 *
 * The extension MUST derive the host from extension sender/tab metadata (never page data)
 * and pass the full URL through siteKeyFromUrl.
 */

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}

/** Site key for a top-level or frame URL. Non-HTTPS is not a site BOUND can hold trust for. */
export function siteKeyFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HostError(`unparseable URL`);
  }
  if (u.protocol !== "https:") throw new HostError(`site must be https, got ${u.protocol}`);
  if (u.host === "") throw new HostError("empty host");
  return u.host;
}

/**
 * Canonicalize a host[:port] string written by a curator. Returns the canonical key.
 * Rejects anything that is not just a host (paths, credentials, query, fragments).
 */
export function canonicalizeHost(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 253 + 6) {
    throw new HostError("host must be a non-empty string");
  }
  if (/[/?#@\\\s]/.test(input)) throw new HostError(`not a bare host: ${JSON.stringify(input)}`);
  let u: URL;
  try {
    u = new URL(`https://${input}/`);
  } catch {
    throw new HostError(`invalid host: ${JSON.stringify(input)}`);
  }
  if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) {
    throw new HostError(`not a bare host: ${JSON.stringify(input)}`);
  }
  if (u.hostname.endsWith(".")) throw new HostError(`trailing-dot host not allowed: ${input}`);
  return u.host;
}

/** True iff `key` is already in canonical form (used by the snapshot validator). */
export function isCanonicalHost(key: string): boolean {
  try {
    return canonicalizeHost(key) === key;
  } catch {
    return false;
  }
}
