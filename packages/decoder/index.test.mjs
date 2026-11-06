import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, cloneRequest } from "./index.mjs";

const addr = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const word = (n) => n.toString(16).padStart(64, "0");
const addressWord = (value) => value.slice(2).padStart(64, "0");
const tx = (selector, ...words) => ({ to: addr(1), data: `0x${selector}${words.join("")}` });

test("MetaMask provider state is read only; unknown wallet methods remain unsupported", () => {
  assert.equal(classifyRequest({ method: "metamask_getProviderState" }).kind, "read_only");
  assert.equal(classifyRequest({ method: "metamask_unknownMethod" }).kind, "unsupported");
});

test("approve and increaseAllowance identify a rights-role spender", () => {
  for (const selector of ["095ea7b3", "39509351"]) {
    const result = classifyRequest({ method: "eth_sendTransaction", params: [tx(selector, word(2), word(1))] });
    assert.deepEqual(result.entries.at(-1), { address: addr(2), role: "rights" });
  }
});

test("ERC-20/NFT transfers identify destinations and operators", () => {
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("a9059cbb", word(3), word(5))] }).entries.at(-1).role, "destination");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("23b872dd", word(4), word(3), word(5))] }).entries.at(-1).address, addr(3));
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("23b872dd", word(4), word(3), word(5))] }).entries.some(entry => entry.address === addr(4)), false);
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("a22cb465", word(2), word(1))] }).entries.at(-1).role, "rights");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("42842e0e", word(4), word(3), word(5))] }).entries.at(-1).role, "destination");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("42842e0e", word(4), word(3), word(5))] }).entries.some(entry => entry.address === addr(4)), false);
  for (const selector of ["a9059cbb", "a22cb465", "42842e0e"]) {
    const args = selector === "42842e0e" ? [word(1), word(1), word(1)] : [word(1), word(1)];
    const result = classifyRequest({ method: "eth_sendTransaction", params: [tx(selector, ...args)] });
    assert.equal(result.entries.some(entry => entry.role === "token" && entry.address === addr(1)), true);
  }
});

test("known truncated selector is malformed and opaque calldata is capped", () => {
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("095ea7b3")] }).kind, "malformed");
  const result = classifyRequest({ method: "eth_sendTransaction", params: [tx("deadbeef", addressWord(addr(0x1123456789abcdef0n)))] });
  assert.equal(result.kind, "opaque");
  assert.equal(result.cap, 65);
  assert.equal(result.entries.some((entry) => entry.address === addr(0x1123456789abcdef0n) && entry.verified === false), true);
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data: "0x1234" }] }).kind, "opaque");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data: "" }] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data: "0x", input: "0x1234" }] }).kind, "malformed");
});

test("typed Permit, Permit2 transfer, personal_sign, eth_sign and unsupported methods", () => {
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(4), { primaryType: "Permit", message: { spender: addr(5) } }] }).entries.some((entry) => entry.address === addr(5) && entry.role === "rights"), true);
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

test("known calls require complete ABI words and valid address padding", () => {
  for (const [selector, count] of [["095ea7b3", 2], ["39509351", 2], ["a9059cbb", 2], ["23b872dd", 3], ["a22cb465", 2], ["42842e0e", 3], ["87517c45", 4]]) {
    for (let length = 0; length < count; length++) {
      assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx(selector, ...Array(length).fill(word(1)))] }).kind, "malformed", `${selector}: ${length} words`);
    }
  }
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("095ea7b3", `1${"0".repeat(63)}`, word(1))] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("b88d4fde", word(1), word(2), word(3), word(128))] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("a22cb465", word(1), word(2))] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [tx("095ea7b3", word(1), word(2), word(3))] }).kind, "malformed");
  const safeData = (bytes) => ({ to: addr(1), data: `0xb88d4fde${word(1)}${word(2)}${word(3)}${word(128)}${word(bytes.length / 2)}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")}` });
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [safeData("abcd")] }).kind, "decoded");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ ...safeData("abcd"), data: `${safeData("abcd").data}00` }] }).kind, "malformed");
});

test("every byte truncation of a known approval stays malformed", () => {
  const full = `095ea7b3${word(2)}${word(9)}`;
  for (let bytes = 4; bytes < full.length / 2; bytes++) {
    const data = `0x${full.slice(0, bytes * 2)}`;
    assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data }] }).kind, "malformed", `${bytes} bytes`);
  }
});

test("Permit2 approval and typed permit identify token and spender", () => {
  const approval = classifyRequest({ method: "eth_sendTransaction", params: [tx("87517c45", word(7), word(8), word(9), word(10))] });
  assert.equal(approval.entries.some(entry => entry.role === "token" && entry.address === addr(7)), true);
  assert.equal(approval.entries.some(entry => entry.role === "rights" && entry.address === addr(8)), true);
  assert.deepEqual(approval.approvals, [{ token: addr(7), spender: addr(8) }]);
  const single = classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), { primaryType: "PermitSingle", message: { details: { token: addr(7) }, spender: addr(8) } }] });
  assert.equal(single.entries.some(entry => entry.role === "token" && entry.address === addr(7)), true);
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), { primaryType: "PermitUnknown", message: {} }] }).kind, "opaque");
  const extraPermit = classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), { primaryType: "Permit", message: { spender: addr(8), extra: addr(9) } }] });
  assert.equal(extraPermit.cap, 65);
  assert.equal(extraPermit.kind, "opaque");
  assert.equal(extraPermit.entries.some(entry => entry.address === addr(9) && entry.verified === false), true);
  assert.equal(classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), { primaryType: "PermitSingle", message: { details: { token: addr(7), extra: addr(9) }, spender: addr(8) } }] }).cap, 65);
  for (const primaryType of ["PermitTransferFrom", "PermitBatchWitnessTransferFrom"]) {
    const transfer = classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), { primaryType, message: { permitted: [{ token: addr(7) }, { token: addr(9) }], spender: addr(8) } }] });
    assert.equal(transfer.cap, 65);
    assert.match(transfer.label, /Destination not fixed/);
    assert.equal(transfer.entries.some(entry => entry.role === "token" && entry.address === addr(7)), true);
    assert.equal(transfer.entries.some(entry => entry.role === "token" && entry.address === addr(9)), true);
    assert.equal(transfer.entries.some(entry => entry.role === "rights" && entry.address === addr(8)), true);
  }
});

test("approval pairs stay attached to the call that grants them", () => {
  const first = { to: addr(10), data: `0x095ea7b3${word(11)}${word(1)}` };
  const second = { to: addr(20), data: `0xa22cb465${word(21)}${word(1)}` };
  const unrelated = { to: addr(30), value: "1", authorizationList: [{ address: addr(31), chainId: "0x1" }] };
  const batch = classifyRequest({ method: "wallet_sendCalls", params: [{ calls: [first, second, unrelated] }] });
  assert.deepEqual(batch.approvals, [{ token: addr(10), spender: addr(11) }, { token: addr(20), spender: addr(21) }]);
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [unrelated] }).approvals, undefined);
});

test("typed permit schemas and required values must match before removing the opaque cap", () => {
  const fields = [["owner", "address"], ["spender", "address"], ["value", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]].map(([name, type]) => ({ name, type }));
  const permit = { primaryType: "Permit", types: { Permit: fields }, domain: { verifyingContract: addr(7) }, message: { owner: addr(1), spender: addr(2), value: "10", nonce: "0", deadline: "999" } };
  const classify = payload => classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), payload] });
  assert.equal(classify(permit).cap, 100);
  assert.deepEqual(classify(permit).approvals, [{ token: addr(7), spender: addr(2) }]);
  const forgedToken = classify({ ...permit, message: { ...permit.message, token: addr(9) } });
  assert.equal(forgedToken.cap, 65);
  assert.equal(forgedToken.approvals, undefined);
  assert.equal(forgedToken.entries.some(entry => entry.role === "token" && entry.address === addr(7)), true);
  assert.equal(classify(permit).entries.some(entry => entry.address === addr(1)), false);
  assert.equal(classify({ ...permit, types: { Permit: fields.map(field => field.name === "spender" ? { ...field, type: "bytes32" } : field) } }).cap, 65);
  assert.equal(classify({ ...permit, message: { ...permit.message, value: 10 } }).cap, 65);
  assert.equal(classify({ ...permit, message: { ...permit.message, value: (1n << 256n).toString() } }).cap, 65);
  const single = { primaryType: "PermitSingle", types: {
    PermitSingle: [["details", "PermitDetails"], ["spender", "address"], ["sigDeadline", "uint256"]].map(([name, type]) => ({ name, type })),
    PermitDetails: [["token", "address"], ["amount", "uint160"], ["expiration", "uint48"], ["nonce", "uint48"]].map(([name, type]) => ({ name, type }))
  }, message: { details: { token: addr(7), amount: "1", expiration: "10", nonce: "0" }, spender: addr(8), sigDeadline: "20" } };
  assert.equal(classify(single).cap, 100);
  assert.equal(classify({ ...single, message: { ...single.message, details: { token: addr(7) } } }).cap, 65);
  assert.equal(classify({ ...single, message: { ...single.message, details: { ...single.message.details, expiration: 10 } } }).cap, 100);
});

test("Seaport consideration decodes recipients and validates nested schemas", () => {
  const schema = list => list.map(([name, type]) => ({ name, type }));
  const offerFields = [["itemType", "uint8"], ["token", "address"], ["identifierOrCriteria", "uint256"], ["startAmount", "uint256"], ["endAmount", "uint256"]];
  const orderFields = [["offerer", "address"], ["zone", "address"], ["offer", "OfferItem[]"], ["consideration", "ConsiderationItem[]"], ["orderType", "uint8"], ["startTime", "uint256"], ["endTime", "uint256"], ["zoneHash", "bytes32"], ["salt", "uint256"], ["conduitKey", "bytes32"], ["counter", "uint256"]];
  const item = { itemType: "1", token: addr(7), identifierOrCriteria: "0", startAmount: "1", endAmount: "1" };
  const order = { primaryType: "OrderComponents", types: { OrderComponents: schema(orderFields), OfferItem: schema(offerFields), ConsiderationItem: schema([...offerFields, ["recipient", "address"]]) }, domain: { verifyingContract: addr(9) }, message: { offerer: addr(1), zone: addr(2), offer: [item], consideration: [{ ...item, recipient: addr(8) }], orderType: "0", startTime: "1", endTime: "2", zoneHash: `0x${"0".repeat(64)}`, salt: "1", conduitKey: `0x${"0".repeat(64)}`, counter: "0" } };
  const classify = payload => classifyRequest({ method: "eth_signTypedData_v4", params: [addr(1), payload] });
  const result = classify(order);
  assert.equal(result.cap, 100);
  assert.equal(result.entries.some(entry => entry.role === "destination" && entry.address === addr(8)), true);
  assert.equal(result.entries.some(entry => entry.role === "token" && entry.address === addr(7)), true);
  assert.equal(classify({ ...order, message: { ...order.message, consideration: [{ ...item, recipient: addr(8), unknown: addr(3) }] } }).cap, 65);
});

test("batch preserves a decoded authorization cap and rejects invalid authorizations", () => {
  const call = { to: addr(1), authorizationList: [{ address: addr(5), chainId: "0x0" }] };
  assert.equal(classifyRequest({ method: "wallet_sendCalls", params: [{ calls: [call] }] }).cap, 0);
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), authorizationList: [null] }] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_signAuthorization", params: [{}] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_signAuthorization", params: [{ address: addr(5), chainId: "bad" }] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_signAuthorization", params: [{ address: addr(5), chainId: (1n << 256n).toString() }] }).kind, "malformed");
  assert.equal(classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), authorizationList: [{ address: addr(5) }] }] }).kind, "malformed");
});

test("request clone rejects accessors, cycles, deep and oversized data", () => {
  assert.throws(() => cloneRequest({ get method() { return "eth_sign"; } }), /Accessors/);
  assert.equal(classifyRequest({ get method() { throw new Error("hostile getter"); } }).kind, "malformed");
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
