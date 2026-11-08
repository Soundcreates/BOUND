# Code cleanup roadmap

This roadmap is for the BOUND folder migration. It records follow-up work without deleting files or generated outputs now. Preserve `.bound/` state, user data, operational logs, and historical review/evidence records throughout cleanup.

## Priorities

| Priority | Work | Acceptance | Main risks |
|---|---|---|---|
| P0 | Inventory tracked accidental artifacts, including `.DS_Store`; review each file and its provenance before proposing removal. | A reviewed inventory identifies owner, purpose, and disposition for every candidate; no artifact is removed as part of this roadmap. | A seemingly incidental file may be user-owned or contain useful local state. |
| P0 | Define generated package and ZIP policy: identify source inputs, generated outputs, tracked release artifacts, ignore rules, and reproducible build steps. | Each generated package/ZIP has a documented source/build command and a clear decision to track or ignore it; intentional release artifacts remain reproducible. | Removing or regenerating a ZIP can lose release evidence or break users relying on a checked-in artifact. |
| P1 | Audit JavaScript and MJS implementations for parity where both forms exist. | Each pair is classified as canonical/generated/compatibility or independently maintained; relevant behavior has parity coverage before consolidation is proposed. | Module-system differences and consumers may make similarly named files intentionally distinct. |
| P1 | Audit obsolete curator publication paths and scripts. | A dependency and entry-point map shows which publication path is active, which is obsolete, and the evidence/owner needed before any later removal. | Legacy paths may still be needed for recovery, existing deployments, or historical reproducibility. |
| P1 | Extract extension `sw.js` responsibilities into focused modules. | A behavior inventory and tests cover message routing, transaction interception, state transitions, alarms, and failure handling before extraction; extension build and browser checks pass. | Service-worker lifecycle, ordering, and persisted state can change subtly during refactoring. |
| P1 | Establish dependency ownership and lockfile policy across root and component packages. | Each dependency has one declared owner; install/build commands and lockfile update rules are documented and repeatable without unintended lockfile churn. | Hoisting and duplicated versions can alter resolution; stale locks can make builds nonreproducible. |
| P1 | Add or align CI build, typecheck, and browser checks. | CI runs supported builds and typechecks, then browser checks where runner capabilities permit; unsupported live-service checks are explicitly separated and reports identify skips. | Browser availability, extension loading restrictions, and external-service dependence can produce misleading CI failures or false confidence. |
| P2 | Consolidate outdated documentation. | Current guides link to migrated paths and supported commands; historical review notes, evidence logs, and dated claims retain their original context. | Bulk path edits can rewrite historical facts or leave broken relative links. |

## Sequence and guardrails

1. Finish the directory migration and update current documentation links and commands.
2. Inventory artifacts and generated outputs; record findings before changing tracked files.
3. Map implementation parity, curator entry points, and dependency ownership.
4. Add behavior coverage and CI gates before moving or consolidating implementations.
5. Consolidate current documentation after the source-of-truth commands and architecture stabilize.

No deletions are authorized by this roadmap. Any later cleanup should preserve `.bound/`, logs, fixtures used as evidence, user data, and historical review records unless a separate reviewed decision establishes that a specific item is safe to remove.
