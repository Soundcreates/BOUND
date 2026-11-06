// A poll is an all-or-nothing DNS/TLS snapshot; ASN is optional corroboration.
// Network-specific resolvers and TLS collectors are injected by the caller.
export async function pollSite(site, {resolve, certificate, lookupAsn}, {nameserverZone} = {}) {
  let url;
  try { url = new URL(`https://${site}`); } catch { throw new Error('invalid host'); }
  if (typeof site !== 'string' || url.host !== site || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('invalid host');
  const zone = nameserverZone ?? url.hostname;
  if (typeof zone !== 'string' || !/^[a-z0-9.-]+$/.test(zone) || zone.endsWith('.') || (url.hostname !== zone && !url.hostname.endsWith('.' + zone))) throw new Error('invalid nameserver zone');
  if (typeof resolve !== 'function' || typeof certificate !== 'function' || typeof lookupAsn !== 'function') throw new Error('poll adapters required');
  const [ns, addresses, cert] = await Promise.all([resolve(zone,'NS'),resolve(url.hostname,'A'),certificate(url.hostname, Number(url.port) || 443)]);
  const list = values => Array.isArray(values) && values.every(v => typeof v === 'string' && v.length > 0);
  if (!list(ns) || !ns.length || !list(addresses) || !addresses.length || !cert || typeof cert.fingerprint !== 'string' || !cert.fingerprint || typeof cert.issuer !== 'string' || !cert.issuer || !list(cert.names) || !cert.names.length) throw new Error('incomplete polling result');
  const unique = values => [...new Set(values)].sort();
  const normalizedAddresses = unique(addresses);
  const asns = Object.create(null);
  await Promise.all(normalizedAddresses.map(async ip => {
    try { const asn = await lookupAsn(ip); if (typeof asn === 'string' && asn) asns[ip] = asn; } catch { /* unavailable data is not corroboration */ }
  }));
  return {nameservers:unique(ns.map(name=>name.toLowerCase().replace(/\.$/,''))),addresses:normalizedAddresses,asns:{...asns},certificate:{fingerprint:cert.fingerprint,issuer:cert.issuer,names:unique(cert.names.map(name=>name.toLowerCase()))}};
}
