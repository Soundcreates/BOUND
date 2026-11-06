import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
for (const file of ["manifest.json", "hook.js", "relay.js", "warning.html", "warning.js", "popup.html", "popup.js", "offscreen.html", "offscreen.js", "anon-rpc-worker.js", "anon-rpc-host.mjs", "observation-queue.mjs", "observation-dispatcher.mjs", "watcher-adapter.mjs", "trust-adapter.mjs"]) {
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
console.log(`Extension built at ${output}`);
