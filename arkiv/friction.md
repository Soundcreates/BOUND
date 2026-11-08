# Arkiv integration friction

- A funded test-only writer was used for initial create, patch, read, and expiry evidence; renewal and the full application path still need live verification.
- Rabdi public RPC is rate-limited; an optional access key must stay outside the repository and logs.
- Query pages can observe different blocks. The reader rejects a multi-page response if block numbers change, so callers must retry instead of treating partial results as complete.
- The proposed record schema and create/patch path were exercised live; renewal and crash-recovery behavior remain locally tested only. At-least-once queue delivery requires receiver-side operation-ID deduplication.
- Watcher journal storage is single-process and bounded; migration, multi-process coordination, and production operations are not complete.
- The Gitleaks CI job has not run in GitHub. Its action requires a license secret for organization-owned repositories. No secret was added by this change.

## Actionable feedback

**Consistent pagination:** We expected a paginated query to represent one stable view. Pages may span different blocks, so our reader rejects that result rather than returning a potentially inconsistent bundle. Reproduction: run an owner query through `createArkivRpcReader.query` while the queried data or chain changes between pages; see pagination checks in `shared/integrations/arkiv/rpc.js`. A snapshot or block-pinned query and a resumable cursor would make this easier. The timing-dependent failure is not claimed to occur on every run.

**Operation recovery:** A transaction may have been broadcast even if the client loses the response. We expected a straightforward way to determine its final result; our integration persists signed transactions and operation IDs and performs readback before acknowledging. A documented end-to-end recovery recipe for uncertain submissions and idempotency would help. See `shared/integrations/arkiv/sender.js`.
