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
    if (revisionOf(provider) !== revision) {
      const error = new NativeError("Wallet state changed while the request was prepared.");
      error.code = 4001;
      return apply(promiseReject, NativePromise, [error]);
    }
    let frozen;
    try {
      frozen = clone(request);
      if (apply(encode, encoder, [stringify(frozen)]).length > 262144) throw new NativeTypeError("Request is too large");
    } catch (error) {
      reportMalformed(request);
      error.code = -32602;
      return apply(promiseReject, NativePromise, [error]);
    }
    const id = `${++sequence}:${randomUuid()}`;
    return promise(channelReady, (secret) => new NativePromise((resolve, reject) => {
      if (!secret) {
        const error = new NativeError("The extension bridge is unavailable.");
        error.code = 4001;
        reject(error);
        return;
      }
      promise(digestValue(stringify(frozen)), (digest) => promise(digestValue(stringify(state)), (stateDigest) => {
        if (revisionOf(provider) !== revision) {
          const error = new NativeError("Wallet state changed while the request was prepared.");
          error.code = 4001;
          reject(error);
          return;
        }
        mapSetValue(waiting, id, { provider, forward, frozen, resolve, reject, state, readState, revision, digest, stateDigest });
        const timer = setTimeoutNative(() => {
          if (!mapDeleteValue(waiting, id)) return;
          const error = new NativeError("BOUND request timed out.");
          error.code = 4001;
          reject(error);
        }, 50_000);
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
        try { frozen = clone(payload); } catch (error) { reportMalformed(payload); error.code = -32602; return apply(promiseReject, NativePromise, [error]); }
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
        try { frozen = clone(payload); } catch (error) { reportMalformed(payload); error.code = -32602; callback?.(error); return; }
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
    if (revisionOf(item.provider) !== item.revision) {
      const error = new NativeError("Wallet state changed while the warning was open.");
      error.code = 4001;
      item.reject(error);
      return;
    }
    if (event.data.action === "continue" && event.data.readOnly === true) {
      promise(item.forward(item.frozen), item.resolve, item.reject);
    } else if (event.data.action === "continue") {
      if (!item.state || !item.readState) {
        const error = new NativeError("Provider state could not be verified.");
        error.code = 4001;
        item.reject(error);
      } else {
        promise(promise(item.readState(), (state) => {
          if (!state || stringify(state) !== stringify(item.state)) {
            const error = new NativeError("Wallet chain or accounts changed while the warning was open.");
            error.code = 4001;
            throw error;
          }
          const result = item.forward(item.frozen);
          if (typeof event.data.receiptToken === "string") postMessage({ type: "BOUND_FORWARDED_V1", channel, receiptToken: event.data.receiptToken, digest: item.digest, stateDigest: item.stateDigest }, location.origin);
          return result;
        }), item.resolve, item.reject);
      }
    } else {
      const statusMessages = { active: "BOUND blocked the connection: the watcher reports an active incident.", drift: "BOUND blocked the connection: the watcher reports an infrastructure change.", unknown: "BOUND blocked the connection: site verification or current watcher status is unavailable." };
      const score = event.data.connectionScore;
      const scoreText = typeof score?.score === "number" && typeof score?.threshold === "number" ? ` Connection score ${score.score}/100; requires ${score.threshold}.` : "";
      const error = new NativeError((statusMessages[event.data.connectionStatus] || "User rejected the request.") + scoreText);
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
