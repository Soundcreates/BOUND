import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { scoreConfigFromEnv } from "./score-config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "dist");
try { process.loadEnvFile(path.join(root, '..', '..', '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const scoreConfig = scoreConfigFromEnv(process.env);
await mkdir(output, { recursive: true });
await cp(path.join(root, "fonts"), path.join(output, "fonts"), { recursive: true });
await writeFile(path.join(output, 'score-settings.mjs'), `// Generated from validated build environment; no secrets are included.\nexport const SCORE_SETTINGS = ${JSON.stringify(scoreConfig)};\n`);
await copyFile(path.join(root, "connection-score.mjs"), path.join(output, "connection-score.mjs"));
for (const file of ["BOUND.jpeg", "ui.css", "manifest.json", "alert-icon.png", "hook.js", "relay.js", "warning.html", "warning.js", "popup.html", "popup.js", "options.html", "options.mjs", "settings.mjs", "offscreen.html", "offscreen.js", "anon-rpc-worker.js", "observation-queue.mjs", "observation-dispatcher.mjs", "watcher-adapter.mjs", "ens-cache.mjs", "network-capture.mjs", "frontend-integrity.mjs"]) {
  await copyFile(path.join(root, file), path.join(output, file));
}
for (const [file, replacements] of [
  ['anon-rpc-host.mjs', [['./anon-rpc-engine.mjs', './anon-rpc-bundle.js']]],
  ['trust-adapter.mjs', [['./trust-engine.mjs', './trust-bundle.js'], ['./arkiv-reader.mjs', './arkiv-bundle.js']]]
]) {
  let source = await readFile(path.join(root, file), 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  await writeFile(path.join(output, file), source);
}
for (const [pkg, files] of [["decoder", ["index.mjs"]], ["policy-core", ["index.mjs", "observations.mjs"]]]) {
  const destination = path.join(output, "packages", pkg);
  await mkdir(destination, { recursive: true });
  for (const file of files) await copyFile(path.join(root, "..", "..", "packages", pkg, file), path.join(destination, file));
}
for (const file of ["sw.js", "decision-context.mjs"]) {
  const source = await readFile(path.join(root, file), "utf8");
  await writeFile(path.join(output, file), source.replaceAll('"../../packages/', '"./packages/'));
}
await build({entryPoints:[path.join(root,"anon-rpc-engine.mjs")],outfile:path.join(output,"anon-rpc-bundle.js"),bundle:true,format:"esm",platform:"browser",target:"chrome116"});
await build({entryPoints:[path.join(root,"trust-engine.mjs")],outfile:path.join(output,"trust-bundle.js"),bundle:true,format:"esm",platform:"browser",target:"chrome116"});
await build({entryPoints:[path.join(root,"arkiv-reader.mjs")],outfile:path.join(output,"arkiv-bundle.js"),bundle:true,format:"esm",platform:"browser",target:"chrome116"});
await build({entryPoints:[path.join(root,"frontend-collector.mjs")],outfile:path.join(output,"frontend-collector.js"),bundle:true,format:"iife",platform:"browser",target:"chrome116"});
const require=createRequire(import.meta.url);
const harness=path.dirname(require.resolve("@anon-rpc/browser-extension-harness/package.json"));
await cp(path.join(harness,"dist/static/anon-rpc"),path.join(output,"anon-rpc"),{recursive:true});
console.log(`Extension built at ${output}`);
