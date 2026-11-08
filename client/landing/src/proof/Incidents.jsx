import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { incidents, outOfScope } from './incidents.js';
import './proof.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

function Sources({ list }) {
  return <ul className="pf-sources" aria-label="Sources">
    {list.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}<span aria-hidden="true"> ↗</span></a></li>)}
  </ul>;
}

// Jump to the simulation with this incident preselected. ToyOS listens for the event.
const replay = (id) => window.dispatchEvent(new CustomEvent('bound:replay', { detail: { id } }));

export default function Incidents() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // The yellow rail "draws" down the record as you read it.
      gsap.fromTo(q('.pf-rail-fill'), { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: q('.pf-list')[0], start: 'top 70%', end: 'bottom 70%', scrub: 0.6 } });
      gsap.set(q('.pf-card'), { autoAlpha: 0, y: 48 });
      ScrollTrigger.batch(q('.pf-card'), {
        start: 'top 86%', once: true,
        onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.12 }),
      });
      gsap.from(q('.pf-head > *'), { autoAlpha: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.pf-head')[0], start: 'top 85%', once: true } });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="pf" id="record" ref={root} aria-labelledby="record-title">
    <div className="pf-inner">
      <header className="pf-head">
        <h2 id="record-title">It already happened.<br /><em>Five times, in public.</em></h2>
        <p>Each of these compromised the page, the domain or a library while the contracts stayed intact. All of them happened before BOUND existed. Facts below come from the linked reporting; where sources disagree, the range is shown.</p>
      </header>

      <div className="pf-list">
        <span className="pf-rail" aria-hidden="true"><span className="pf-rail-fill" /></span>
        {incidents.map((i) => <article className="pf-card" id={`incident-${i.id}`} key={i.id}>
          <div className="pf-top">
            <div className="pf-year"><span>{i.year}</span><small>{i.when}</small></div>
            <div className="pf-main">
              <span className="pf-vector">{i.vector}</span>
              <h3>{i.name}</h3>
              <p className="pf-headline">{i.headline}</p>
            </div>
            <div className="pf-loss"><small>Reported loss</small><strong>{i.loss}</strong><span>{i.lossNote}</span></div>
          </div>
          <p className="pf-what">{i.what}</p>
          <div className="pf-trio">
            <div><small>What the user saw</small><p>{i.seen}</p></div>
            <div className="pf-lens"><small>What BOUND would compare</small><p>{i.lens}</p></div>
            <div><small>Honest limit</small><p>{i.limit}</p></div>
          </div>
          <div className="pf-foot">
            <Sources list={i.sources} />
            <a className="pf-replay" href="#simulation" onClick={() => replay(i.scenario)}>Replay in the simulation <span aria-hidden="true">↓</span></a>
          </div>
        </article>)}

        <article className="pf-card pf-out" id={`incident-${outOfScope.id}`}>
          <div className="pf-top">
            <div className="pf-year"><span>—</span><small>{outOfScope.when}</small></div>
            <div className="pf-main">
              <span className="pf-vector">Not in scope</span>
              <h3>{outOfScope.name}</h3>
              <p className="pf-headline">Some compromises never reach a wallet prompt.</p>
            </div>
            <div className="pf-loss"><small>Reported loss</small><strong>{outOfScope.loss}</strong></div>
          </div>
          <p className="pf-what">{outOfScope.text}</p>
          <div className="pf-foot"><Sources list={outOfScope.sources} /></div>
        </article>
      </div>
      <p className="pf-note">BOUND adds context to a wallet request. It does not guarantee a site or transaction is safe, and the comparisons above are analysis, not proof of prevention.</p>
    </div>
  </section>;
}
