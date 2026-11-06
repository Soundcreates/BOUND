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
      await capture("start");
      try {
        await chrome.storage.local.set({ boundMonitoring: true });
      } catch (error) {
        await capture("stop").catch(() => {});
        throw error;
      }
    }
  } catch (error) {
    status.textContent = error.message || "Unable to update monitoring. Please try again.";
    status.hidden = false;
  } finally {
    render();
    button.disabled = false;
  }
});

initialize();
