# BOUND anon-rpc probe

A minimal, hand-written MV3 extension that boots the real `nox` anon-rpc worker (published
on Sepolia — BOUND's own target chain, specifier verified against upstream
`adopters.json5`) and makes one anonymized `eth_chainId` call through it.

## Why this exists

`../src/*.ts` (`worker-factory.ts`, `transport.ts`, `budget.ts`, `chain-facts.ts`,
`known-workers.ts`) is typechecked against the harness's real published types and
unit-tested against a mocked `fetch`. None of that can prove the harness actually **boots**:
`AnonRpcWorker` needs `chrome.offscreen` or a background-page DOM to hold the §6 sandboxed
iframe, and there is neither under `node --test`. This extension is that proof, run by a
human in a real browser — it is the thing Task #6 ("run all tests") cannot cover by itself.

## Setup

```sh
cd integrations/anon-rpc/probe-extension
./prepare.sh   # copies the harness's packaged offscreen/sandbox assets + background bundle
```

Re-run `./prepare.sh` any time `@anon-rpc/browser-extension-harness` is upgraded — the two
halves (this folder's `background.js` and the copied `offscreen.js`/`sandbox.js`) must come
from the same package version, and nothing on the harness's boot path times out if they
don't; it just hangs.

## Load it

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Click the extension's toolbar icon, then **"Boot nox worker + eth_chainId via anon-rpc"**.
3. First click boots cold: fetches the specifier from Sepolia, fetches and keccak-verifies
   the worker bundle, and boots the Sphinx-mixnet worker — expect several seconds. A second
   click should be fast (same service-worker incarnation reattaches without re-booting; a
   fresh incarnation, e.g. after the ~30s MV3 idle kill, re-attaches to the still-running
   offscreen-document worker rather than rebooting it).

## What success looks like

```
OK in 2840 ms
eth_chainId via nox (anon-rpc) = 11155111
matches Sepolia (11155111): true
```

`11155111` is Sepolia's chain id — confirmation that the answer actually came back through
the worker's own fetch (routed via a Sphinx mixnet, per `nox`'s own documentation) and not
from this file's `bootstrapRequest` fallback, which is wired to the harness's §4 specifier
read only and is never used for the probed call itself.

## What a failure tells you

- Stuck on "running…" indefinitely: almost always a version mismatch between
  `vendor/anon-rpc-background.js` and `anon-rpc/<version>/{offscreen,sandbox}.js` — re-run
  `./prepare.sh`.
- An explicit error from `popup.js`: the harness surfaced a `signalFailed` reason, or one of
  the bootstrap RPCs in `background.js` is down — the error message names which.

## Scope note

This extension is a disposable smoke test, not a second implementation of
`worker-factory.ts`/`transport.ts` to keep in sync by hand. If this file and the real
package in `../src/` ever disagree, the real package is correct.
