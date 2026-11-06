# Why Arkiv

The proposed design uses Arkiv's queryable, wallet-owned, expiring entities for public site observations and status. It keeps these changing signals separate from the curator-controlled snapshot; an Arkiv observation is never a trust anchor. Owner checking is essential because anyone can publish matching attributes. Expiry and write/query behavior must be proven on the selected live network before claiming the integration works.

Compared with an operator-only Postgres instance, Arkiv lets other clients query public, expiring records and verify the publishing wallet independently of our server. This still depends on the configured RPC and trusted owner; it is not a cryptographic state proof. Private keys, signed transaction journals and sensitive user data stay off Arkiv; observations are filtered before publication. Public records are not appropriate for secrets.
