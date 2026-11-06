/**
 * probe-swarm-gateway — can we store and retrieve a snapshot on Swarm with no node,
 * no postage batch, and no xBZZ/xDAI?
 *
 * The public API gateway stamps uploads with its own batch when you send no stamp
 * headers, which removes the node and the tokens from the critical path. This probe
 * proves whether that actually holds for a payload the size of ours, and pins down
 * the two ways a reader can be fooled into thinking it worked:
 *
 *   - gateway.ethswarm.org (the WEB host) answers 200 with a small HTML shell for any
 *     address, including one that was never uploaded. A retrieval that failed is
 *     indistinguishable from one that succeeded unless you compare bytes.
 *   - /bzz/<ref> resolves manifests, not raw uploads. A /bytes upload read back through
 *     /bzz 404s even though the data is there.
 *
 * Independence note: bzz.link, api.gateway.ethswarm.org and download.gateway.ethswarm.org
 * are all operated by ethswarm.org and are blocked and unblocked together, so reading
 * from two of them is not two independent reads. The probe reports them separately so
 * the evidence log can say exactly what was and was not shown.
 *
 *   node --experimental-strip-types services/curator/probe/probe-swarm-gateway.ts [bytes]
 */
import { createHash, randomBytes } from "node:crypto";
import { uploadAndSelfVerify, fetchFromGateways } from "@bound/integrations-swarm";
import { isCanonicalSwarmRef } from "@bound/snapshot";

const API = "https://api.gateway.ethswarm.org";
const WEB = "https://gateway.ethswarm.org";
const DOWNLOAD = "https://download.gateway.ethswarm.org";

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function line(label: string, detail: string): void {
  process.stdout.write(`  ${label.padEnd(26)} ${detail}\n`);
}

async function tryGet(url: string): Promise<{ status: number; bytes?: Uint8Array; err?: string }> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes: buf };
  } catch (e) {
    return { status: 0, err: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  const size = Number(process.argv[2] ?? 3384); // default: our 5-protocol seed size
  const payload = randomBytes(size);
  const want = sha256(payload);

  process.stdout.write(`payload: ${size} bytes, sha256 ${want}\n\n`);

  // 1. upload with NO stamp headers — the subsidised path
  process.stdout.write("1. POST /bytes with no stamp headers (subsidised upload)\n");
  const upRes = await fetch(`${API}/bytes`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: payload,
  });
  const upText = await upRes.text();
  line("status", String(upRes.status));
  if (!upRes.ok) {
    line("body", upText.slice(0, 300));
    process.stderr.write("\nupload refused — the subsidised path is not available\n");
    process.exit(1);
  }
  let reference: string;
  try {
    reference = (JSON.parse(upText) as { reference: string }).reference;
  } catch {
    line("body", upText.slice(0, 300));
    process.stderr.write("\nupload succeeded but the reference could not be parsed\n");
    process.exit(1);
  }
  line("reference", reference);

  // 2. read back from the API gateway — the one that must match byte for byte
  process.stdout.write("\n2. GET /bytes/<ref> on the API gateway\n");
  const back = await tryGet(`${API}/bytes/${reference}`);
  line("status", String(back.status));
  if (back.bytes) {
    const got = sha256(back.bytes);
    line("bytes", String(back.bytes.length));
    line("sha256", got);
    line("ROUND TRIP", got === want && back.bytes.length === size ? "MATCH" : "*** MISMATCH ***");
  } else {
    line("error", back.err ?? "no body");
  }

  // 3. the /bzz trap: manifests only, raw uploads are not here
  process.stdout.write("\n3. GET /bzz/<ref> on the API gateway (expected to fail — manifests only)\n");
  const viaBzz = await tryGet(`${API}/bzz/${reference}`);
  line("status", String(viaBzz.status));
  line("note", viaBzz.status === 200 ? "unexpectedly served" : "as documented: raw uploads live at /bytes");

  // 4. the web-host trap: 200 for anything, including data never uploaded
  process.stdout.write("\n4. Web host gateway.ethswarm.org — does a miss look like a hit?\n");
  const neverUploaded = "0".repeat(64);
  const webReal = await tryGet(`${WEB}/bzz/${reference}`);
  const webFake = await tryGet(`${WEB}/bzz/${neverUploaded}`);
  line("real ref status", `${webReal.status} (${webReal.bytes?.length ?? 0} bytes)`);
  line("all-zeros status", `${webFake.status} (${webFake.bytes?.length ?? 0} bytes)`);
  if (webFake.status === 200) {
    line("VERDICT", "200 for data that was never uploaded — never hash-check against this host");
  }

  // 5. second ethswarm.org-operated host — same operator, reported separately
  process.stdout.write("\n5. download.gateway.ethswarm.org (same operator — not an independent read)\n");
  const dl = await tryGet(`${DOWNLOAD}/bytes/${reference}`);
  line("status", String(dl.status));
  if (dl.bytes && dl.bytes.length > 0) {
    const got = sha256(dl.bytes);
    line("sha256", got);
    line("match", got === want ? "MATCH" : "*** MISMATCH ***");
  }

  // 6. the path that actually ships. Steps 1-5 prove things about the gateway; this proves
  // our own library drives it, which is the only claim the evidence log can make about
  // `publishSnapshot`. `uploadAndSelfVerify` is what publish.ts calls; `fetchFromGateways`
  // is the curator-side mirror of the extension's two-origin read in trust-engine.mjs.
  process.stdout.write("\n6. through @bound/integrations-swarm — the code that actually ships\n");
  const libPayload = randomBytes(size);
  const libWant = sha256(libPayload);
  try {
    const libRef = await uploadAndSelfVerify({ apiUrl: API, stampedByHost: true }, libPayload);
    line("uploadAndSelfVerify", `ok — ${libRef}`);
    // A reference the gateway accepts but our own validator rejects would break every
    // downstream reader, so check the shape against the same guard the root record uses.
    line("canonical ref", isCanonicalSwarmRef(libRef) ? "yes" : "*** NO — would fail root-record validation ***");

    // Two distinct origins, byte-compared, exactly as the extension requires. Same operator,
    // so this demonstrates the mechanism, NOT operator independence. Say so in the log.
    const agreed = await fetchFromGateways(libRef, [API, DOWNLOAD], { minAgree: 2 });
    line("fetchFromGateways", `${agreed.length} bytes from 2 origins`);
    line("TWO-ORIGIN AGREE", sha256(agreed) === libWant ? "MATCH" : "*** MISMATCH ***");
  } catch (e) {
    line("FAILED", e instanceof Error ? e.message : String(e));
    line("meaning", "publishSnapshot and the extension's fetchSnapshot cannot run against these hosts");
  }

  process.stdout.write(
    `\nreference for the evidence log: ${reference}\n` +
      `read it yourself: ${API}/bytes/${reference}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
