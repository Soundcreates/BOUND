import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCuratorConfig, MissingEnvError } from "../src/env.ts";

const REQUIRED_VARS = [
  "BOUND_SEPOLIA_RPC_URL",
  "BOUND_CURATOR_PRIVATE_KEY",
  "BOUND_ROOT_NAME",
  "BOUND_BEE_API_URL",
  "BOUND_POSTAGE_BATCH_ID",
  "BOUND_SWARM_GATEWAYS",
] as const;

const VALID_ENV: Record<string, string> = {
  BOUND_SEPOLIA_RPC_URL: "https://sepolia.example/rpc",
  BOUND_CURATOR_PRIVATE_KEY: "0x" + "ab".repeat(32),
  BOUND_ROOT_NAME: "bound-demo.eth",
  BOUND_BEE_API_URL: "http://localhost:1633",
  BOUND_POSTAGE_BATCH_ID: "cd".repeat(32),
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

test("loadCuratorConfig defaults the resolver address when BOUND_RESOLVER_ADDRESS is unset", () => {
  const config = withEnv({ ...VALID_ENV, BOUND_RESOLVER_ADDRESS: undefined }, () => loadCuratorConfig());
  assert.match(config.ens.resolverAddress, /^0x[0-9a-fA-F]{40}$/);
});
