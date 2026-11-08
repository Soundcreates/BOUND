import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, namehash, type Address } from "viem";
import { readRootRecord, RootReadError } from "../src/resolver-client.ts";
import { type BoundEnsConfig } from "../src/addresses.ts";
import { canonicalize } from "../../../snapshot/src/index.ts";

const pinned = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const cfg: BoundEnsConfig = { chainId: 11155111, rootName: "bound-demo.eth", resolverAddress: pinned };
const root = { schemaVersion: 1, network: "test", epoch: 1, digest: `0x${"4".repeat(64)}`, swarmRef: "5".repeat(64) };

function client(find: Address, resolved: Address) {
  return { readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "findResolver") return [find, namehash(cfg.rootName), 0n];
    return [encodeAbiParameters([{ type: "string" }], [canonicalize(root)]), resolved];
  } } as never;
}

test("readRootRecord rejects resolve result from a resolver other than the pinned resolver", async () => {
  await assert.rejects(readRootRecord(client(pinned, other), cfg), (error: unknown) =>
    error instanceof RootReadError && /resolve\(\).*expected pinned/.test(error.message));
});

test("readRootRecord accepts valid root data returned by the pinned resolver", async () => {
  assert.deepEqual(await readRootRecord(client(pinned, pinned), cfg), root);
});
