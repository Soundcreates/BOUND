import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("./popup.js", import.meta.url), "utf8");

async function openPopup(search, selectedTab = { id: 42, url: "https://example.com/path" }) {
  const nodes = new Map();
  const node = () => ({ hidden: false, textContent: "", addEventListener(type, fn) { this[type] = fn; }, replaceChildren() {}, append() {} });
  for (const id of ["site", "coverage", "frames", "history", "settings", "open-window", "window-error", "privacy", "queue-error", "incident"]) nodes.set(`#${id}`, node());
  const classes = new Set(), created = [], listeners = {};
  const chrome = {
    runtime: { openOptionsPage() {}, getURL: file => `chrome-extension://test/${file}`, async sendMessage() { return {}; } },
    tabs: {
      async query() { return [selectedTab]; }, async get(id) { if (!selectedTab || selectedTab.id !== id) throw new Error("closed"); return selectedTab; },
      onUpdated: { addListener(fn) { listeners.updated = fn; } }, onRemoved: { addListener(fn) { listeners.removed = fn; } }
    },
    windows: { async create(options) { created.push(options); } },
    storage: { session: { async get() { return {}; } }, local: { async get() { return {}; } } }
  };
  const location = { search, reload() { location.reloaded = true; } };
  const document = { querySelector: selector => nodes.get(selector), documentElement: { classList: { add: value => classes.add(value) } } };
  runInNewContext(source, { document, location, chrome, URL, URLSearchParams, Date });
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, created, classes, listeners, location };
}

test("opens a resizable window for the original tab and keeps that context", async () => {
  const popup = await openPopup("");
  await popup.nodes.get("#open-window").click();
  assert.equal(popup.created.length, 1);
  assert.equal(popup.created[0].type, "popup");
  assert.equal(new URL(popup.created[0].url).searchParams.get("tabId"), "42");
  const detached = await openPopup("?tabId=42");
  assert.equal(detached.nodes.get("#site").textContent, "https://example.com");
  assert.equal(detached.nodes.get("#open-window").hidden, true);
  assert.equal(detached.classes.has("detached"), true);
  detached.listeners.updated(42, { url: "https://example.org" });
  assert.equal(detached.location.reloaded, true);
});

test("a closed source tab is shown as unavailable", async () => {
  const popup = await openPopup("?tabId=42", null);
  assert.match(popup.nodes.get("#site").textContent, /no longer available/);
  assert.match(popup.nodes.get("#coverage").textContent, /No coverage/);
});
