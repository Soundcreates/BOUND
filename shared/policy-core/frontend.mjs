import { FRONTEND_K, FRONTEND_MATURITY_MS, FRONTEND_REPORT_WINDOW_MS, isFrontendPath, isFrontendHash, validateFrontendRecord } from '../contracts/frontend.js';
import { mayRecordObservation } from './observations.mjs';
export * from '../contracts/frontend.js';

const fields = ['total','compared','inlineExcluded','queryExcluded','crossOriginExcluded','privatePathExcluded','unavailable','overCap'];
const emptyCoverage = () => Object.fromEntries(fields.map(k => [k, 0]));
const validCoverage = c => c && fields.every(k => Number.isSafeInteger(c[k]) && c[k] >= 0) && fields.slice(1).reduce((s,k) => s+c[k],0) === c.total;
function assess({ observed, record, k = FRONTEND_K, maturityMs = FRONTEND_MATURITY_MS, now, drift = false, incident = false, counterpartyRisk = false, frame, dataState = 'unavailable', ageMs = null } = {}) {
  const coverage = validCoverage(observed?.coverage) ? observed.coverage : emptyCoverage();
  const result = { comparison: 'none', coverage, conflicts: [], unfamiliar: [], corroborated: false, redirectEligible: false, reasons: [], dataState: ['fresh','stale','unavailable'].includes(dataState) ? dataState : 'unavailable', ageMs: Number.isSafeInteger(ageMs) && ageMs >= 0 ? ageMs : null };
  try {
    if (k !== FRONTEND_K || maturityMs !== FRONTEND_MATURITY_MS || !Number.isSafeInteger(now) || now < 0 || !validCoverage(observed?.coverage) || observed?.version !== 1 || typeof observed.documentUrl !== 'string' || !Array.isArray(observed.scripts) || observed.scripts.length > 32 || !observed.scripts.every(s => isFrontendPath(s.path) && isFrontendHash(s.hash)) || !frame || typeof frame.isTop !== 'boolean' || typeof frame.sameOrigin !== 'boolean' || !['fresh','stale','unavailable'].includes(dataState) || (ageMs !== null && (!Number.isSafeInteger(ageMs) || ageMs < 0)) || typeof drift !== 'boolean' || typeof incident !== 'boolean' || typeof counterpartyRisk !== 'boolean') return result;
    if (dataState === 'unavailable') return result;
    if (record !== null && (!validateFrontendRecord(record) || Date.parse(record.updatedAt) > now)) return {...result, dataState:'unavailable'};
    if (dataState === 'fresh') {
      if (drift) result.reasons.push('drift'); if (incident) result.reasons.push('incident'); if (counterpartyRisk) result.reasons.push('counterparty');
      result.corroborated = result.reasons.length > 0;
    }
    if (record === null) return result;
    const rows = record.scripts.filter(r => now - Date.parse(r.lastSeen) < FRONTEND_REPORT_WINDOW_MS && r.reporters >= k && Date.parse(record.updatedAt) - Date.parse(r.firstSeen) >= maturityMs);
    let agree = false;
    const seen = new Set();
    for (const s of observed.scripts) {
      const key = `${s.path}\0${s.hash}`; if (seen.has(key)) continue; seen.add(key);
      const expected = rows.filter(r => r.path === s.path).map(r => r.hash);
      if (expected.includes(s.hash)) agree = true;
      else if (expected.length) result.conflicts.push({ path: s.path, observed: s.hash, expected });
      else result.unfamiliar.push({ path: s.path, hash: s.hash });
    }
    result.comparison = result.conflicts.length ? 'conflict' : result.unfamiliar.length ? 'unfamiliar' : agree ? 'agree' : 'none';
    result.redirectEligible = result.comparison === 'conflict' && result.corroborated && frame.isTop && frame.sameOrigin && frame.ambiguous !== true;
  } catch { return { ...result, comparison: 'none', conflicts: [], unfamiliar: [], corroborated: false, redirectEligible: false, reasons: [] }; }
  return result;
}
export function assessFrontend(input) {
  try { return assess(input); } catch { return assess(); }
}
// Provenance is an explicit input rather than hidden state on the assessment, so
// it survives serialization (pending observations, worker restarts) and callers
// must state which document the scripts came from.
function provenanceAllowsReporting(frame) {
  return frame?.isTop === true && frame.sameOrigin === true && frame.ambiguous !== true;
}
// This independent gate can be verified even while provenance is owner-controlled.
export function frontendReportingSafetyAllows({ communityReportingSafe, rawDrift, incident } = {}) {
  return communityReportingSafe === true && rawDrift === false && incident === false;
}
function candidates({ site, chain, observed, assessment, frame, verdict, incidentStatus, action, communityReportingSafe, rawDrift, incident, overrideUsed } = {}) {
  try {
    if (!mayRecordObservation({ verdict, incidentStatus, action }) || !frontendReportingSafetyAllows({ communityReportingSafe, rawDrift, incident }) || overrideUsed !== false || assessment?.dataState !== 'fresh' || assessment.comparison === 'conflict' || assessment.corroborated || !provenanceAllowsReporting(frame) || typeof site !== 'string' || !site || typeof chain !== 'string' || !chain || !Array.isArray(observed?.scripts)) return [];
    const seen = new Set(), output = [];
    for (const {path, hash} of observed.scripts) { if (!isFrontendPath(path) || !isFrontendHash(hash)) continue; const key = `${path}\0${hash}`; if (seen.has(key)) continue; seen.add(key); output.push({site,chain,kind:'frontend',path,hash}); if (output.length === 32) break; }
    return output;
  } catch { return []; }
}

export function frontendObservationCandidates(input) { try { return candidates(input); } catch { return []; } }
