/**
 * Enhanced Access Control role constants for PermissionedResolver.
 *
 * SOURCE OF TRUTH: https://docs.ens.domains/contracts/ensv2/permissioned-resolver, fetched
 * and verified 2026-11-06. This is the POST-AUDIT-2 layout (ensdomains/contracts-v2 PR
 * #417), which is what the 2026-10-01 Sepolia redeploy actually runs — confirmed
 * independently by a live `deployProxy` revert against the OLD 3-arg `initialize` encoding,
 * and by the selector 0x33cc44a0 matching `initialize((address,uint256)[],bytes[])`
 * exactly. An EARLIER version of this file used a different (pre-audit-2) bit layout and a
 * node-scoped resource() — both wrong for this deployment. Do not trust docs.ens.domains
 * pages under the OLD `/ensv2/...` path (no `contracts/` prefix): they describe the
 * superseded pre-audit-2 contract (authorizeTextRoles/authorizeNameRoles, ROLE_SET_PUBKEY,
 * ROLE_SET_ALIAS, ROLE_CLEAR — all absent from the live bytecode per ensjs PR #379's direct
 * verification against deployed Sepolia bytecode).
 */
import { keccak256, toHex, type Hex } from "viem";

export const ROLE_SET_ADDR = 1n << 0n; // "ROLE_SET_ADDRESS" in the new docs; kept this name to minimize churn elsewhere
export const ROLE_SET_TEXT = 1n << 4n;
export const ROLE_SET_CONTENTHASH = 1n << 8n;
export const ROLE_SET_ABI = 1n << 12n;
export const ROLE_SET_INTERFACE = 1n << 16n;
export const ROLE_SET_NAME = 1n << 20n;
export const ROLE_SET_DATA = 1n << 24n;
export const ROLE_LINK = 1n << 28n; // replaces the old ROLE_SET_ALIAS / ROLE_CLEAR, which no longer exist
export const ROLE_CAN_NAME = 1n << 120n;
export const ROLE_UPGRADE = 1n << 124n;

/** Every PermissionedResolver regular role, OR'd together. Used only at initial setup. */
export const ALL_REGULAR_ROLES =
  ROLE_SET_ADDR | ROLE_SET_TEXT | ROLE_SET_CONTENTHASH | ROLE_SET_ABI |
  ROLE_SET_INTERFACE | ROLE_SET_NAME | ROLE_SET_DATA | ROLE_LINK |
  ROLE_CAN_NAME | ROLE_UPGRADE;

/** Each role's admin counterpart lives at `role << 128`. */
export function adminOf(roleBitmap: bigint): bigint {
  return roleBitmap << 128n;
}

/** Every regular role AND its admin counterpart — what a fresh proxy's deployer needs. */
export const ALL_ROLES_WITH_ADMIN = ALL_REGULAR_ROLES | adminOf(ALL_REGULAR_ROLES);

export const ROOT_RESOURCE = 0n;

/**
 * Argument-scoped resource for a text/data key: keccak256(bytes(key)) — NOT namehash-
 * scoped. Per docs.ens.domains/contracts/ensv2/permissioned-resolver: "Resources depend
 * only on the setter argument, not on names... There is no per-name scoping. A role holder
 * can write the covered records on every name the resolver serves." This resolver is
 * dedicated to a single name, so that's exactly the intended shape — but it means the
 * resource must NOT be mixed with the node the way a pre-audit-2 reading would suggest.
 */
export function textPartHash(key: string): Hex {
  return keccak256(toHex(key));
}

/** The resource ID the curator needs ROLE_SET_TEXT on to call setText(name, key, ...). */
export function textResource(key: string): bigint {
  return BigInt(textPartHash(key));
}
