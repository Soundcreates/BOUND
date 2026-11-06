import http from 'node:http';
import {createHijackServer as createBackend} from './server.js';

const HOST = '127.0.0.1';
const MODES = new Set(['normal', 'hijack']);

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

function createProxy(mode, backends) {
  return http.createServer((request, response) => {
    const target = backends[mode.value];
    const headers = {...request.headers, host: HOST + ':' + target.port};
    delete headers.connection;
    const upstream = http.request({
      hostname: HOST,
      port: target.port,
      path: request.url,
      method: request.method,
      headers,
    }, upstreamResponse => {
      const responseHeaders = {...upstreamResponse.headers, 'x-bound-demo-upstream': mode.value};
      for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']) {
        delete responseHeaders[name];
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
      response.end('Local demo backend unavailable');
    });
    request.pipe(upstream);
  });
}

// Local HTTP-only switch for rehearsing a backend cutover without changing the visible origin.
export async function createDemoCutover({port = 4173, token, spender, scannerClean=false} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer between 0 and 65535');
  const mode = {value: 'normal'};
  const normalServer = createBackend({mode: 'clean', token, spender});
  const hijackServer = createBackend({mode: 'attack', token, spender, scannerClean});
  let proxyServer;

  try {
    const normalAddress = await listen(normalServer, 0);
    const hijackAddress = await listen(hijackServer, 0);
    proxyServer = createProxy(mode, {
      normal: {port: normalAddress.port},
      hijack: {port: hijackAddress.port},
    });
    const proxyAddress = await listen(proxyServer, port);
    let closed = false;
    return {
      origin: 'http://' + HOST + ':' + proxyAddress.port,
      get mode() { return mode.value; },
      setMode(nextMode) {
        if (!MODES.has(nextMode)) throw new TypeError('mode must be normal or hijack');
        mode.value = nextMode;
      },
      async close() {
        if (closed) return;
        closed = true;
        await close(proxyServer);
        await close(normalServer);
        await close(hijackServer);
      },
    };
  } catch (error) {
    if (proxyServer?.listening) await close(proxyServer);
    if (normalServer.listening) await close(normalServer);
    if (hijackServer.listening) await close(hijackServer);
    throw error;
  }
}
