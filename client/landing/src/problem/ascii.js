// ASCII art for the Problem page. Plain ASCII only, so it lines up in any monospace font.
// Everything is generated from small pieces so the columns can never drift out of alignment.

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

/** Put two blocks of text side by side. `drop` moves the right block down. */
const side = (left, right, gap = 6, drop = 0) => {
  const w = Math.max(...left.map((l) => l.length));
  const rows = Math.max(left.length, right.length + drop);
  return Array.from({ length: rows }, (_, i) => `${pad(left[i] ?? '', w)}${' '.repeat(gap)}${right[i - drop] ?? ''}`.trimEnd());
};

const box = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  const bar = `+${'-'.repeat(w + 2)}+`;
  return [bar, ...rows.map((r) => `| ${pad(r, w)} |`), bar];
};

const block = (n, hash, txs) => [
  '+----------+',
  '| BLOCK    |',
  `| ${pad(`#${n}`, 9)}|`,
  `| ${pad(hash, 9)}|`,
  `| ${pad(`${txs} txs`, 9)}|`,
  '+----------+',
];

// A chain: each block points back at the one before it.
const blocks = [block(19042, '0x9f3a..', 214), block(19043, '0xc71e..', 187), block(19044, '0x2b8d..', 203)];
export const CHAIN = [
  ...Array.from({ length: 6 }, (_, row) => blocks.map((b, i) => (row === 2 && i > 0 ? `<-----${b[row]}` : `${i > 0 ? '      ' : ''}${b[row]}`)).join('') + (row === 2 ? '<- ...' : '')),
  '',
  'each block signs the one before it.',
  'change one byte and every hash after it breaks.',
];

// An Ethereum-style diamond beside a web3 domain bar: the page looks right, but is it?
const DIAMOND = [
  '      /\\      ',
  '     /  \\     ',
  '    / /\\ \\    ',
  '   / /  \\ \\   ',
  '  / /    \\ \\  ',
  ' < <------> > ',
  '  \\ \\    / /  ',
  '   \\ \\  / /   ',
  '    \\ \\/ /    ',
  '     \\  /     ',
  '      \\/      ',
];
const PANEL = [
  ...box(['https://app.yourname.eth  [ok]']),
  '',
  '  ENS  ->  0x9f3a...c71e',
  '  [ connect wallet ]',
  '',
  '  looks right. is it?',
];
export const WEB3 = side(DIAMOND, PANEL, 6, 2);
