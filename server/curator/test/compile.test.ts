import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCompileInput, CompileInputError } from "../src/compile.ts";
import { compileSnapshot } from "@bound/snapshot";

async function withTempFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "bound-curator-test-"));
  const file = path.join(dir, "input.json");
  try {
    await writeFile(file, content, "utf8");
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const VALID_INPUT = {
  epoch: 1,
  network: "sepolia",
  rootName: "bound-demo.eth",
  generatedAt: "2026-01-01T00:00:00Z",
  validityDays: 30,
  sites: [
    {
      host: "swap.example",
      chainId: 11155111,
      trustedCounterparties: ["0x" + "11".repeat(20)],
      trustedContracts: [],
      deployers: [],
      evidence: [
        {
          address: "0x" + "11".repeat(20),
          kind: "counterparty",
          sourceUrl: "https://example.org/docs/deployments",
          eoa: true,
          note: "test fixture",
        },
      ],
    },
  ],
  shared: [],
};

test("loadCompileInput parses a well-formed file into a CompileInput with a real Date", async () => {
  await withTempFile(JSON.stringify(VALID_INPUT), async (file) => {
    const input = await loadCompileInput(file);
    assert.equal(input.epoch, 1);
    assert.ok(input.generatedAt instanceof Date);
    assert.equal(input.generatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  });
});

test("loadCompileInput round-trips through compileSnapshot to a digested snapshot", async () => {
  await withTempFile(JSON.stringify(VALID_INPUT), async (file) => {
    const input = await loadCompileInput(file);
    const { snapshot, bytes, digest } = compileSnapshot(input);
    assert.equal(snapshot.epoch, 1);
    assert.match(digest, /^0x[0-9a-f]{64}$/);
    assert.ok(bytes.length > 0);
  });
});

test("loadCompileInput throws CompileInputError for a missing file", async () => {
  await assert.rejects(() => loadCompileInput("/nonexistent/path/input.json"), CompileInputError);
});

test("loadCompileInput throws CompileInputError for invalid JSON", async () => {
  await withTempFile("{not json", async (file) => {
    await assert.rejects(() => loadCompileInput(file), CompileInputError);
  });
});

test("loadCompileInput throws CompileInputError for a missing required field", async () => {
  const { epoch: _epoch, ...withoutEpoch } = VALID_INPUT;
  await withTempFile(JSON.stringify(withoutEpoch), async (file) => {
    await assert.rejects(() => loadCompileInput(file), CompileInputError);
  });
});

test("loadCompileInput throws CompileInputError for a non-positive-integer epoch", async () => {
  await withTempFile(JSON.stringify({ ...VALID_INPUT, epoch: 0 }), async (file) => {
    await assert.rejects(() => loadCompileInput(file), CompileInputError);
  });
});

test("loadCompileInput throws CompileInputError when a site is missing its evidence array", async () => {
  const bad = { ...VALID_INPUT, sites: [{ host: "x.example", chainId: 1 }] };
  await withTempFile(JSON.stringify(bad), async (file) => {
    await assert.rejects(() => loadCompileInput(file), CompileInputError);
  });
});
