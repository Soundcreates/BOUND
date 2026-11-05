let creating;
const READS = new Set(["eth_chainId", "eth_call", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_getProof"]);

export async function anonRpc(request) {
  if (!request || typeof request.method !== "string" || !READS.has(request.method)) return { error: "method_not_allowed" };
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (!contexts.length) {
    creating ||= chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Host the Anon-RPC worker without exposing sensitive chain reads to page scripts."
    }).finally(() => { creating = undefined; });
    await creating;
  }
  return chrome.runtime.sendMessage({
    target: "bound-anon-rpc-offscreen",
    requestId: crypto.randomUUID(),
    request
  });
}
