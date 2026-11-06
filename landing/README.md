# BOUND landing page

From this directory, run `npm install --workspaces=false`, then `npm run dev`. Use `npm run build` for a production build.

To embed the unlisted demo, create `.env.local` in this directory containing `VITE_DEMO_VIDEO_ID=YOUR_VIDEO_ID`, then restart the development server or rebuild. Use the 11-character ID from the YouTube URL. Until configured, the page displays a labeled placeholder.

The interactive scenarios are illustrations of the proposed site-safety workflow; they do not call a wallet or external service.

The extension download is a prototype ZIP at `public/bound-extension.zip`. To refresh it after changing the extension, run `node apps/extension/build.mjs` from the repository root, then `python landing/scripts/package-extension.py`. The packager includes only the extension's build files and excludes browser profiles and local data. Users must extract the ZIP and load it as an unpacked extension in Chromium.
