import tls from 'node:tls';
import { isIP } from 'node:net';

// Poll only explicitly configured sites. The resolver sees watched domains;
// this watcher-side traffic is not a substitute for client Anon-RPC.
export function createNetworkPollAdapters({resolverUrl = 'https://cloudflare-dns.com/dns-query', fetchImpl = fetch, connectImpl = tls.connect, lookupAsn, timeoutMs = 5000} = {}) {
  const resolver = new URL(resolverUrl);
  if (resolver.protocol !== 'https:' || resolver.username || resolver.password || resolver.hash || typeof lookupAsn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('invalid network poll configuration');
  async function resolve(host, type) {
    if (!['A','NS'].includes(type)) throw new Error('unsupported DNS type');
    const url = new URL(resolver);
    url.searchParams.set('name',host); url.searchParams.set('type',type);
    const response = await fetchImpl(url.toString(), {headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) throw new Error('DNS HTTP failure');
    const data = await response.json();
    if (!data || data.Status !== 0 || !Array.isArray(data.Answer) || data.Answer.length > 256) throw new Error('DNS response unavailable');
    const expectedType = type === 'A' ? 1 : 2;
    const values = data.Answer.filter(a => a && a.type === expectedType).map(a => a.data);
    if (!values.length || values.some(value => typeof value !== 'string' || (type === 'A' ? isIP(value) !== 4 : !/^(?=.{1,254}$)[a-zA-Z0-9._-]+\.?$/.test(value)))) throw new Error('DNS response invalid');
    return values;
  }
  function certificate(host, port) {
    return new Promise((resolveResult,reject) => {
      let socket, timer;
      const finish = (error,result) => { clearTimeout(timer); socket?.destroy(); error ? reject(error) : resolveResult(result); };
      try {
        socket = connectImpl({host,port,servername:host,rejectUnauthorized:true});
        timer = setTimeout(()=>finish(new Error('TLS timeout')),timeoutMs);
        socket.once('error',error=>finish(error));
        socket.once('secureConnect',()=>{
          try {
            const cert = socket.getPeerCertificate();
            const names = typeof cert.subjectaltname === 'string' ? cert.subjectaltname.split(', ').filter(part=>part.startsWith('DNS:')).map(part=>part.slice(4)) : [];
            if (typeof cert.fingerprint256 !== 'string' || !cert.fingerprint256 || !cert.issuer || !names.length || names.some(name=>!/^\*?[a-zA-Z0-9.-]+$/.test(name))) throw new Error('TLS certificate incomplete');
            const issuer = JSON.stringify(Object.fromEntries(Object.entries(cert.issuer).sort(([a],[b])=>a.localeCompare(b))));
            finish(null,{fingerprint:cert.fingerprint256,issuer,names});
          } catch (error) { finish(error); }
        });
      } catch (error) { finish(error); }
    });
  }
  return {resolve,certificate,lookupAsn};
}
