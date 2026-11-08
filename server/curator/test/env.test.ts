import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCuratorConfig, MissingEnvError } from "../src/env.ts";

const REQUIRED_VARS = [
  "BOUND_SEPOLIA_RPC_URL",
  "BOUND_CURATOR_PRIVATE_KEY",
  "BOUND_ROOT_NAME",
  "BOUND_RESOLVER_ADDRESS",
  "BOUND_SWARM_GATEWAYS",
] as const;

const VALID_ENV: Record<string, string> = {
  BOUND_SEPOLIA_RPC_URL: "https://sepolia.example/rpc",
  BOUND_CURATOR_PRIVATE_KEY: "0x" + "ab".repeat(32),
  BOUND_ROOT_NAME: "bound-demo.eth",
  BOUND_RESOLVER_ADDRESS: "0x" + "ef".repeat(20),
  BOUND_SWARM_GATEWAYS: "https://gw1.example,https://gw2.example",
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(overrides)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("loadCuratorConfig succeeds with a fully valid environment", () => {
  const config = withEnv(VALID_ENV, () => loadCuratorConfig());
  assert.equal(config.rpcUrl, VALID_ENV.BOUND_SEPOLIA_RPC_URL);
  assert.equal(config.ens.rootName, "bound-demo.eth");
  assert.equal(config.gatewayUrls.length, 2);
  assert.equal(config.curatorAccount.address.startsWith("0x"), true);
});

for (const missing of REQUIRED_VARS) {
  test(`loadCuratorConfig throws MissingEnvError when ${missing} is unset`, () => {
    assert.throws(
      () => withEnv({ ...VALID_ENV, [missing]: undefined }, () => loadCuratorConfig()),
      MissingEnvError,
    );
  });
}

test("loadCuratorConfig rejects a malformed private key", () => {
  assert.throws(
    () => withEnv({ ...VALID_ENV, BOUND_CURATOR_PRIVATE_KEY: "not-a-key" }, () => loadCuratorConfig()),
    TypeError,
  );
});

test("loadCuratorConfig rejects fewer than 2 gateway URLs", () => {
  assert.throws(
    () => withEnv({ ...VALID_ENV, BOUND_SWARM_GATEWAYS: "https://only-one.example" }, () => loadCuratorConfig()),
    TypeError,
  );
});

test("loadCuratorConfig trims and drops empty entries from the gateway list", () => {
  const config = withEnv(
    { ...VALID_ENV, BOUND_SWARM_GATEWAYS: " https://gw1.example , https://gw2.example ,, https://gw3.example " },
    () => loadCuratorConfig(),
  );
  assert.deepEqual(config.gatewayUrls, ["https://gw1.example", "https://gw2.example", "https://gw3.example"]);
});

// BOUND_RESOLVER_ADDRESS is covered by the REQUIRED_VARS loop above. It is deliberately
// required: the old default was ENS's shared PermissionedResolver implementation, which
// holds none of this deployment's grants and reverts MissingRole on every write.

test("no Bee vars means the upload goes unstamped to a public gateway", () => {
  const config = withEnv(
    { ...VALID_ENV, BOUND_BEE_API_URL: undefined, BOUND_POSTAGE_BATCH_ID: undefined },
    () => loadCuratorConfig(),
  );
  assert.equal(config.swarmUpload.mode, "gateway");
  // Defaults to the first read gateway so the common free path needs no extra var.
  assert.equal(config.swarmUpload.apiUrl, "https://gw1.example");
});

test("BOUND_SWARM_UPLOAD_URL overrides the gateway upload host", () => {
  const config = withEnv(
    {
      ...VALID_ENV,
      BOUND_BEE_API_URL: undefined,
      BOUND_POSTAGE_BATCH_ID: undefined,
      BOUND_SWARM_UPLOAD_URL: "https://upload.example",
    },
    () => loadCuratorConfig(),
  );
  assert.equal(config.swarmUpload.mode, "gateway");
  assert.equal(config.swarmUpload.apiUrl, "https://upload.example");
});

test("both Bee vars set means the upload goes through our own node and batch", () => {
  const batchId = "cd".repeat(32);
  const config = withEnv(
    { ...VALID_ENV, BOUND_BEE_API_URL: "http://localhost:1633", BOUND_POSTAGE_BATCH_ID: batchId },
    () => loadCuratorConfig(),
  );
  assert.equal(config.swarmUpload.mode, "bee");
  assert.deepEqual(config.swarmUpload, { mode: "bee", apiUrl: "http://localhost:1633", batchId });
});

for (const [set, unset] of [
  ["BOUND_BEE_API_URL", "BOUND_POSTAGE_BATCH_ID"],
  ["BOUND_POSTAGE_BATCH_ID", "BOUND_BEE_API_URL"],
] as const) {
  test(`loadCuratorConfig refuses ${set} without ${unset}`, () => {
    assert.throws(
      () =>
        withEnv(
          { ...VALID_ENV, [set]: set === "BOUND_BEE_API_URL" ? "http://localhost:1633" : "cd".repeat(32), [unset]: undefined },
          () => loadCuratorConfig(),
        ),
      TypeError,
    );
  });
}
