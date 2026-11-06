import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
for (const file of ["manifest.json", "hook.js", "relay.js", "warning.html", "warning.js", "popup.html", "popup.js", "options.html", "options.mjs", "settings.mjs", "offscreen.html", "offscreen.js", "anon-rpc-worker.js", "anon-rpc-host.mjs", "observation-queue.mjs", "observation-dispatcher.mjs", "watcher-adapter.mjs", "trust-adapter.mjs"]) {
  await copyFile(path.join(root, file), path.join(output, file));
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
const require=createRequire(import.meta.url);
const harness=path.dirname(require.resolve("@anon-rpc/browser-extension-harness/package.json"));
await cp(path.join(harness,"dist/static/anon-rpc"),path.join(output,"anon-rpc"),{recursive:true});
console.log(`Extension built at ${output}`);
