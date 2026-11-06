import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Words } from '../lib/shared.jsx';
import './closing.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function Closing() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(q('.rv-w'), { opacity: 0, y: 36 }, { opacity: 1, y: 0, ease: 'none', stagger: 0.12, scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'center 50%', scrub: 0.6 } });
      gsap.fromTo(q('.cl-em'), { backgroundSize: '0% 38%' }, { backgroundSize: '100% 38%', ease: 'none', scrollTrigger: { trigger: root.current, start: 'top 55%', end: 'center 40%', scrub: 0.6 } });
      gsap.from(q('.cl-actions > *'), { autoAlpha: 0, y: 20, duration: 0.8, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.cl-actions')[0], start: 'top 92%', once: true } });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="cl" ref={root} aria-labelledby="closing-title">
    <div className="cl-inner">
      <h2 id="closing-title"><Words text="Confidence starts" /><br /><em className="cl-em"><Words text="with a better question." /></em></h2>
      <div className="cl-actions">
        <a className="cl-primary" href="/bound-extension.zip" download>Download extension <span aria-hidden="true">↓</span></a>
        <a className="cl-secondary" href="#top">Back to the beginning <span aria-hidden="true">↑</span></a>
      </div>
    </div>
  </section>;
}
