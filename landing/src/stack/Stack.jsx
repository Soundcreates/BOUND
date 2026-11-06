import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Proof from '../proof/Proof.jsx';
import './stack.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// `proof` lists the documented incidents that bear on each piece. Anon-RPC has none: it is about privacy, not integrity.
const items = [
  { id: 'extension', title: 'Browser extension', text: 'A context layer where people already browse.', tag: 'Chromium · EIP-1193', proof: ['badger', 'ledger', 'bybit'] },
  { id: 'ens', title: 'ENS', text: 'A verifiable starting point for trusted references.', tag: 'Identity · Reference', proof: ['curve', 'squarespace'] },
  { id: 'arkiv', title: 'Arkiv', text: 'Public records and snapshots that can be checked.', tag: 'Records · Storage', proof: ['curve', 'squarespace'] },
  { id: 'anon', title: 'Anon-RPC', text: 'A privacy-minded route for eligible chain reads.', tag: 'Private lookups', proof: [] },
];

// Line icons. Ink strokes with one yellow piece each, so they match the rest of the page.
function Icon({ id }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinejoin: 'round', strokeLinecap: 'round' };
  return <svg className="st-icon" viewBox="0 0 64 64" aria-hidden="true">
    {id === 'extension' && <><rect {...common} x="9" y="9" width="46" height="46" rx="10" /><rect {...common} className="y" x="22" y="22" width="20" height="20" rx="4" /></>}
    {id === 'ens' && <><path {...common} d="M32 6 58 32 32 58 6 32Z" /><path {...common} className="y" d="M32 19 45 32 32 45 19 32Z" /></>}
    {id === 'arkiv' && <><rect {...common} x="10" y="10" width="18" height="44" rx="4" /><rect {...common} className="y" x="36" y="10" width="18" height="44" rx="4" /><path {...common} d="M15 22h8M15 30h8M41 22h8M41 30h8" /></>}
    {id === 'anon' && <><circle {...common} cx="32" cy="32" r="23" /><circle {...common} className="y" cx="32" cy="32" r="11" /><circle cx="32" cy="32" r="2.6" fill="currentColor" /></>}
  </svg>;
}

export default function Stack() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(q('.st-head > *'), { autoAlpha: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.st-head')[0], start: 'top 85%', once: true } });
      gsap.set(q('.st-card'), { autoAlpha: 0, y: 56 });
      ScrollTrigger.batch(q('.st-card'), { start: 'top 90%', once: true, onEnter: els => gsap.to(els, { autoAlpha: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.12 }) });
      // Each icon draws itself once its card is in.
      q('.st-card').forEach(card => gsap.from(gsap.utils.toArray('.st-icon *', card), { strokeDasharray: 200, strokeDashoffset: 200, duration: 1.4, ease: 'power2.out', stagger: 0.1, scrollTrigger: { trigger: card, start: 'top 88%', once: true } }));
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="st" id="stack" ref={root} aria-labelledby="stack-title">
    <div className="st-inner">
      <header className="st-head">
        <h2 id="stack-title">Built on open<br /><em>infrastructure.</em></h2>
        <p>Different tools, one purpose: make information about the sites you use easier to verify.</p>
      </header>
      <div className="st-grid">
        {items.map(item => <article className="st-card" key={item.id}>
          <Icon id={item.id} />
          <h3>{item.title}</h3>
          <p>{item.text}</p>
          <span className="st-tag">{item.tag}</span>
          {item.proof.length > 0 && <Proof ids={item.proof} />}
        </article>)}
      </div>
      <p className="st-note">Technologies shown reflect the project architecture; their live integration and privacy properties require verification.</p>
    </div>
  </section>;
}
