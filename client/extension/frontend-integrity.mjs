// Local frontend evidence primitives. These functions do not fetch URLs or
// publish browsing data. A caller must establish the manifest's ENS provenance.
const encoder = new TextEncoder();
const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;

export async function hashScript(bytes, { subtle = globalThis.crypto.subtle, maxBytes = MAX_SCRIPT_BYTES } = {}) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.byteLength > maxBytes) throw new Error("Script is unavailable or too large");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

export function hashInlineScript(text, options) {
  if (typeof text !== "string") throw new Error("Invalid inline script");
  return hashScript(encoder.encode(text), options);
}

// Evidence is deliberately conservative: a re-fetch is not proof of the bytes
// executed by the page. Unknown coverage cannot produce a positive match.
export function compareScripts({ expected, observed, complete = false }) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || !Array.isArray(observed) || typeof complete !== "boolean") return { status: "unknown", mismatches: [] };
  const entries = Object.entries(expected);
  if (entries.some(([path, hash]) => !path.startsWith("/") || path.startsWith("//") || typeof hash !== "string" || !HASH.test(hash))) return { status: "unknown", mismatches: [] };
  const mismatches = new Set();
  let unknown = false;
  for (const item of observed) {
    if (!item || typeof item.path !== "string" || !item.path.startsWith("/") || item.path.startsWith("//") || typeof item.hash !== "string" || !HASH.test(item.hash)) { unknown = true; continue; }
    if (expected[item.path] !== item.hash) mismatches.add(item.path);
  }
  if (mismatches.size) return { status: "mismatch", mismatches: [...mismatches].sort() };
  if (!complete || unknown || observed.length === 0) return { status: "unknown", mismatches: [] };
  return { status: "matched", mismatches: [] };
}
