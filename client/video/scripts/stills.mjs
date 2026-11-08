import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const out = process.argv[2];
const frames = process.argv.slice(3).map(Number);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "BoundFilm" });
for (const frame of frames) {
  await renderStill({ serveUrl, composition, frame, output: `${out}/f${String(frame).padStart(4, "0")}.jpg`, imageFormat: "jpeg", scale: 0.5 });
  console.log("frame", frame);
}
