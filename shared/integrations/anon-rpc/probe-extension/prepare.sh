#!/usr/bin/env bash
# Copies the harness's packaged, version-stamped assets into this extension.
#
# Per @anon-rpc/browser-extension-harness's own README: do this from a build script, not
# once by hand. The path is version-stamped specifically so that upgrading the npm package
# without re-running this copy becomes a MISSING file (background.js looks for a path that
# no longer exists) rather than a SILENTLY MISMATCHED one (an old offscreen/sandbox bundle
# paired with a new background.js that expects a different wire protocol) — the harness's
# boot path has no timeout on that mismatch, so it would otherwise hang forever with no error.
set -euo pipefail

cd "$(dirname "$0")"

# Resolved via Node rather than a hardcoded relative path: npm workspaces hoist this
# package to the repo root's node_modules, not this package's own, and where exactly
# that root sits is not this script's business to assume.
PKG_DIR="$(node -e 'console.log(require("path").dirname(require.resolve("@anon-rpc/browser-extension-harness/package.json")))' 2>/dev/null)"

if [ -z "$PKG_DIR" ] || [ ! -d "$PKG_DIR/dist" ]; then
  echo "error: could not resolve @anon-rpc/browser-extension-harness/dist — run 'npm install' at the repo root first" >&2
  exit 1
fi

rm -rf vendor anon-rpc
mkdir -p vendor

cp "$PKG_DIR/dist/background.js" vendor/anon-rpc-background.js
cp "$PKG_DIR/dist/background.js.map" vendor/anon-rpc-background.js.map 2>/dev/null || true
cp -r "$PKG_DIR/dist/static/anon-rpc" anon-rpc

echo "copied $(ls anon-rpc) into ./anon-rpc and background.js into ./vendor"
