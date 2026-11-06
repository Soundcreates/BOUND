/**
 * Minimal ABI fragments, trimmed from the deployed contracts' real ABIs
 * (contracts-v2/contracts/deployments/sepolia/*.json) to exactly what BOUND calls.
 * Keeping these hand-trimmed (rather than importing the full ABI) means a change to an
 * unrelated function can never silently change what this package is allowed to call.
 */
import { parseAbi } from "viem";

export const permissionedResolverAbi = parseAbi([
  // reads — unchanged by post-audit-2: still node-scoped
  "function text(bytes32 node, string key) view returns (string)",
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function ROOT_RESOURCE() view returns (uint256)",
  // writes — post-audit-2 (contracts-v2 PR #417 / #255): setters take a DNS-encoded
  // `bytes name`, not a bytes32 node; authorizeTextRoles/authorizeNameRoles are gone,
  // replaced by grantSetterRoles (argument-scoped) and grantRootRoles (resolver-wide).
  // Verified: initialize's selector (0x33cc44a0) matches initialize((address,uint256)[],bytes[])
  // exactly against the live Sepolia contract.
  "function setText(bytes name, string key, string value)",
  "function grantRootRoles(uint256 roleBitmap, address account)",
  "function revokeRootRoles(uint256 roleBitmap, address account)",
  "function grantSetterRoles(bytes setter, address account)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account)",
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function multicall(bytes[] calls) returns (bytes[])",
]);

export const universalResolverV2Abi = parseAbi([
  "function findResolver(bytes name) view returns (address, bytes32, uint256)",
  "function resolve(bytes name, bytes data) view returns (bytes, address)",
]);

export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const ethRegistrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) view returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint256)",
  "function MIN_COMMITMENT_AGE() view returns (uint256)",
  "function MAX_COMMITMENT_AGE() view returns (uint256)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);

export const ethRegistryAbi = parseAbi([
  "function getResolver(string label) view returns (address)",
  "function setResolver(uint256 anyId, address resolver)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function findOwner(string label) view returns (address)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
]);
