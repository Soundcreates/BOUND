import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, cloneRequest } from "./index.mjs";

const addr = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const word = (n) => n.toString(16).padStart(64, "0");
const addressWord = (value) => value.slice(2).padStart(64, "0");
const tx = (selector, ...words) => ({ to: addr(1), data: `0x${selector}${words.join("")}` });

test("approve and increaseAllowance identify a rights-role spender", () => {
  for (const selector of ["095ea7b3", "39509351"]) {
    const result = classifyRequest({ method: "eth_sendTransaction", params: [tx(selector, word(2), word(1))] });
    assert.deepEqual(result.entries.at(-1), { address: addr(2), role: "rights" });
  }
});

test("ERC-20/NFT transfers identify destinations and operators", () => {
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("a9059cbb", word(3), word(5))] }).entries.at(-1).role, "destination");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("23b872dd", word(4), word(3), word(5))] }).entries.at(-1).address, addr(3));
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("a22cb465", word(2), word(1))] }).entries.at(-1).role, "rights");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("42842e0e", word(4), word(3), word(5))] }).entries.at(-1).role, "destination");
});

test("known truncated selector is malformed and opaque calldata is capped", () => {
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("095ea7b3")] }).kind, "malformed");
  const result = classifyRequest({ method: "eth_sendTransaction", params: [tx("deadbeef", addressWord(addr(0x1123456789abcdef0n)))] });
  assert.equal(result.kind, "opaque");
  assert.equal(result.cap, 100);
  assert.equal(result.entries.some((entry) => entry.address === addr(0x1123456789abcdef0n) && entry.verified === false), true);
});

test("typed Permit, Permit2 transfer, personal_sign, eth_sign and unsupported methods", () => {
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "Permit", message: { spender: addr(5) } }] }).entries.at(-1).role, "rights");
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "PermitSingle", message: { details: { token: addr(7) }, spender: addr(8) } }] }).entries.some((entry) => entry.role === "rights"), true);
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "Permit2SignatureTransfer", message: { to: addr(6) } }] }).cap, 65);
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "PermitWitnessTransferFrom", message: { to: addr(6) } }] }).cap, 65);
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "OrderComponents", message: { consideration: [{ recipient: addr(9) }] } }] }).entries.some((entry) => entry.address === addr(9) && entry.role === "destination"), true);
  const personal = classifyRequest({ method: "personal_sign", params: ["0x", addr(4)] });
  assert.equal(personal.entries.length, 0);
  assert.equal(personal.cap, 65);
  assert.equal(classifyRequest({ method: "eth_sign", params: [addr(4), "0x00"] }).kind, "escalated");
  assert.equal(classifyRequest({ method: "wallet_addEthereumChain", params: [] }).kind, "unsupported");
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "Unknown", message: { futureField: "0x000000000000000000000000000000000000000a" } }] }).cap, 65);
});

test("native transfers and EIP-7702 authorization addresses have explicit roles", () => {
  const native = classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(2), value: "0x1" }] });
  assert.equal(native.entries.some((entry) => entry.role === "destination"), true);
  const zeroChain = classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data: "0x", authorizationList: [{ address: addr(5), chainId: "0x0" }] }] });
  assert.equal(zeroChain.entries.some((entry) => entry.role === "rights" && entry.address === addr(5)), true);
  assert.equal(zeroChain.cap, 0);
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(2), value: 1_000_000_000_000_000_000 }] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_signAuthorization", params: [{ address: addr(6), chainId: "0x0" }] }).cap, 0);
});

test("batches keep the strictest item classification", () => {
  const result = classifyRequest({ method: "wallet_sendCalls", params: [{ calls: [tx("095ea7b3", word(2), word(1)), tx("deadbeef", addressWord(addr(0x1123456789abcdef0n)))] }] });
  assert.equal(result.kind, "opaque");
  assert.equal(result.entries.some((entry) => entry.verified === false), true);
});

test("request clone rejects accessors, cycles, deep and oversized data", () => {
  assert.throws(() => cloneRequest({ get method() { return "eth_sign"; } }), /Accessors/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => cloneRequest(cycle), /plain data/);
  assert.throws(() => cloneRequest({ data: "x".repeat(100) }, { maxBytes: 20 }), /too large/);
  assert.equal(Object.isFrozen(cloneRequest({ method: "eth_chainId" })), true);
});

test("mutating the page request after cloning cannot change the frozen bytes", () => {
  const original = { method: "eth_sendTransaction", params: [tx("095ea7b3", word(2), word(1))] };
  const frozen = cloneRequest(original);
  const before = JSON.stringify(frozen);
  original.params[0].data = `0x095ea7b3${word(9)}${word(1)}`;
  assert.equal(JSON.stringify(frozen), before);
});

test("clone remains data-only when page code poisons array and object helpers", () => {
  const oldIterator = Array.prototype[Symbol.iterator];
  const oldToJSON = Array.prototype.toJSON;
  const oldObjectToJSON = Object.prototype.toJSON;
  try {
    Array.prototype[Symbol.iterator] = () => { throw new Error("poisoned iterator"); };
    Array.prototype.toJSON = () => { throw new Error("poisoned array serializer"); };
    Object.prototype.toJSON = () => { throw new Error("poisoned object serializer"); };
    const frozen = cloneRequest({ method: "eth_call", params: [{ to: "0x1" }] });
    assert.equal(JSON.stringify(frozen), '{"method":"eth_call","params":[{"to":"0x1"}]}');
  } finally {
    if (oldIterator) Array.prototype[Symbol.iterator] = oldIterator;
    else delete Array.prototype[Symbol.iterator];
    if (oldToJSON) Array.prototype.toJSON = oldToJSON;
    else delete Array.prototype.toJSON;
    if (oldObjectToJSON) Object.prototype.toJSON = oldObjectToJSON;
    else delete Object.prototype.toJSON;
  }
});
