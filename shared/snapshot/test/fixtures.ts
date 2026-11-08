import { buildSnapshot, type CompileInput } from "../src/compiler.ts";
import type { Evidence } from "../src/schema.ts";

export const CURATOR_SITE = "swap.cow.fi";
export const CURATOR_RELAYER = "0x9008d19f58aabd9ed0d60971565aa8510560ab41".toLowerCase() as `0x${string}`;
export const ATTACKER = ("0x" + "0".repeat(32) + "deadbeef") as `0x${string}`; // 42 chars, 20 bytes

const relayerEvidence: Evidence = {
  address: CURATOR_RELAYER,
  kind: "counterparty",
  sourceUrl: "https://docs.cow.fi/governance/contracts",
  codeHash: "0x".concat("ab".repeat(32)) as `0x${string}`,
};

export function baseInput(overrides: Partial<CompileInput> = {}): CompileInput {
  return {
    epoch: 1,
    network: "sepolia",
    rootName: "bound-demo.eth",
    generatedAt: new Date("2026-11-08T10:00:00.000Z"),
    validityDays: 7,
    sites: [
      {
        host: CURATOR_SITE,
        chainId: 11155111,
        trustedCounterparties: [CURATOR_RELAYER],
        evidence: [relayerEvidence],
      },
    ],
    shared: [],
    ...overrides,
  };
}

export function baseSnapshot() {
  return buildSnapshot(baseInput());
}
