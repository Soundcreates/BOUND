import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, assertMonotonicEpoch } from "../src/compiler.ts";
import { createAddress } from "../src/lineage.ts";
import { baseInput } from "./fixtures.ts";

test("buildSnapshot normalizes and sorts addresses, lowercases the host, and dedupes", () => {
  const snapshot = buildSnapshot(
    baseInput({
      sites: [
        {
          host: "Swap.COW.fi",
          chainId: 11155111,
          trustedCounterparties: [
            "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // duplicate, different case would also dedupe
          ],
          evidence: [
            { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", kind: "counterparty", sourceUrl: "https://example.com/a", eoa: true },
            { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", kind: "counterparty", sourceUrl: "https://example.com/b", eoa: true },
          ],
        },
      ],
    }),
  );
  const entry = snapshot.sites["swap.cow.fi"]!["11155111"]!;
  assert.deepEqual(entry.trustedCounterparties, [
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ]);
});

test("buildSnapshot verifies deployer lineage end-to-end via createAddress", () => {
  const deployer = "0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0";
  const deployed = createAddress(deployer as `0x${string}`, 3);
  const snapshot = buildSnapshot(
    baseInput({
      sites: [
        {
          host: "example.com",
          chainId: 1,
          trustedContracts: [deployed],
          deployers: [deployer],
          evidence: [
            { address: deployed, kind: "contract", sourceUrl: "https://example.com/router", codeHash: ("0x" + "11".repeat(32)) as `0x${string}` },
            { address: deployer, kind: "deployer", sourceUrl: "https://example.com/deployer", deployedContract: deployed, createNonce: 3, creationTx: ("0x" + "22".repeat(32)) as `0x${string}` },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(snapshot.sites["example.com"]!["1"]!.deployers, [deployer]);
});

test("buildSnapshot rejects a fabricated deployer lineage (wrong nonce)", () => {
  const deployer = "0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0";
  const realDeployed = createAddress(deployer as `0x${string}`, 3);
  assert.throws(() =>
    buildSnapshot(
      baseInput({
        sites: [
          {
            host: "example.com",
            chainId: 1,
            trustedContracts: [realDeployed],
            deployers: [deployer],
            evidence: [
              { address: realDeployed, kind: "contract", sourceUrl: "https://example.com/router", codeHash: ("0x" + "11".repeat(32)) as `0x${string}` },
              { address: deployer, kind: "deployer", sourceUrl: "https://example.com/deployer", deployedContract: realDeployed, createNonce: 7, creationTx: ("0x" + "22".repeat(32)) as `0x${string}` },
            ],
          },
        ],
      }),
    ),
  );
});

test("buildSnapshot rejects duplicate site-chain entries from curation input", () => {
  assert.throws(() =>
    buildSnapshot(
      baseInput({
        sites: [
          { host: "example.com", chainId: 1, trustedCounterparties: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], evidence: [{ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", kind: "counterparty", sourceUrl: "https://example.com", eoa: true }] },
          { host: "example.com", chainId: 1, trustedCounterparties: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], evidence: [{ address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", kind: "counterparty", sourceUrl: "https://example.com", eoa: true }] },
        ],
      }),
    ),
  );
});

test("assertMonotonicEpoch allows undefined previous epoch and rejects non-increasing epochs", () => {
  assert.doesNotThrow(() => assertMonotonicEpoch(undefined, 1));
  assert.doesNotThrow(() => assertMonotonicEpoch(3, 4));
  assert.throws(() => assertMonotonicEpoch(5, 5));
  assert.throws(() => assertMonotonicEpoch(5, 4));
});
