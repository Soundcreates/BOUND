import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { NODES, STEPS } from './model.js';
import Proof from '../proof/Proof.jsx';
import './arch.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function Architecture() {
  const root = useRef(null);
  const canvas = useRef(null);
  const diagram = useRef(null);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const activeRef = useRef(0);

  // Konva is ~300 KB, so it loads on demand instead of with the first paint. An IntersectionObserver
  // (not a scroll position) starts the entrance, so it still fires if the page jumps straight here.
  useEffect(() => {
    let alive = true, d, io;
    import('./konvaDiagram.js').then(({ Diagram }) => {
      if (!alive || !canvas.current) return;
      d = new Diagram(canvas.current, { onSelect: setSelected, reduced });
      diagram.current = d;
      d.setStep(activeRef.current);
      requestAnimationFrame(() => ScrollTrigger.refresh()); // the canvas just gave the page its real height
      io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { d.intro(); io.disconnect(); } }, { threshold: 0.12 });
      io.observe(canvas.current);
    });
    return () => { alive = false; io?.disconnect(); d?.destroy(); diagram.current = null; };
  }, [reduced]);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    // Each step block drives the diagram while it is near the middle of the screen.
    q('.ar-step').forEach((el, i) => {
      ScrollTrigger.create({ trigger: el, start: 'top 58%', end: 'bottom 58%', onToggle: (self) => { if (self.isActive) { activeRef.current = i; setActive(i); diagram.current?.setStep(i); } } });
    });
    // Entrance: start as soon as the diagram's block is on screen, however the page got here.
    ScrollTrigger.create({ trigger: q('.ar-grid')[0], start: 'top 88%', end: 'bottom top', onUpdate: (self) => { if (self.isActive) diagram.current?.intro(); } });
    if (!reduced) {
      gsap.from(q('.ar-head > *'), { autoAlpha: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.ar-head')[0], start: 'top 85%', once: true } });
    }
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root, dependencies: [reduced] });

  const jump = (i) => { activeRef.current = i; setActive(i); diagram.current?.setStep(i); };
  const node = selected ? NODES[selected] : null;

  return <section className="ar" id="how" ref={root} aria-labelledby="how-title">
    <div className="ar-inner">
      <header className="ar-head">
        <h2 id="how-title">A second opinion,<br /><em>from outside the page.</em></h2>
        <p>Follow one wallet request from the page to your decision. Scroll the steps, or select any box to see what it does, what it trusts and how it can fail.</p>
      </header>

      <div className="ar-grid">
        <ol className="ar-steps">
          {STEPS.map((s, i) => <li key={s.id} className={`ar-step${i === active ? ' is-active' : ''}`} data-step={i}>
            <button type="button" className="ar-step-btn" onClick={() => jump(i)} aria-current={i === active ? 'step' : undefined}>
              <span className="ar-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="ar-step-title">{s.title}</span>
            </button>
            <p>{s.text}</p>
            {s.proof.length > 0 && <Proof ids={s.proof} />}
          </li>)}
        </ol>

        <div className="ar-stage">
          <div className="ar-card">
            <div className="ar-canvas" ref={canvas} role="img" aria-label="Architecture diagram: a website request flows through BOUND's hook, decoder and policy core, supported by ENS, Swarm, Arkiv and Anon-RPC evidence, to a review window and then your wallet." />
            <div className="ar-inspector" aria-live="polite">
              {node
                ? <>
                    <div className="ar-insp-head"><b>{node.title}</b><span>{node.sub}</span></div>
                    <dl>
                      <div><dt>What it does</dt><dd>{node.does}</dd></div>
                      <div><dt>What it trusts</dt><dd>{node.trust}</dd></div>
                      <div><dt>How it can fail</dt><dd>{node.fails}</dd></div>
                    </dl>
                  </>
                : <p className="ar-hint">Select any box to inspect it.</p>}
            </div>
          </div>
        </div>
      </div>
      <p className="ar-note">This diagram shows the project’s architecture. Live integrations and browser coverage are still being verified, and BOUND adds context to a request rather than guaranteeing it is safe.</p>
    </div>
  </section>;
}
