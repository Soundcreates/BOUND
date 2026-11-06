(() => {
  const NativePromise = Promise;
  const promiseResolve = Promise.resolve;
  const promiseReject = Promise.reject;
  const promiseThen = Promise.prototype.then;
  const stringify = JSON.stringify;
  const addEvent = window.addEventListener.bind(window);
  const postMessage = window.postMessage.bind(window);
  const stopImmediate = Event.prototype.stopImmediatePropagation;
  const freeze = Object.freeze;
  const objectPrototype = Object.prototype;
  const create = Object.create;
  const getPrototype = Object.getPrototypeOf;
  const setPrototype = Object.setPrototypeOf;
  const descriptors = Object.getOwnPropertyDescriptor;
  const keys = Reflect.ownKeys;
  const weakHas = WeakSet.prototype.has;
  const weakAdd = WeakSet.prototype.add;
  const weakDelete = WeakSet.prototype.delete;
  const weakMapGet = WeakMap.prototype.get;
  const weakMapSet = WeakMap.prototype.set;
  const mapGet = Map.prototype.get;
  const mapSet = Map.prototype.set;
  const mapDelete = Map.prototype.delete;
  const NativeWeakSet = WeakSet;
  const NativeWeakMap = WeakMap;
  const NativeMap = Map;
  const NativeError = Error;
  const NativeTypeError = TypeError;
  const NativeUint8Array = Uint8Array;
  const numberIsFinite = Number.isFinite;
  const lower = String.prototype.toLowerCase;
  const regexpTest = RegExp.prototype.test;
  const addressPattern = /^0x[0-9a-f]{40}$/i;
  const chainPattern = /^0x[0-9a-f]+$/i;
  const isArray = Array.isArray;
  const arraySome = Array.prototype.some;
  const arrayMap = Array.prototype.map;
  const apply = Reflect.apply;
  const encode = TextEncoder.prototype.encode;
  const encoder = new TextEncoder();
  const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
  const randomUuid = crypto.randomUUID.bind(crypto);
  const setTimeoutNative = window.setTimeout.bind(window);
  const clearTimeoutNative = window.clearTimeout.bind(window);
  const promise = (value, ok, fail) => apply(promiseThen, value, [ok, fail]);
  const weakHasValue = (set, value) => apply(weakHas, set, [value]);
  const weakAddValue = (set, value) => apply(weakAdd, set, [value]);
  const weakDeleteValue = (set, value) => apply(weakDelete, set, [value]);
  const mapGetValue = (map, key) => apply(mapGet, map, [key]);
  const mapSetValue = (map, key, value) => apply(mapSet, map, [key, value]);
  const mapDeleteValue = (map, key) => apply(mapDelete, map, [key]);
  const providers = new NativeWeakSet();
  const providerRevisions = new NativeWeakMap();
  const revisionOf = (provider) => apply(weakMapGet, providerRevisions, [provider]) || 0;
  const waiting = new NativeMap();
  let channel = null;
  let providerInstrumented = false;
  let releaseChannel;
  const channelReady = new NativePromise((resolve) => { releaseChannel = resolve; });
  let sequence = 0;

  function clone(value, seen = new NativeWeakSet(), depth = 0) {
    if (depth > 32) throw new NativeTypeError("Request nesting is too deep");
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !numberIsFinite(value)) throw new NativeTypeError("Invalid request number");
      return value;
    }
    if (typeof value !== "object" || weakHasValue(seen, value)) throw new NativeTypeError("Request is not plain data");
    const proto = getPrototype(value);
    if (!isArray(value) && proto !== objectPrototype && proto !== null) throw new NativeTypeError("Request is not plain data");
    weakAddValue(seen, value);
    const result = isArray(value) ? [] : create(null);
    if (isArray(value)) setPrototype(result, null);
    const ownKeys = keys(value);
    for (let i = 0; i < ownKeys.length; i++) {
      const key = ownKeys[i];
      if (typeof key !== "string") throw new NativeTypeError("Symbol request keys are unsupported");
      const descriptor = descriptors(value, key);
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) throw new NativeTypeError("Request accessors are unsupported");
      result[key] = clone(descriptor.value, seen, depth + 1);
    }
    weakDeleteValue(seen, value);
    return freeze(result);
  }

  function gate(provider, forward, request, state, readState, revision) {
    // BOUND never refuses a request: anything it cannot check goes to the wallet as sent.
    if (revisionOf(provider) !== revision) return forward(request);
    let frozen;
    try {
      frozen = clone(request);
      if (apply(encode, encoder, [stringify(frozen)]).length > 262144) throw new NativeTypeError("Request is too large");
    } catch {
      reportMalformed(request);
      return forward(request);
    }
    const id = `${++sequence}:${randomUuid()}`;
    return promise(channelReady, (secret) => new NativePromise((resolve, reject) => {
      if (!secret) {
        // BOUND cannot score this request; let the wallet handle it rather than refuse it.
        promise(forward(frozen), resolve, reject);
        return;
      }
      promise(digestValue(stringify(frozen)), (digest) => promise(digestValue(stringify(state)), (stateDigest) => {
        if (revisionOf(provider) !== revision) {
          promise(forward(frozen), resolve, reject);
          return;
        }
        mapSetValue(waiting, id, { provider, forward, frozen, resolve, reject, state, readState, revision, digest, stateDigest });
        const timer = setTimeoutNative(() => {
          if (!mapDeleteValue(waiting, id)) return;
          promise(forward(frozen), resolve, reject);
        }, 11 * 60_000);
        mapGetValue(waiting, id).timer = timer;
        postMessage({ type: "BOUND_REQUEST_V1", id, request: frozen, state, digest, stateDigest }, location.origin);
      }), reject);
    }));
  }

  function digestValue(value) {
    const bytes = apply(encode, encoder, [value]);
    return promise(subtleDigest("SHA-256", bytes), (digestBytes) => {
      const digits = "0123456789abcdef";
      let hex = "";
      const data = new NativeUint8Array(digestBytes);
      for (let i = 0; i < data.length; i++) hex += digits[(data[i] >> 4) & 15] + digits[data[i] & 15];
      return hex;
    });
  }

  // Reads that cannot sign or move value. If a page (or another wallet extension's
  // own script) sends one as a non-plain object, rebuild it as a frozen plain
  // request and pass it to the wallet instead of rejecting it or alerting.
  const PASSIVE_METHODS = ["eth_chainId", "net_version", "net_listening", "web3_clientVersion", "eth_accounts", "eth_coinbase",
    "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_syncing",
    "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getProof", "eth_getTransactionCount", "eth_getBlockByNumber",
    "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_subscribe", "eth_unsubscribe",
    "wallet_getPermissions", "wallet_getCapabilities", "wallet_getCallsStatus", "metamask_getProviderState"];
  const arrayIncludes = Array.prototype.includes;
  function rescuePassive(payload) {
    try {
      const methodDescriptor = descriptors(payload, "method");
      if (!methodDescriptor || !("value" in methodDescriptor) || typeof methodDescriptor.value !== "string" || !apply(arrayIncludes, PASSIVE_METHODS, [methodDescriptor.value])) return null;
      const rebuilt = create(null);
      rebuilt.method = methodDescriptor.value;
      const paramsDescriptor = descriptors(payload, "params");
      if (paramsDescriptor && !("value" in paramsDescriptor)) return null;
      rebuilt.params = paramsDescriptor && paramsDescriptor.value !== undefined ? clone(paramsDescriptor.value) : freeze(setPrototype([], null));
      const idDescriptor = descriptors(payload, "id");
      if (idDescriptor && "value" in idDescriptor && (typeof idDescriptor.value === "number" || typeof idDescriptor.value === "string")) rebuilt.id = idDescriptor.value;
      return freeze(rebuilt);
    } catch { return null; }
  }

  function reportMalformed(payload) {
    let method = "unknown";
    try {
      const descriptor = descriptors(payload, "method");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") method = descriptor.value.slice(0, 100);
    } catch { /* malformed input cannot supply trusted metadata */ }
    postMessage({ type: "BOUND_MALFORMED_V1", id: randomUuid(), method }, location.origin);
  }

  function mediate(provider) {
    if (!provider || weakHasValue(providers, provider)) return Boolean(provider);
    const own = (name) => {
      try { return provider[name]; } catch { return null; }
    };
    const request = own("request"), send = own("send"), sendAsync = own("sendAsync");
    if (typeof request !== "function" && typeof send !== "function" && typeof sendAsync !== "function") {
      reportBypass();
      return false;
    }
    const read = (method) => {
      if (typeof request === "function") return apply(request, provider, [{ method }]);
      if (typeof sendAsync === "function") return new NativePromise((resolve, reject) => apply(sendAsync, provider, [{ method, params: [] }, (error, response) => error ? reject(error) : resolve(response?.result)]));
      if (typeof send === "function") return apply(send, provider, [method, []]);
      return apply(promiseReject, NativePromise, [new NativeError("No read path")]);
    };
    const readState = () => new NativePromise((resolve) => {
      let chainId, accounts, remaining = 2, finished = false;
      const timer = setTimeoutNative(() => finish(null), 5_000);
      function finish(value) {
        if (finished) return;
        finished = true;
        clearTimeoutNative(timer);
        resolve(value);
      }
      function complete() {
        if (--remaining || finished) return;
        try {
          if (typeof chainId !== "string" || chainId.length > 66 || !apply(regexpTest, chainPattern, [chainId]) || !isArray(accounts) || accounts.length > 32 || apply(arraySome, accounts, [(item) => typeof item !== "string" || !apply(regexpTest, addressPattern, [item])])) return finish(null);
          const normalizedAccounts = apply(arrayMap, accounts, [(item) => apply(lower, item, [])]);
          setPrototype(normalizedAccounts, null);
          const state = create(null);
          state.chainId = apply(lower, chainId, []);
          state.accounts = freeze(normalizedAccounts);
          finish(freeze(state));
        } catch { finish(null); }
      }
      try {
        promise(apply(promiseResolve, NativePromise, [read("eth_chainId")]), (value) => { chainId = value; complete(); }, () => finish(null));
        promise(apply(promiseResolve, NativePromise, [read("eth_accounts")]), (value) => { accounts = value; complete(); }, () => finish(null));
      } catch { finish(null); }
    });
    try {
      if (typeof request === "function") {
        const wrappedRequest = function (payload) {
        let frozen;
        try { frozen = clone(payload); } catch (error) {
          const passive = rescuePassive(payload);
          if (passive) return apply(request, provider, [passive]);
          reportMalformed(payload); error.code = -32602; return apply(promiseReject, NativePromise, [error]);
        }
        const revision = revisionOf(provider);
        return promise(readState(), (state) => gate(provider, (exact) => apply(request, provider, [exact]), frozen, state, readState, revision));
        };
        provider.request = wrappedRequest;
        if (provider.request !== wrappedRequest) throw new NativeError("request could not be patched");
      }
      if (typeof send === "function") {
        const wrappedSend = function (methodOrPayload, paramsOrCallback, callbackArg) {
        const callback = typeof callbackArg === "function" ? callbackArg : typeof paramsOrCallback === "function" ? paramsOrCallback : null;
        const payload = typeof methodOrPayload === "string"
          ? (paramsOrCallback === undefined || typeof paramsOrCallback === "function" ? { method: methodOrPayload } : { method: methodOrPayload, params: paramsOrCallback })
          : methodOrPayload;
        let frozen;
        try { frozen = clone(payload); } catch (error) {
          const passive = rescuePassive(payload);
          if (passive) {
            if (!callback) return apply(send, provider, [passive]);
            return void apply(sendAsync ?? send, provider, [passive, callback]);
          }
          reportMalformed(payload);
          error.code = -32602;
          if (callback) { callback(error); return; }
          return apply(promiseReject, NativePromise, [error]);
        }
        const revision = revisionOf(provider);
        const resultPromise = promise(readState(), (state) => gate(provider, (exact) => {
          if (!callback) return typeof methodOrPayload === "string" ? apply(send, provider, [exact.method, exact.params]) : apply(send, provider, [exact]);
          return new NativePromise((resolve, reject) => {
            const done = (error, response) => error ? reject(error) : resolve(response);
            const returned = typeof methodOrPayload === "string"
              ? apply(send, provider, [exact.method, exact.params, done])
              : apply(send, provider, [exact, done]);
            if (returned?.then) promise(returned, resolve, reject);
          });
        }, frozen, state, readState, revision));
        if (callback) {
          promise(resultPromise, (result) => callback(null, { jsonrpc: "2.0", id: frozen.id ?? null, result }), callback);
          return;
        }
        return resultPromise;
        };
        provider.send = wrappedSend;
        if (provider.send !== wrappedSend) throw new NativeError("send could not be patched");
      }
      if (typeof sendAsync === "function") {
        const wrappedSendAsync = function (payload, callback) {
        let frozen;
        try { frozen = clone(payload); } catch (error) {
          const passive = rescuePassive(payload);
          if (passive) return apply(sendAsync, provider, [passive, callback]);
          reportMalformed(payload); error.code = -32602; callback?.(error); return;
        }
        const revision = revisionOf(provider);
        return promise(promise(readState(), (state) => gate(provider, (exact) => new NativePromise((resolve, reject) => apply(sendAsync, provider, [exact, (error, response) => error ? reject(error) : resolve(response)])), frozen, state, readState, revision)), (response) => callback?.(null, response), (error) => callback?.(error));
        };
        provider.sendAsync = wrappedSendAsync;
        if (provider.sendAsync !== wrappedSendAsync) throw new NativeError("sendAsync could not be patched");
      }
      weakAddValue(providers, provider);
      providerInstrumented = true;
      const on = own("on");
      if (typeof on === "function") {
        const providerEvents = ["chainChanged", "accountsChanged", "disconnect"];
        for (let i = 0; i < providerEvents.length; i++) {
          const event = providerEvents[i];
          apply(on, provider, [event, () => {
            apply(weakMapSet, providerRevisions, [provider, revisionOf(provider) + 1]);
            postMessage({ type: "BOUND_STATE_CHANGE_V1", event }, location.origin);
          }]);
        }
      }
    } catch {
      window.__boundCoverage = "bypass_possible";
      reportBypass();
    }
  }

  function reportBypass() {
    postMessage({ type: "BOUND_COVERAGE_V1", coverage: "bypass_possible" }, location.origin);
  }

  // --- MetaMask Connect / Multichain API (CAIP-25) -------------------------------
  // Some dApps (e.g. app.uniswap.org) never call window.ethereum. They talk to the
  // wallet through @metamask/multichain-api-client, either over a chrome.runtime
  // port (`{type:"caip-348", data:<JSON-RPC>}`) or over window.postMessage
  // (`{target:"metamask-contentscript", data:{name:"metamask-multichain-provider",
  // data:<JSON-RPC>}}`). Both run in this MAIN world, so wrap them here and route
  // session creation and wallet-invoked methods through the same BOUND gate.
  const MM_CONTENT_SCRIPT = "metamask-contentscript";
  const MM_INPAGE = "metamask-inpage";
  const MM_MULTICHAIN = "metamask-multichain-provider";
  const MM_CAIP_PORT_TYPE = "caip-348";
  const caipProvider = freeze(create(null));
  const evmChain = /^eip155:([0-9]{1,20})$/;
  const parseInt10 = Number.parseInt;
  const numberToString = Number.prototype.toString;
  const objectKeys = Object.keys;

  function caipChainId(scope) {
    const match = typeof scope === "string" ? scope.match(evmChain) : null;
    if (!match) return null;
    const value = parseInt10(match[1], 10);
    return numberIsFinite(value) && value > 0 ? "0x" + apply(numberToString, value, [16]) : null;
  }

  function sessionChainId(params) {
    const scopes = [params?.requiredScopes, params?.optionalScopes];
    for (let i = 0; i < scopes.length; i++) {
      if (!scopes[i] || typeof scopes[i] !== "object") continue;
      const names = objectKeys(scopes[i]);
      for (let j = 0; j < names.length; j++) { const chain = caipChainId(names[j]); if (chain) return chain; }
    }
    return null;
  }

  // Returns {inner, chainId} for requests BOUND must review, or null to pass through.
  function caipReviewTarget(rpc) {
    if (!rpc || typeof rpc !== "object") return null;
    if (rpc.method === "wallet_createSession") return { inner: { method: "wallet_createSession", params: [rpc.params ?? null] }, chainId: sessionChainId(rpc.params) || "0x1" };
    if (rpc.method === "wallet_invokeMethod") {
      const request = rpc.params?.request;
      const chainId = caipChainId(rpc.params?.scope);
      if (!request || typeof request.method !== "string") return { inner: { method: "wallet_invokeMethod", params: [rpc.params ?? null] }, chainId: chainId || "0x1" };
      // Non-EVM scopes cannot be decoded by BOUND; review them as unsupported.
      return { inner: chainId ? { method: request.method, params: request.params ?? [] } : { method: "wallet_invokeMethod", params: [rpc.params ?? null] }, chainId: chainId || "0x1" };
    }
    return null;
  }

  // deliver(): send the frozen original message to the wallet.
  // fail(error): answer the dApp with a JSON-RPC error in the transport's own format.
  function gateCaip(rpc, deliver, fail) {
    let frozenRpc, target;
    try {
      frozenRpc = clone(rpc);
      target = caipReviewTarget(frozenRpc);
    } catch (error) {
      reportMalformed(rpc);
      error.code = -32602;
      fail(rpc?.id, error);
      return true;
    }
    if (!target) return false;
    let state;
    try {
      const value = create(null);
      value.chainId = target.chainId;
      value.accounts = freeze(setPrototype([], null));
      state = freeze(value);
    } catch { return false; }
    const readState = () => apply(promiseResolve, NativePromise, [state]);
    promise(gate(caipProvider, () => deliver(frozenRpc), target.inner, state, readState, 0), () => {}, (error) => fail(frozenRpc.id, error));
    return true;
  }

  function rpcError(id, error) {
    const body = create(null);
    body.jsonrpc = "2.0";
    body.id = id ?? null;
    const detail = create(null);
    detail.code = typeof error?.code === "number" ? error.code : 4001;
    detail.message = typeof error?.message === "string" ? error.message : "User rejected the request.";
    body.error = detail;
    return body;
  }

  try {
    const nativeWindowPostMessage = window.postMessage;
    const wrappedWindowPostMessage = function (message, ...rest) {
      try {
        if ((this === undefined || this === window) && message && message.target === MM_CONTENT_SCRIPT && message.data?.name === MM_MULTICHAIN) {
          const handled = gateCaip(message.data.data,
            (frozen) => apply(nativeWindowPostMessage, window, [{ target: MM_CONTENT_SCRIPT, data: { name: MM_MULTICHAIN, data: frozen } }, location.origin]),
            (id, error) => postMessage({ target: MM_INPAGE, data: { name: MM_MULTICHAIN, data: rpcError(id, error) } }, location.origin));
          if (handled) return;
        }
      } catch { /* fall through to the native call */ }
      return apply(nativeWindowPostMessage, this === undefined ? window : this, [message, ...rest]);
    };
    window.postMessage = wrappedWindowPostMessage;
    if (window.postMessage !== wrappedWindowPostMessage) reportBypass();
  } catch { reportBypass(); }

  function instrumentPort(port) {
    if (!port || typeof port.postMessage !== "function" || !port.onMessage || typeof port.onMessage.addListener !== "function") return;
    const listeners = [];
    const nativeAdd = port.onMessage.addListener;
    const nativeRemove = port.onMessage.removeListener;
    const nativePost = port.postMessage;
    port.onMessage.addListener = function (fn) { if (typeof fn === "function") listeners.push(fn); return apply(nativeAdd, this, [fn]); };
    if (typeof nativeRemove === "function") port.onMessage.removeListener = function (fn) { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); return apply(nativeRemove, this, [fn]); };
    port.postMessage = function (message) {
      try {
        if (message && message.type === MM_CAIP_PORT_TYPE) {
          const handled = gateCaip(message.data,
            (frozen) => apply(nativePost, port, [{ type: MM_CAIP_PORT_TYPE, data: frozen }]),
            (id, error) => { const reply = { data: rpcError(id, error) }; for (let i = 0; i < listeners.length; i++) { try { listeners[i](reply, port); } catch { /* listener errors are the dApp's */ } } });
          if (handled) return;
        }
      } catch { /* fall through */ }
      return apply(nativePost, port, [message]);
    };
    if (port.postMessage === nativePost) reportBypass();
  }

  try {
    const runtime = window.chrome?.runtime;
    if (runtime && typeof runtime.connect === "function") {
      const nativeConnect = runtime.connect;
      const wrappedConnect = function (...args) {
        const port = apply(nativeConnect, this ?? runtime, args);
        try { instrumentPort(port); } catch { reportBypass(); }
        return port;
      };
      runtime.connect = wrappedConnect;
      if (runtime.connect !== wrappedConnect) reportBypass();
    }
  } catch { reportBypass(); }

  addEvent("BOUND_INIT_V1", (event) => {
    if (event.target !== window || channel || typeof event.detail !== "string" || !/^[0-9a-f-]{36}$/i.test(event.detail)) return;
    apply(stopImmediate, event, []);
    channel = event.detail;
    releaseChannel(channel);
  });
  addEvent("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== "BOUND_DECISION_V1" || event.data?.channel !== channel) return;
    apply(stopImmediate, event, []);
    const item = mapGetValue(waiting, event.data.id);
    if (!item || event.data.digest !== item.digest) return;
    if (event.data.stateDigest !== item.stateDigest) return;
    mapDeleteValue(waiting, event.data.id);
    clearTimeoutNative(item.timer);
    if (revisionOf(item.provider) !== item.revision && event.data.action !== "cancel") {
      promise(item.forward(item.frozen), item.resolve, item.reject);
      return;
    }
    if (event.data.action === "continue" && event.data.readOnly === true) {
      promise(item.forward(item.frozen), item.resolve, item.reject);
    } else if (event.data.action === "continue") {
      if (!item.state || !item.readState) {
        // Nothing to compare against: the user chose to continue, so forward it.
        promise(item.forward(item.frozen), item.resolve, item.reject);
      } else {
        promise(promise(item.readState(), (state) => {
          // The wallet re-checks chain and account in its own prompt; BOUND does not refuse.
          const result = item.forward(item.frozen);
          if (typeof event.data.receiptToken === "string") postMessage({ type: "BOUND_FORWARDED_V1", channel, receiptToken: event.data.receiptToken, digest: item.digest, stateDigest: item.stateDigest }, location.origin);
          return result;
        }), item.resolve, item.reject);
      }
    } else {
      // Only the user's own Cancel gets here: BOUND itself never refuses a request.
      const error = new NativeError("User rejected the request.");
      error.code = 4001;
      item.reject(error);
    }
  });

  setTimeoutNative(() => {
    if (!channel) releaseChannel(null);
    if (!providerInstrumented) reportBypass();
  }, 2_000);
  try { mediate(window.ethereum); } catch { window.__boundCoverage = "bypass_possible"; }
  addEvent("eip6963:announceProvider", (event) => { try { mediate(event.detail?.provider); } catch { window.__boundCoverage = "bypass_possible"; } });
  const discoverProvider = () => {
    try { mediate(window.ethereum); } catch { reportBypass(); }
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  };
  addEvent("ethereum#initialized", discoverProvider);
  discoverProvider();
  setTimeoutNative(discoverProvider, 1000);
  setTimeoutNative(discoverProvider, 2500);
})();
