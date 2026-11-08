// Verifies that every static relative import reachable from the extension's
// entry points resolves inside the built dist directory. Unit tests import
// sources from the repo layout, so a module that is copied into dist without
// rewriting a "../../shared/..." import passes tests but kills the worker.
// Usage: node client/extension/build.mjs && node client/extension/check-dist-imports.mjs
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const entries = ["sw.js", "warning.js", "popup.js", "options.mjs", "offscreen.js", "confirm.mjs", "ticket-store.mjs"];
const pattern = /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^\s*import\s*['"](\.[^'"]+)['"]/gm;
const seen = new Set(), unresolved = [];

async function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] || match[2] || match[3];
    const target = path.resolve(path.dirname(file), specifier);
    if (!target.startsWith(dist + path.sep)) { unresolved.push(`${path.relative(dist, file)} -> ${specifier} (escapes dist)`); continue; }
    try { await access(target); } catch { unresolved.push(`${path.relative(dist, file)} -> ${specifier}`); continue; }
    await walk(target);
  }
}

for (const entry of entries) {
  const file = path.join(dist, entry);
  try { await access(file); } catch { continue; }
  await walk(file);
}
if (unresolved.length) {
  console.error(`Unresolved imports in dist:\n  ${unresolved.join("\n  ")}`);
  process.exitCode = 1;
} else console.log(`dist imports OK: ${seen.size} modules reachable`);
