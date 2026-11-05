let provider;
const result = document.querySelector("#result");

document.querySelector("#connect").addEventListener("click", () => {
  provider = {
    isBoundTestProvider: true,
    async request(payload) {
      if (payload.method === "eth_chainId") return "0x7a69";
      if (payload.method === "eth_accounts") return ["0x00000000000000000000000000000000000000a1"];
      result.textContent = `Fake wallet received: ${JSON.stringify(payload)}`;
      return "0xmock-transaction-hash";
    },
    send(methodOrPayload, paramsOrCallback, callback) {
      const payload = typeof methodOrPayload === "string" ? { method: methodOrPayload, params: paramsOrCallback } : methodOrPayload;
      const done = typeof callback === "function" ? callback : typeof paramsOrCallback === "function" ? paramsOrCallback : null;
      const finish = (value) => done ? done(null, { jsonrpc: "2.0", id: payload?.id ?? null, result: value }) : value;
      const value = payload?.method === "eth_chainId" ? "0x7a69" : payload?.method === "eth_accounts" ? ["0x00000000000000000000000000000000000000a1"] : "0xmock-transaction-hash";
      if (!done) result.textContent = `Fake wallet received: ${JSON.stringify(payload)}`;
      return finish(value);
    },
    sendAsync(payload, callback) {
      const value = payload.method === "eth_chainId" ? "0x7a69" : payload.method === "eth_accounts" ? ["0x00000000000000000000000000000000000000a1"] : "0xmock-transaction-hash";
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

const transaction = {
  from: "0x00000000000000000000000000000000000000a1",
  to: "0x00000000000000000000000000000000000000b1",
  data: "0x095ea7b300000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001"
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
