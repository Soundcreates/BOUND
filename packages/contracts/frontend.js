export const FRONTEND_K = 3;
export const FRONTEND_MATURITY_MS = 3_600_000;
export const FRONTEND_REPORT_WINDOW_MS = 172_800_000;
export const FRONTEND_DEDUPE_MS = 86_400_000;
export const FRONTEND_MAX_ROWS = 128;

const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const timestamp = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return false;
  const n = Date.parse(s);
  if (!Number.isFinite(n)) return false;
  const canonical = new Date(n).toISOString();
  return s === canonical || s === canonical.replace('.000Z', 'Z');
};

export function isFrontendPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 256 || /[^\x20-\x7e]|[?#\\]|%(?:2f|5c)/i.test(value)) return false;
  try {
    if (new URL(value, 'https://example.invalid').pathname !== value || value.startsWith('//')) return false;
    return value.split('/').every(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded.length <= 64 && !/[\x00-\x1f\x7f]/.test(decoded) && !/(?:0x)?[0-9a-f]{40}/i.test(decoded);
    });
  } catch { return false; }
}

export function isFrontendHash(value) {
  if (typeof value !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  try {
    const raw = atob(value.slice(7));
    return raw.length === 32 && btoa(raw) === value.slice(7);
  } catch { return false; }
}

export function validateFrontendRecord(v) {
  try {
    if (!exact(v, ['schemaVersion', 'kind', 'site', 'chainId', 'scripts', 'updatedAt']) || v.schemaVersion !== 1 || v.kind !== 'frontend' || typeof v.site !== 'string' || !v.site || v.site.length > 253 || !Number.isSafeInteger(v.chainId) || v.chainId <= 0 || !timestamp(v.updatedAt) || !Array.isArray(v.scripts) || v.scripts.length > FRONTEND_MAX_ROWS || new TextEncoder().encode(JSON.stringify(v)).length > 61_440) return false;
    const url = new URL('https://' + v.site);
    if (url.host !== v.site || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return false;
    const updated = Date.parse(v.updatedAt);
    return v.scripts.every((row, i) => {
      if (!exact(row, ['path', 'hash', 'reporters', 'firstSeen', 'lastSeen', 'established']) || !isFrontendPath(row.path) || !isFrontendHash(row.hash) || !Number.isSafeInteger(row.reporters) || row.reporters < 2 || !timestamp(row.firstSeen) || !timestamp(row.lastSeen) || typeof row.established !== 'boolean') return false;
      const first = Date.parse(row.firstSeen), last = Date.parse(row.lastSeen);
      const prev = v.scripts[i - 1];
      return first <= last && last <= updated && updated - last < FRONTEND_REPORT_WINDOW_MS && row.established === (row.reporters >= FRONTEND_K && updated - first >= FRONTEND_MATURITY_MS) && (!prev || prev.path < row.path || (prev.path === row.path && prev.hash < row.hash));
    });
  } catch { return false; }
}
