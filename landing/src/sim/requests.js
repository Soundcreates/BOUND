// Builders for the wallet requests used by the simulation.
// Every address is fictional. Calldata is real ABI encoding so the real BOUND decoder can read it.

const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, '0');

export const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
export const MAX_UINT256 = (1n << 256n) - 1n;

// Fictional cast. Real addresses are 160 bits, and the decoder ignores calldata words below 2^64
// (so small integers are not mistaken for addresses). The fakes therefore fill all 40 hex digits.
const fake = (pattern) => `0x${pattern.repeat(10)}`;
export const A = {
  you: fake('5eed'),
  token: fake('a0a0'),
  router: fake('b0b0'),
  vault: fake('c0c0'),
  nft: fake('d0d0'),
  attacker: fake('bad1'),
  attacker2: fake('bad2'),
  attackerImpl: fake('bad3'),
  safe: fake('5afe'),
};

export const LABELS = {
  [A.you]: 'You (signer)',
  [A.token]: 'TOKEN contract',
  [A.router]: 'Swap router',
  [A.vault]: 'Vault',
  [A.nft]: 'NFT collection',
  [A.attacker]: 'Unknown address',
  [A.attacker2]: 'Unknown address',
  [A.attackerImpl]: 'Unknown contract',
  [A.safe]: 'Team multisig',
};

export const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const labelOf = (address) => LABELS[address.toLowerCase()] || 'Unlisted address';

const tx = (to, data = '0x', value) => ({ method: 'eth_sendTransaction', params: [{ from: A.you, to, data, ...(value ? { value } : {}) }] });

export const approve = (token, spender, amount = MAX_UINT256) => tx(token, `0x095ea7b3${addressWord(spender)}${word(amount)}`);
export const setApprovalForAll = (collection, operator, on = true) => tx(collection, `0xa22cb465${addressWord(operator)}${word(on ? 1 : 0)}`);
export const transfer = (token, to, amount) => tx(token, `0xa9059cbb${addressWord(to)}${word(amount)}`);
// Truncated on purpose: a valid approve needs a second 32-byte word.
export const truncatedApprove = (token, spender) => tx(token, `0x095ea7b3${addressWord(spender)}`);
// Uniswap-V2-shaped call whose ABI BOUND does not know. The path ends in `recipient`.
export const unknownSwap = (router, recipient) => tx(router, `0x38ed1739${word(1000)}${word(900)}${word(160)}${addressWord(recipient)}${word(1_900_000_000)}${word(2)}${addressWord(A.token)}${addressWord(A.token)}`);

export const ethSign = () => ({ method: 'eth_sign', params: [A.you, `0x${'ab'.repeat(32)}`] });
export const personalSign = (text = 'Sign in to swap.example') => ({ method: 'personal_sign', params: [`0x${[...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('')}`, A.you] });
export const unsupported = () => ({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x539' }] });
export const delegation = (delegate, chainId = '0x0') => ({ method: 'wallet_signAuthorization', params: [{ address: delegate, chainId, nonce: '0x0' }] });

// EIP-2612 permit, exactly the field order BOUND's decoder recognises.
export const permit = (token, spender) => ({
  method: 'eth_signTypedData_v4',
  params: [A.you, JSON.stringify({
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
    },
    primaryType: 'Permit',
    domain: { name: 'TOKEN', version: '1', chainId: 1, verifyingContract: token },
    message: { owner: A.you, spender, value: MAX_UINT256.toString(), nonce: '0', deadline: '1900000000' },
  })],
});

// A Safe{Wallet} multisig transaction. `operation: 1` is DELEGATECALL: the signed payload lets the target run code as the Safe.
export const safeTx = ({ to, operation }) => ({
  method: 'eth_signTypedData_v4',
  params: [A.you, JSON.stringify({
    types: {
      EIP712Domain: [{ name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      SafeTx: [
        { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    domain: { chainId: 1, verifyingContract: A.safe },
    message: { to, value: '0', data: '0x', operation, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: addr(0), refundReceiver: addr(0), nonce: '41' },
  })],
});
