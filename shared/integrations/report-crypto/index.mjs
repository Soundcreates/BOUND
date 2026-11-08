// Observation batches are sealed to the aggregator's public key with HPKE
// (RFC 9180, base mode): DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
// Every primitive is native WebCrypto in current browsers and in Node 22, so the
// extension and the aggregator share this module. The encryption key is a
// dedicated P-256 key, separate from the Arkiv signing key (secp256k1).
import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

export const SUITE_NAME = "hpke-p256-sha256-aes128gcm";
const PROTOCOL = "bound-report-v2";
const PAD = 1024, MAX_CT = 65536, PUBLIC_KEY_BYTES = 65;
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64Url(bytes) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error("invalid base64url");
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  return Uint8Array.from(text, c => c.charCodeAt(0));
}

/** The first 8 bytes of SHA-256 over the raw uncompressed public key, as hex. */
export async function keyId(publicKeyBytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyBytes));
  return [...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Parses and validates a pinned base64url public key; throws unless it is a P-256 point. */
export async function importPublicKey(encoded) {
  const raw = fromBase64Url(encoded);
  if (raw.length !== PUBLIC_KEY_BYTES || raw[0] !== 4) throw new Error("expected an uncompressed P-256 public key");
  const key = await suite.kem.deserializePublicKey(raw);
  return { key, raw, keyId: await keyId(raw) };
}

/** Imports the aggregator's private JWK for opening reports. */
export async function importPrivateKey(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") throw new Error("expected a P-256 private JWK");
  return suite.kem.importKey("jwk", jwk, false);
}

const binding = id => ({ info: encoder.encode(PROTOCOL), aad: encoder.encode(`${PROTOCOL}|${id}`) });

/** Seals a batch object; the plaintext is padded to a 1 KiB multiple so its size reveals little. */
export async function sealReport(publicKey, batch) {
  const json = JSON.stringify(batch);
  const plaintext = encoder.encode(json.padEnd(Math.ceil((json.length + 1) / PAD) * PAD, " "));
  const { info, aad } = binding(publicKey.keyId);
  const { ct, enc } = await suite.seal({ recipientPublicKey: publicKey.key, info }, plaintext, aad);
  if (ct.byteLength > MAX_CT) throw new Error("report batch too large");
  return { schemaVersion: 2, suite: SUITE_NAME, keyId: publicKey.keyId, enc: toBase64Url(enc), ct: toBase64Url(ct) };
}

const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Opens an envelope addressed to this key and returns the decrypted JSON text. */
export async function openReport(privateKey, ownKeyId, envelope) {
  if (!exact(envelope, ["schemaVersion", "suite", "keyId", "enc", "ct"]) || envelope.schemaVersion !== 2 || envelope.suite !== SUITE_NAME) throw new Error("invalid report envelope");
  if (envelope.keyId !== ownKeyId) throw new Error("report sealed to a different key");
  const enc = fromBase64Url(envelope.enc), ct = fromBase64Url(envelope.ct);
  if (enc.length !== PUBLIC_KEY_BYTES || ct.length < 16 || ct.length > MAX_CT) throw new Error("invalid report envelope");
  const { info, aad } = binding(ownKeyId);
  const plaintext = await suite.open({ recipientKey: privateKey, enc, info }, ct, aad);
  return decoder.decode(plaintext);
}
