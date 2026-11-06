import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { CHAIN, WEB3 } from './ascii.js';
import './problem.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Copy carried over from the previous "The problem" section. `mark` segments get the yellow highlighter.
const paragraphs = [
  {
    id: 'surface',
    side: 'right', // centre → right edge
    parts: [
      { t: 'In Web3, the interface is where trust becomes action. But an attacker can change what a familiar site serves, ' },
      { t: 'without changing what you expect to see.', mark: true },
    ],
  },
  {
    id: 'moment',
    side: 'left', // left edge → centre
    parts: [
      { t: 'A lookalike domain or a changed frontend can put a different request in front of you. By the time your wallet asks you to act, it may be ' },
      { t: 'hard to tell what changed.', mark: true },
    ],
  },
];

// Every word is its own inline-block so GSAP can move/fade it; plain spaces sit between them so text still wraps and reads normally.
function Words({ parts }) {
  return parts.map((part, i) => {
    const words = part.t.trim().split(/\s+/).map((w, j, all) => <React.Fragment key={j}><span className="bp-w">{w}</span>{j < all.length - 1 || !part.mark ? ' ' : null}</React.Fragment>);
    return part.mark ? <mark key={i} className="bp-mark">{words}</mark> : <React.Fragment key={i}>{words}</React.Fragment>;
  });
}

// ASCII art, one <span> per line so it can be typed in line by line. Decorative, so hidden from screen readers.
const Art = ({ lines, name }) => <pre className={`bp-art bp-art-${name}`} aria-hidden="true">{lines.map((l, i) => <span className="ln" key={i}>{l || ' '}{'\n'}</span>)}</pre>;

const EACH = 0.07;   // seconds of timeline between consecutive words
const WORD = 0.35;   // seconds each word takes to resolve
const DIM = 0;       // unwritten words are invisible. A dim ghost reads as muddy on black

// Adds "write this paragraph left → right" to a timeline at `at`, typing its ASCII art in alongside. Returns when it finishes.
function writeParagraph(tl, para, at, art) {
  const words = gsap.utils.toArray('.bp-w', para);
  const total = (words.length - 1) * EACH + WORD;
  tl.fromTo(words, { opacity: DIM, y: 10 }, { opacity: 1, y: 0, duration: WORD, ease: 'power2.out', stagger: EACH }, at);
  gsap.utils.toArray('.bp-mark', para).forEach(mark => {
    const inside = gsap.utils.toArray('.bp-w', mark);
    const start = at + words.indexOf(inside[0]) * EACH;
    tl.fromTo(mark, { backgroundSize: '0% 1.04em' }, { backgroundSize: '100% 1.04em', duration: inside.length * EACH + WORD, ease: 'none' }, start);
  });
  if (art) typeArt(tl, art, at, total);
  return at + total;
}

function typeArt(tl, art, at, total) {
  const lines = gsap.utils.toArray('.ln', art);
  tl.fromTo(lines, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none', stagger: Math.max(0.05, (total - 0.25) / Math.max(1, lines.length - 1)) }, at);
}

export default function Problem() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();

    // Desktop: pin, then one scrubbed timeline. Paragraph 1 is written, THEN paragraph 2 slides in from the left and is written.
    // Each paragraph types in the ASCII art that shares its row of the page.
    mm.add('(min-width: 901px) and (prefers-reduced-motion: no-preference)', () => {
      const [p1, p2] = q('.bp-p');
      const [chain, web3] = q('.bp-art');
      gsap.set(q('.bp-w'), { opacity: DIM });
      gsap.set(q('.bp-mark'), { backgroundSize: '0% 1.04em' });
      gsap.set(q('.ln'), { opacity: 0 });
      gsap.set(p2, { x: -90, autoAlpha: 0 });

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=170%', pin: true, scrub: 1, anticipatePin: 1 },
      });
      const end1 = writeParagraph(tl, p1, 0.05, chain);
      tl.to(p2, { x: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.out' }, end1 + 0.05);
      const end2 = writeParagraph(tl, p2, end1 + 0.3, web3);
      tl.to({}, { duration: 0.4 }, end2); // hold the finished page briefly before the pin releases
    });

    // Tablet / mobile: no pin. Each paragraph and each piece of art writes itself as it travels up the screen.
    mm.add('(max-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.set(q('.bp-w'), { opacity: DIM });
      gsap.set(q('.bp-mark'), { backgroundSize: '0% 1.04em' });
      gsap.set(q('.ln'), { opacity: 0 });
      q('.bp-p').forEach(p => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: p, start: 'top 85%', end: 'bottom 55%', scrub: 0.8 } });
        writeParagraph(tl, p, 0);
      });
      q('.bp-art').forEach(a => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: a, start: 'top 92%', end: 'bottom 62%', scrub: 0.8 } });
        typeArt(tl, a, 0, 2);
      });
    });

    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <div className="bp-wrap"><section className="bp" id="problem" ref={root} aria-label="The problem">
    <div className="bp-inner">
      <div className="bp-grid">
        {paragraphs.map(p => <p className={`bp-p bp-${p.side}`} key={p.id}><Words parts={p.parts} /></p>)}
        <Art lines={CHAIN} name="chain" />
        <Art lines={WEB3} name="web3" />
      </div>
    </div>
  </section></div>;
}
