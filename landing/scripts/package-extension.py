"""Package the current built extension without browser profiles or local data."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parents[1]
dist = project.parent / "apps" / "extension" / "dist"
target = project / "public" / "bound-extension.zip"
files = [
    "manifest.json", "alert-icon.png", "hook.js", "relay.js", "warning.html",
    "warning.js", "popup.html", "popup.js", "options.html", "options.mjs",
    "settings.mjs", "offscreen.html", "offscreen.js", "anon-rpc-worker.js",
    "anon-rpc-host.mjs", "observation-queue.mjs", "observation-dispatcher.mjs",
    "watcher-adapter.mjs", "trust-adapter.mjs", "ens-cache.mjs", "network-capture.mjs",
    "frontend-integrity.mjs", "sw.js", "decision-context.mjs", "anon-rpc-bundle.js",
    "trust-bundle.js", "arkiv-bundle.js", "frontend-collector.js",
    "packages/decoder/index.mjs", "packages/policy-core/index.mjs",
    "packages/policy-core/observations.mjs",
]
harness = dist / "anon-rpc"
if not harness.is_dir():
    raise SystemExit("Build the extension first: node apps/extension/build.mjs")
files += [p.relative_to(dist).as_posix() for p in harness.rglob("*") if p.is_file() and not p.is_symlink()]
for name in files:
    if not (dist / name).is_file():
        raise SystemExit(f"Missing extension build file: {name}")
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(dist / name, name)
    archive.writestr("INSTALL.txt", "BOUND prototype: extract this ZIP, open chrome://extensions (or edge://extensions), enable Developer mode, and choose Load unpacked. Select the extracted folder containing manifest.json. This prototype requires configuration and its live integrations have not been fully verified.\n")
print(f"Packaged {len(files)} extension files in {target}")
