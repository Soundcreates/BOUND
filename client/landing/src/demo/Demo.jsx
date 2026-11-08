import React, { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import './demo.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// A YouTube id comes from VITE_DEMO_VIDEO_ID. Without a valid one the frame says the video is coming, and nothing fake is shown.
const rawId = import.meta.env.VITE_DEMO_VIDEO_ID?.trim();
const videoId = rawId && /^[A-Za-z0-9_-]{11}$/.test(rawId) ? rawId : null;

export default function Demo() {
  const root = useRef(null);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(q('.dm-head > *'), { autoAlpha: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.dm-head')[0], start: 'top 85%', once: true } });
      // The frame grows into place as it arrives.
      gsap.fromTo(q('.dm-frame'), { scale: 0.9, y: 50, autoAlpha: 0.4 }, { scale: 1, y: 0, autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: q('.dm-frame')[0], start: 'top 95%', end: 'top 45%', scrub: 0.6 } });
      gsap.from(q('.dm-steps li'), { autoAlpha: 0, x: -24, duration: 0.8, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: q('.dm-install')[0], start: 'top 82%', once: true } });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="dm" id="demo" ref={root} aria-labelledby="demo-title">
    <div className="dm-inner">
      <header className="dm-head">
        <h2 id="demo-title">See the full<br /><em>story unfold.</em></h2>
        <p>A closer look at the problem, the proposed approach, and the experience BOUND is working towards.</p>
      </header>

      <div className="dm-frame">
        {videoId
          ? <iframe title="BOUND project demo" src={`https://www.youtube-nocookie.com/embed/${videoId}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
          : <div className="dm-placeholder">
              <span className="dm-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5Z" /></svg></span>
              <h3>The full picture,<br />coming into focus.</h3>
              <p>Demo video coming soon.</p>
            </div>}
      </div>

      <div className="dm-install">
        <div>
          <h3>Try the extension prototype</h3>
          <p>Configuration is required, and live integrations are still being verified.</p>
          <a className="dm-download" href="/bound-extension.zip" download>Download extension <span aria-hidden="true">↓</span></a>
        </div>
        <ol className="dm-steps">
          <li><span>Extract the downloaded ZIP.</span></li>
          <li><span>Open <code>chrome://extensions</code> or <code>edge://extensions</code> and turn on Developer mode.</span></li>
          <li><span>Select <b>Load unpacked</b> and choose the extracted folder that contains <code>manifest.json</code>.</span></li>
        </ol>
      </div>
    </div>
  </section>;
}
