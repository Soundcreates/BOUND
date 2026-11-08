// Pure classifier: observations must be obtained and validated by the caller.
// Missing network attribution cannot corroborate an address change.
const ordered = items => [...new Set(items)].sort();
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const known = (observation) => observation.addresses.length > 0 && observation.addresses.every(ip => typeof observation.asns[ip] === 'string' && observation.asns[ip].length > 0);
const strings = values => Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string' && value.length > 0);
const complete = value => value && strings(value.nameservers) && strings(value.addresses) && value.asns && typeof value.asns === 'object' && !Array.isArray(value.asns) && value.certificate && typeof value.certificate.fingerprint === 'string' && value.certificate.fingerprint.length > 0 && typeof value.certificate.issuer === 'string' && value.certificate.issuer.length > 0 && strings(value.certificate.names);
export function classifyDrift(before, after) {
  if (!complete(before) || !complete(after)) throw new Error('incomplete polling result');
  const changes = [];
  let corroborated = false;
  if (!same(before.nameservers, after.nameservers)) {
    changes.push({kind:'ns',before:ordered(before.nameservers),after:ordered(after.nameservers)});
    corroborated = true;
  }
  if (before.certificate.fingerprint !== after.certificate.fingerprint || before.certificate.issuer !== after.certificate.issuer || !same(before.certificate.names, after.certificate.names)) {
    changes.push({kind:'cert',before:[`fingerprint:${before.certificate.fingerprint}`],after:[`fingerprint:${after.certificate.fingerprint}`]});
    if (before.certificate.issuer !== after.certificate.issuer || !same(before.certificate.names, after.certificate.names)) corroborated = true;
  }
  if (!same(before.addresses, after.addresses)) {
    changes.push({kind:'a-record',before:ordered(before.addresses),after:ordered(after.addresses)});
    if (known(before) && known(after) && !same(before.addresses.map(ip=>before.asns[ip]), after.addresses.map(ip=>after.asns[ip]))) corroborated = true;
  }
  changes.sort((a,b)=>a.kind.localeCompare(b.kind));
  return {changes,corroborated};
}
