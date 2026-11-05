# How BOUND uses Arkiv

The intended path is extension observation queue → watcher intake and deduplication → watcher-owned expiring observation → hourly baseline → owner-verified bundle. Warned events are separate and contain no user decision. Observations during an active incident are excluded. Drift and incidents are separate records; incidents carry a plain Swarm reference and report digest.

The local test `scripts/integration/local.test.js` exercises part of this flow with fake storage and cannot prove the live integration. The actual client-side privacy filter, live writer, hourly scheduler, extension consumption and a clean live round trip remain open.
