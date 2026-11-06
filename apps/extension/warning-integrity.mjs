export function frontendIntegrityText(a) {
  if (!a) return 'Community data unavailable: scripts not compared';
  const c = a.coverage || {};
  const lines = [a.comparison === 'agree' ? `The observed subset agrees (${c.compared} of ${c.total} scripts compared)` : a.comparison === 'conflict' ? 'Frontend scripts differ from community data.' : a.comparison === 'unfamiliar' ? `${a.unfamiliar.length} unfamiliar scripts` : 'Community data unavailable: scripts not compared'];
  for (const conflict of a.conflicts || []) lines.push(`${conflict.path}: your hash ${conflict.observed}; community hashes ${conflict.expected.join(', ')}`);
  if (a.comparison !== 'unfamiliar' && a.unfamiliar?.length) lines.push(`${a.unfamiliar.length} unfamiliar scripts`);
  if (a.dataState === 'stale') lines.push(`Community data is stale (${a.ageMs} ms old).`);
  lines.push(`Coverage: ${Object.entries(c).map(([key,value]) => `${key}: ${value}`).join(', ')}`);
  lines.push('Blind spots: inline scripts, new file names, other origins, scripts beyond 32, and cached bytes may differ from executed code.');
  return lines.join('\n');
}
