self.addEventListener("message", (event) => {
  // Developer 2 supplies the real anonymizing transport at the fixed adapter boundary.
  self.postMessage({ requestId: event.data?.requestId, error: "anon_rpc_not_configured" });
});
