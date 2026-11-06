import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Words } from '../lib/shared.jsx';
import './idea.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// The one big yellow statement between the record and the architecture.
export default function Idea() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // The statement writes itself in as it crosses the screen, word by word.
      gsap.fromTo(q('.rv-w'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, ease: 'none', stagger: 0.08, scrollTrigger: { trigger: root.current, start: 'top 72%', end: 'center 42%', scrub: 0.6 } });
      // The logo's four-square mark turns slowly behind it.
      gsap.fromTo(q('.idea-mark'), { rotate: -30, scale: 0.9, transformOrigin: '50% 50%' }, { rotate: 30, scale: 1.08, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="idea" ref={root} aria-labelledby="idea-title">
    <svg className="idea-mark" viewBox="0 0 200 200" aria-hidden="true">
      <rect x="4" y="4" width="88" height="88" rx="6" />
      <rect x="108" y="4" width="88" height="88" rx="6" className="solid" />
      <rect x="4" y="108" width="88" height="88" rx="6" />
      <rect x="108" y="108" width="88" height="88" rx="6" />
    </svg>
    <div className="idea-inner">
      <h2 id="idea-title"><Words text="Security should help you" /><br /><em><Words text="understand the moment." /></em></h2>
      <p><Words text="BOUND is built around a simple idea: compare what you're seeing with independently verifiable information, then make the result easier to understand." /></p>
    </div>
  </section>;
}
