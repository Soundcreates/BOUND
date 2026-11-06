# Register an ENSv2 name on Sepolia

`scripts/ens/register-name.mjs` registers a new `.eth` name using the ENSv2 Sepolia registrar. It checks the RPC chain and contract code, requires an existing dedicated resolver proxy and explicit ERC-20 payment token, and preserves the commit secret in `.bound/ens-registration/<label>.json`. It never prints the secret or wallet key. It does not register arbitrary DNS names such as `example.com` or a localhost address as ENS names.

Use a disposable Sepolia owner and test tokens only. Set the following in your private local `.env` (never send keys in chat):

```dotenv
BOUND_SEPOLIA_RPC_URL=<sepolia-rpc-url>
BOUND_OWNER_ADDRESS=<public-owner-address>
BOUND_OWNER_PRIVATE_KEY=<owner-private-key-for-write-steps>
BOUND_REGISTRATION_RESOLVER=<existing-dedicated-permissioned-resolver-proxy>
BOUND_PAYMENT_TOKEN=<registrar-supported-sepolia-test-token>
# Optional; defaults to one year.
BOUND_DURATION_SECONDS=31536000
```

The resolver must already be deployed and controlled by the intended owner. Reusing an existing resolver can share role permissions across its names; use a dedicated proxy for a new independent BOUND root. The command checks that it has code and is not the shared implementation, but does not prove its ownership or grants. The existing setup helper in `services/curator/probe/setup-root-name.ts` demonstrates deploying a dedicated resolver; verify its deployment and permissions before using it.

From the repository root, replace `your-demo-name` with an available lowercase label without `.eth`:

```bash
node --env-file=.env --experimental-strip-types scripts/ens/register-name.mjs prepare your-demo-name
node --env-file=.env --experimental-strip-types scripts/ens/register-name.mjs commit your-demo-name
node --env-file=.env --experimental-strip-types scripts/ens/register-name.mjs status your-demo-name
node --env-file=.env --experimental-strip-types scripts/ens/register-name.mjs register your-demo-name
```

`prepare` is read-only onchain. It reports the current price, owner balance, and registrar allowance in the selected token's base units and creates the private local state. Fund the owner with enough Sepolia gas and registrar-supported test tokens, and approve the registrar for the exact amount before `commit`. The command does not mint tokens or send an approval. Check the token and its unit precision independently; an ERC-20 symbol alone does not establish its identity.

`commit` sends a Sepolia transaction. Run `status` until `eligible` is true, then run `register` before the commitment expires. `register` simulates the call, submits it, waits for its receipt, and checks the resolver. If a submission is uncertain, inspect the wallet transaction and state before retrying. Do not delete or share the state file: losing its secret loses the ability to reveal that commitment.

Registering a name does not publish BOUND's trust snapshot. To use it as BOUND's root, the name must point to the intended dedicated resolver; the curator must have the scoped `bound.root.v2` setter role; and the curator must publish a snapshot and root pointer. Update the extension's root name and pinned resolver together. See `services/curator/README.md` and `Docs/no-swarm-architecture.md`.

BOUND's configured root is the project's trust anchor. The websites checked by the extension are entries in its verified snapshot and watcher records; they do not each need to register their own ENS name. Separately, the watcher must be configured to monitor a site's DNS/TLS infrastructure if live monitoring is required.
