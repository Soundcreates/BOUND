const button = document.querySelector("#monitoring");
const status = document.querySelector("#status");
let capturing = false;

function render() {
  button.textContent = capturing ? "Stop Monitoring" : "Start Monitoring";
  button.classList.toggle("is-active", capturing);
}

async function capture(action) {
  const result = await chrome.runtime.sendMessage({ type: "BOUND_CAPTURE_V1", action });
  if (!result?.ok) throw new Error(result?.error || "Capture unavailable.");
  capturing = result.capture.active;
}

async function initialize() {
  try {
    await capture("status");
    render();
    button.disabled = false;
  } catch {
    status.textContent = "Unable to check capture status. Close and reopen the popup to try again.";
    status.hidden = false;
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.hidden = true;
  try {
    if (capturing) {
      await chrome.storage.local.set({ boundMonitoring: false });
      await capture("stop");
    } else {
      // Consent comes first: the service worker refuses to capture while monitoring
      // is off, so monitoring is turned on before capture starts, and turned back off
      // if capture cannot start on this tab.
      await chrome.storage.local.set({ boundMonitoring: true });
      try {
        await capture("start");
      } catch (error) {
        await chrome.storage.local.set({ boundMonitoring: false }).catch(() => {});
        throw error;
      }
    }
    // Page scripts are registered on Start and removed on Stop; open tabs keep
    // whatever they loaded with until they are reloaded.
    status.textContent = "Reload open tabs to apply.";
    status.hidden = false;
  } catch (error) {
    status.textContent = error.message || "Unable to update monitoring. Please try again.";
    status.hidden = false;
  } finally {
    render();
    button.disabled = false;
  }
});

initialize();
