// BOUND anon-rpc probe — service worker.
//
// Purpose: this package's `ensureAnonRpcWorker`/`createAnonRpcProvider`/`chain-facts` logic
// (../src/*.ts) is typechecked against the harness's real published types and unit-tested
// with a mocked fetch, but none of that can prove the harness actually BOOTS in a real
// browser — there is no DOM, no chrome.offscreen, and no sandboxed iframe under `node --test`.
// This extension is that proof, run by hand: load it unpacked, open the popup, and it either
// shows a real Sepolia eth_chainId answer that came back through the `nox` anon-rpc worker,
// or it shows exactly where booting failed.
//
// Deliberately NOT using this package's own TS modules — there is no bundler step here, and
// importing unbundled .ts into a plain `type: module` service worker would need one. This
// file re-implements just enough of worker-factory.ts/transport.ts by hand (boot once per
// incarnation, cache it, speak JSON-RPC over worker.fetch) to stay a true, minimal,
// no-build-step probe. If this file and the real package ever drift, the real package is
// correct — this is a throwaway harness smoke test, not a second implementation to maintain.

import { AnonRpcWorker } from "./vendor/anon-rpc-background.js";

// Verified against upstream adopters.json5 (github.com/ethereum/anon-rpc) — see
// ../src/known-workers.ts, which is the single source of truth this file is intentionally
// duplicating a slice of, by hand, for a zero-build probe.
const NOX_SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";
const NOX_CHAIN_ID = 11155111; // Sepolia — BOUND's own target chain.

// Public Sepolia endpoints, tried in order, for the harness's §4 specifier read. This is the
// bootstrap connection ONLY — it is never used for the anonymized call the booted worker goes
// on to make.
const BOOTSTRAP_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
];

async function bootstrapRequest(method, params) {
  let lastError;
  for (const url of BOOTSTRAP_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? "RPC error");
      return body.result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("no bootstrap RPC reachable");
}

let worker; // per-incarnation cache; see ../src/worker-factory.ts for the real version

async function ensureWorker() {
  if (worker) return worker;
  const w = new AnonRpcWorker({
    address: NOX_SPECIFIER,
    preExisting: { rpcProvider: { request: ({ method, params }) => bootstrapRequest(method, params) } },
  });
  await w.ready; // only cache a worker that actually booted
  worker = w;
  return w;
}

async function run() {
  const t0 = Date.now();
  const w = await ensureWorker();
  const res = await w.fetch("https://ethereum-sepolia-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) throw new Error(`worker fetch HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "worker RPC error");
  const chainId = Number(body.result);
  return {
    ok: true,
    chainId,
    matchesNoxChain: chainId === NOX_CHAIN_ID,
    ms: Date.now() - t0,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== "probe") return;
  run().then(
    (result) => respond(result),
    (error) => respond({ ok: false, error: error?.message ?? String(error) }),
  );
  return true; // keep the message channel open for the async respond
});
