// Test-only Keccak-256 reference used to verify the shared snapshot digest vector.
const MASK = (1n << 64n) - 1n;
const ROTATION = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const ROUND = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const rotate = (x, n) => n === 0 ? x : BigInt.asUintN(64, (x << BigInt(n)) | (x >> BigInt(64 - n)));

function permute(a) {
  for (const round of ROUND) {
    const c = new Array(5);
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    const d = c.map((_, x) => c[(x + 4) % 5] ^ rotate(c[(x + 1) % 5], 1));
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) a[x + 5 * y] ^= d[x];

    const b = new Array(25).fill(0n);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      b[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(a[x + 5 * y], ROTATION[x + 5 * y]);
    }
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      a[x + 5 * y] = BigInt.asUintN(64, b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]));
    }
    a[0] ^= round;
  }
}

export function keccak256(input) {
  const message = Buffer.from(input);
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((message.length + 1) / rate) * rate);
  padded.set(message);
  padded[message.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const state = new Array(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane++) {
      let word = 0n;
      for (let byte = 0; byte < 8; byte++) word |= BigInt(padded[offset + lane * 8 + byte]) << (8n * BigInt(byte));
      state[lane] ^= word;
    }
    permute(state);
  }

  let result = '0x';
  for (let i = 0; i < 32; i++) {
    const byte = (state[Math.floor(i / 8)] >> (8n * BigInt(i % 8))) & 0xffn;
    result += byte.toString(16).padStart(2, '0');
  }
  return result;
}
