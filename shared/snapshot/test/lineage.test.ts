import { test } from "node:test";
import assert from "node:assert/strict";
import { createAddress, findCreateNonce } from "../src/lineage.ts";

// Cross-checked against viem's getContractAddress({ from, nonce }) at nonces spanning the
// RLP single-byte / length-prefix boundaries (0, 1, 5, 127, 128, 255, 256); see the
// scratch verification run in the Dev 2 build notes. Pinned here so this file alone is a
// deterministic regression guard without needing viem as a runtime dependency.
const SENDER = "0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0" as `0x${string}`;
const VECTORS: Array<[number, `0x${string}`]> = [
  [0, "0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d"],
  [1, "0x343c43a37d37dff08ae8c4a11544c718abb4fcf8"],
  [5, "0x905220c078ae67efb40f16417aab7244db48f2fe"],
  [127, "0x06d9a77f5e4b311bae8d559db9cdb4df94104aa0"],
  [128, "0x08e190dcb7b73f5fcdabb43e102215c83659a76d"],
  [255, "0x3ef7c1a519e4b4431e317d7839340e3139b03c65"],
  [256, "0x3837c1ae70354f670550c746580199ac6a73cb0a"],
];

test("createAddress matches viem's getContractAddress across RLP length boundaries", () => {
  for (const [nonce, expected] of VECTORS) {
    assert.equal(createAddress(SENDER, nonce), expected, `nonce ${nonce}`);
  }
});

test("createAddress changes with nonce", () => {
  assert.notEqual(createAddress(SENDER, 0), createAddress(SENDER, 1));
});

test("findCreateNonce finds a match within bound, searching newest-first", () => {
  const target = createAddress(SENDER, 5);
  const result = findCreateNonce(SENDER, target, 10n);
  assert.deepEqual(result, { found: true, nonce: 5 });
});

test("findCreateNonce reports bound-exceeded rather than silently trusting", () => {
  const target = createAddress(SENDER, 50_000); // outside the search window below
  const result = findCreateNonce(SENDER, target, 60_000n, 100);
  assert.equal(result.found, false);
  if (!result.found) assert.equal(result.reason, "bound-exceeded");
});

test("findCreateNonce reports not-found for an unrelated address", () => {
  const unrelated = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  const result = findCreateNonce(SENDER, unrelated, 10n);
  assert.equal(result.found, false);
  if (!result.found) assert.equal(result.reason, "not-found");
});

test("createAddress rejects a non-20-byte sender", () => {
  assert.throws(() => createAddress("0x1234" as `0x${string}`, 0));
});
