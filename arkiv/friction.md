# Arkiv integration friction

- A funded test-only writer and write/read/expiry evidence are not yet available.
- Rabdi public RPC is rate-limited; an optional access key must stay outside the repository and logs.
- Query pages can observe different blocks. The reader rejects a multi-page response if block numbers change, so callers must retry instead of treating partial results as complete.
- The proposed record schema and idempotent writer contract need live compatibility verification. At-least-once queue delivery requires receiver-side operation-ID deduplication.
- Watcher journal storage is single-process and bounded; migration, multi-process coordination, and production operations are not complete.
- The Gitleaks CI job has not run in GitHub. Its action requires a license secret for organization-owned repositories. No secret was added by this change.
