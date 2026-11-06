let provider;
const result = document.querySelector("#result");

document.querySelector("#connect").addEventListener("click", () => {
  provider = {
    isBoundTestProvider: true,
    async request(payload) {
      if (payload.method === "eth_chainId") return "0xaa36a7";
      if (payload.method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      result.textContent = `Fake wallet received: ${JSON.stringify(payload)}`;
      return "0xmock-transaction-hash";
    },
    send(methodOrPayload, paramsOrCallback, callback) {
      const payload = typeof methodOrPayload === "string" ? { method: methodOrPayload, params: paramsOrCallback } : methodOrPayload;
      const done = typeof callback === "function" ? callback : typeof paramsOrCallback === "function" ? paramsOrCallback : null;
      const finish = (value) => done ? done(null, { jsonrpc: "2.0", id: payload?.id ?? null, result: value }) : value;
      const value = payload?.method === "eth_chainId" ? "0xaa36a7" : payload?.method === "eth_accounts" ? ["0x00000000000000000000000000000000000000a1"] : "0xmock-transaction-hash";
      if (!done) result.textContent = `Fake wallet received: ${JSON.stringify(payload)}`;
      return finish(value);
    },
    sendAsync(payload, callback) {
      const value = payload.method === "eth_chainId" ? "0xaa36a7" : payload.method === "eth_accounts" ? ["0x00000000000000000000000000000000000000a1"] : "0xmock-transaction-hash";
      if (payload.method !== "eth_chainId" && payload.method !== "eth_accounts") result.textContent = `Fake wallet received: ${JSON.stringify(payload)}`;
      callback(null, { jsonrpc: "2.0", id: payload.id ?? null, result: value });
    }
  };
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: {
      info: { uuid: crypto.randomUUID(), name: "BOUND Fake Wallet", icon: "", rdns: "test.bound" },
      provider
    }
  }));
  for (const id of ["request", "send", "sendAsync"]) document.querySelector(`#${id}`).disabled = false;
  result.textContent = "Fake EIP-6963 provider announced. Choose an API path to test.";
});

// Real Sepolia addresses from fixtures/snapshots/demo-seed.compile-input.json (Developer 2's
// curated, source-verified five-protocol seed set). No real signing happens here -- the
// provider above is still the fake EIP-6963 one -- but the decoded target and spender are
// genuine deployed contracts, not placeholder bytes.
const MOCK_USDC = "0x240b0316df57887dbbe58b586508b19e633a14aa"; // Sepolia ENS registrar payment token
const UNISWAP_SWAP_ROUTER02 = "0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e"; // one of the five frozen protocol seeds
const transaction = {
  from: "0x00000000000000000000000000000000000000a1",
  to: MOCK_USDC,
  // approve(UNISWAP_SWAP_ROUTER02, 1_000_000) -- 1 USDC (6 decimals) spending right
  data: "0x095ea7b30000000000000000000000003bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e00000000000000000000000000000000000000000000000000000000000f4240"
};
document.querySelector("#request").addEventListener("click", async () => {
  try {
    const hash = await provider.request({ method: "eth_sendTransaction", params: [transaction] });
    result.textContent = `Fake wallet returned: ${hash}`;
  } catch (error) {
    result.textContent = `Request cancelled: ${error.message} (${error.code || "no code"})`;
  }
});
document.querySelector("#send").addEventListener("click", async () => {
  try { result.textContent = `Fake wallet returned: ${await provider.send({ method: "eth_sendTransaction", params: [transaction] })}`; }
  catch (error) { result.textContent = `Request cancelled: ${error.message} (${error.code || "no code"})`; }
});
document.querySelector("#sendAsync").addEventListener("click", () => {
  provider.sendAsync({ method: "eth_sendTransaction", params: [transaction], id: 1 }, (error, response) => {
    result.textContent = error ? `Request cancelled: ${error.message} (${error.code || "no code"})` : `Fake wallet returned: ${response.result}`;
  });
});

// --- Real wallet attack scenarios -------------------------------------------------
// Uses window.ethereum directly (your actual installed wallet), not the fake provider
// above. BOUND's hook patches window.ethereum regardless of which page script announces
// it, so these trigger real MetaMask popups AND real BOUND warnings.
const realStatus = document.querySelector("#real-status");
const scenarioResult = document.querySelector("#scenario-result");
let realAccount = null;

// An address with no relationship to any real protocol -- never seeded as trusted.
const UNKNOWN_SPENDER = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
const MAX_UINT256 = "f".repeat(64);

function pad32Address(address) { return address.toLowerCase().replace("0x", "").padStart(64, "0"); }
function pad32Uint(hexDigits) { return hexDigits.padStart(64, "0"); }

document.querySelector("#real-connect").addEventListener("click", async () => {
  if (!window.ethereum) { realStatus.textContent = "No wallet found. Install MetaMask or similar first."; return; }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    realAccount = accounts?.[0];
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    realStatus.textContent = `Connected: ${realAccount} on chain ${chainId}`;
    for (const id of ["scenario-benign", "scenario-unlimited", "scenario-nft", "scenario-blind-sign"]) {
      document.querySelector(`#${id}`).disabled = false;
    }
    scenarioResult.textContent = "Ready. Each button sends one real wallet request.";
  } catch (error) {
    realStatus.textContent = `Connection failed: ${error.message} (${error.code || "no code"})`;
  }
});

const SEPOLIA_CHAIN_ID = "0xaa36a7";

async function sendReal(tx) {
  try {
    // Hard refusal: never submit unless the wallet's *currently active* chain is Sepolia,
    // regardless of which network any UI tab/filter happens to be displaying. These contract
    // addresses only exist on Sepolia; sending this calldata anywhere else is pointless at
    // best and a real-funds mistake at worst.
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() !== SEPOLIA_CHAIN_ID) {
      scenarioResult.textContent = `Refused: wallet is on chain ${chainId}, not Sepolia (${SEPOLIA_CHAIN_ID}). Switch MetaMask's active network to Sepolia and try again.`;
      return;
    }
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: realAccount, ...tx }] });
    scenarioResult.textContent = `Wallet returned: ${hash}`;
  } catch (error) {
    scenarioResult.textContent = `Rejected or cancelled: ${error.message} (${error.code || "no code"})`;
  }
}

document.querySelector("#scenario-benign").addEventListener("click", () => sendReal({
  to: MOCK_USDC,
  // approve(UNISWAP_SWAP_ROUTER02, 1_000_000) -- 1 USDC to a real, verified protocol contract.
  // Expect: BOUND should not flag this as high-risk once a snapshot/baseline is configured.
  data: `0x095ea7b3${pad32Address(UNISWAP_SWAP_ROUTER02)}${pad32Uint((1_000_000).toString(16))}`
}));

document.querySelector("#scenario-unlimited").addEventListener("click", () => sendReal({
  to: MOCK_USDC,
  // approve(UNKNOWN_SPENDER, type(uint256).max) -- unlimited allowance to an address with no
  // trust evidence anywhere in the system. Expect: BOUND should flag this as high-risk/red
  // and surface the spender address plus a Revoke.cash link.
  data: `0x095ea7b3${pad32Address(UNKNOWN_SPENDER)}${MAX_UINT256}`
}));

document.querySelector("#scenario-nft").addEventListener("click", () => sendReal({
  to: MOCK_USDC, // stand-in contract address; only the selector/decoded roles are under test
  // setApprovalForAll(UNKNOWN_SPENDER, true) -- blanket operator rights over an entire
  // collection, granted to an unverified address. Expect: BOUND should flag this as high-risk.
  data: `0xa22cb465${pad32Address(UNKNOWN_SPENDER)}${pad32Uint("1")}`
}));

document.querySelector("#scenario-blind-sign").addEventListener("click", async () => {
  try {
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() !== SEPOLIA_CHAIN_ID) {
      scenarioResult.textContent = `Refused: wallet is on chain ${chainId}, not Sepolia (${SEPOLIA_CHAIN_ID}). Switch MetaMask's active network to Sepolia and try again.`;
      return;
    }
    const signature = await window.ethereum.request({ method: "eth_sign", params: [realAccount, "0xdeadbeef"] });
    scenarioResult.textContent = `Wallet returned signature: ${signature}`;
  } catch (error) {
    scenarioResult.textContent = `Rejected or cancelled: ${error.message} (${error.code || "no code"})`;
  }
});
