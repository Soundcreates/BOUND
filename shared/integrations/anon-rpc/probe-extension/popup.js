const out = document.getElementById("out");
const button = document.getElementById("run");

button.addEventListener("click", () => {
  out.textContent = "running… (first boot fetches + hash-verifies the worker bundle, can take a few seconds)";
  out.className = "";
  chrome.runtime.sendMessage({ type: "probe" }, (result) => {
    if (!result) {
      out.textContent = "no response from the service worker (it may have been killed mid-call — click again)";
      out.className = "fail";
      return;
    }
    if (result.ok) {
      out.className = "ok";
      out.textContent =
        `OK in ${result.ms} ms\n` +
        `eth_chainId via nox (anon-rpc) = ${result.chainId}\n` +
        `matches Sepolia (11155111): ${result.matchesNoxChain}`;
    } else {
      out.className = "fail";
      out.textContent = `FAILED: ${result.error}`;
    }
  });
});
