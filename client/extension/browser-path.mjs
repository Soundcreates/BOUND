import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const candidates = {
  darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge'],
  win32: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
};

// A custom Chromium build can be supplied when a stock browser disables unpacked extensions.
export async function findBrowser({ override = process.env.BOUND_CHROMIUM_PATH, platform = process.platform, check = access } = {}) {
  const paths = override ? [override] : candidates[platform] ?? [];
  for (const candidate of paths) {
    try { await check(candidate, constants.X_OK); return candidate; } catch { /* try the next browser */ }
  }
  throw new Error('Chromium browser not found; set BOUND_CHROMIUM_PATH to an executable that supports unpacked extensions.');
}
