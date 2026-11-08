# BOUND landing page

From this directory, run `npm install --workspaces=false`, then `npm run dev`. Use `npm run build` for a production build.

To embed the unlisted demo, create `.env.local` in this directory containing `VITE_DEMO_VIDEO_ID=YOUR_VIDEO_ID`, then restart the development server or rebuild. Use the 11-character ID from the YouTube URL. Until configured, the page displays a labeled placeholder.

The interactive scenarios are illustrations of the proposed site-safety workflow; they do not call a wallet or external service.

The extension download is a prototype ZIP at `public/bound-extension.zip`. To refresh it after changing the extension, run `node apps/extension/build.mjs` from the repository root, then `python landing/scripts/package-extension.py`. The packager includes only the extension's build files and excludes browser profiles and local data. Users must extract the ZIP and load it as an unpacked extension in Chromium.

## Testing route

Open `/testing` (for example `http://127.0.0.1:5173/testing`) or use **Testing** in the landing navigation. Vite development and preview servers support direct route loads; a production static host must rewrite `/testing` and `/testing/` to `index.html`.

The five judge cases call the actual decoder, transaction policy engine and frontend comparator with synthetic request/evidence fixtures. They cover a trusted approval (100), no baseline (unknown), unknown spender (35), corroborated hash conflict with a risky approval (15, fallback eligible), and stale evidence (15, fallback suppressed). The route applies the default score gate of `<16` in addition to frontend eligibility. It does not simulate ticket creation, browser document binding or cancellation acknowledgements.

Run each case manually, toggle stale/immature/fewer-reporter/drift inputs, inspect the computed JSON, try Cancel/Continue/typed confirmation and advance the review deadline. **Evaluate all five** produces one result per case and **Export report** downloads those results. **Open Swarm report** is a manual presentation navigation with no extension ticket; **Connect real wallet** separately issues only `eth_requestAccounts` through the installed wallet/BOUND path. No real wallet approvals are requested by the fixtures.

Run `npm test` and `npm run build` in this directory. Source basis: `Docs/BOUND_Final_Architecture.md`, `Docs/BOUND_Technical_Architecture_and_Security_Whitepaper.md`, the decoder/policy implementation and `apps/extension/frontend-redirect.mjs`. The architecture documents contain proposed features; the workbench reports implemented decision logic only.
