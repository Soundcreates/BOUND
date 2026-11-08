import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./popup.js", import.meta.url), "utf8");

async function popup({ active = false, failStart = false, failStop = false } = {}) {
  let handler;
  const button = {
    disabled: true, textContent: "", classList: { toggle() {} },
    addEventListener(_event, callback) { handler = callback; }
  };
  const status = { hidden: true, textContent: "" };
  const calls = [];
  const chrome = {
    runtime: { async sendMessage({ action }) {
      calls.push(action);
      if ((action === "start" && failStart) || (action === "stop" && failStop)) return { ok: false, error: "Capture failed." };
      if (action === "start") active = true;
      if (action === "stop") active = false;
      return { ok: true, capture: { active } };
    } },
    storage: { local: { async set(value) { calls.push(value.boundMonitoring); } } }
  };
  vm.runInNewContext(source, { chrome, document: { querySelector: selector => selector === "#monitoring" ? button : status } });
  await new Promise(resolve => setImmediate(resolve));
  return { button, status, calls, click: () => handler() };
}

test("one button starts and stops monitoring and capture", async () => {
  const ui = await popup();
  assert.equal(ui.button.textContent, "Start Monitoring");
  await ui.click();
  assert.equal(ui.button.textContent, "Stop Monitoring");
  await ui.click();
  assert.equal(ui.button.textContent, "Start Monitoring");
  // Monitoring is turned on before capture starts: capture is refused while it is off.
  assert.deepEqual(ui.calls, ["status", true, "start", "stop", false]);
});

test("capture failures are visible and keep the button retryable", async () => {
  const start = await popup({ failStart: true });
  await start.click();
  assert.equal(start.button.textContent, "Start Monitoring");
  assert.equal(start.status.hidden, false);
  // A failed capture turns monitoring back off.
  assert.deepEqual(start.calls, ["status", true, "start", false]);
  const stop = await popup({ active: true, failStop: true });
  await stop.click();
  assert.equal(stop.button.textContent, "Stop Monitoring");
  assert.equal(stop.status.hidden, false);
  assert.deepEqual(stop.calls, ["status", "stop"]);
});
