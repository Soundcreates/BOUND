# Arkiv integration friction

- A funded test-only writer was used for initial create, patch, read, and expiry evidence; renewal and the full application path still need live verification.
- Rabdi public RPC is rate-limited; an optional access key must stay outside the repository and logs.
- Query pages can observe different blocks. The reader rejects a multi-page response if block numbers change, so callers must retry instead of treating partial results as complete.
- The proposed record schema and create/patch path were exercised live; renewal and crash-recovery behavior remain locally tested only. At-least-once queue delivery requires receiver-side operation-ID deduplication.
- Watcher journal storage is single-process and bounded; migration, multi-process coordination, and production operations are not complete.
- The Gitleaks CI job has not run in GitHub. Its action requires a license secret for organization-owned repositories. No secret was added by this change.
