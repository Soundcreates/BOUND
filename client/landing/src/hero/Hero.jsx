import React, { useRef } from 'react';
import { Link } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { layers } from './layers.js';
import './hero.css';
// class prefix bh- keeps clear of the legacy .hero* rules in style.css

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Plate geometry (SVG units == CSS px at scale 1). 2:1 isometric diamond.
const W = 240, HALF = 60, T = 12;            // width, half diamond height, thickness
const GAP = 118;                              // vertical distance between plates when exploded
const TIGHT = 14;                             // distance when collapsed
const STACK_H = (layers.length - 1) * GAP + HALF * 2 + T;
const COLLAPSED_TOP = (STACK_H - ((layers.length - 1) * TIGHT + HALF * 2 + T)) / 2;
const collapsedY = i => COLLAPSED_TOP + i * TIGHT - i * GAP;
const centerY = i => i * GAP + HALF;          // plate centre (where the scan "hits")

// The packet starts at y = -40, hits each plate centre, then leaves the stack below the last plate.
const LAST = centerY(layers.length - 1);
const EXIT = LAST + HALF + T + 90;
const SPAN = EXIT + 40;
const frac = y => (y + 40) / SPAN;            // 0..1 position of a y along the packet's path

const C = { paper: '#ffffff', side: '#f1f1ec', sideDark: '#e3e3dc', accent: '#ffd500', accentSoft: '#fff4b8', accentSide: '#e8bf00' };

// Splatter droplets per impact (radii), and the black ink that floods the screen after the last layer.
const SPLAT = [8, 6, 4.6, 4, 3.4, 2.9, 2.6, 2.3, 2, 6.6, 5.2, 4.2, 3.6, 3.1, 2.6, 2.2, 1.9, 4.8, 3.8, 3, 2.5, 2, 5.6, 3.5];
// [cx, cy, final radius, start delay] in a 1440×900 space. Centres sit on the left and right edges.
const BLOBS = [
  [-60, 70, 820, 0], [-60, 300, 900, 0.18], [-40, 520, 860, 0.06], [-60, 760, 900, 0.24], [-40, 940, 820, 0.12],
  [1500, 120, 840, 0.1], [1500, 340, 900, 0], [1480, 560, 860, 0.2], [1500, 780, 900, 0.08], [1480, 960, 820, 0.26],
  [720, -120, 760, 0.7], [720, 1020, 760, 0.75],
];
// Loose drops thrown ahead of the main mass: [cx, cy, r].
const DROPS = [
  [150, 120, 14], [90, 340, 10], [210, 470, 18], [120, 640, 12], [260, 780, 9], [330, 220, 8], [60, 520, 7], [300, 360, 11],
  [1290, 160, 13], [1350, 400, 9], [1230, 520, 17], [1320, 700, 11], [1180, 820, 8], [1110, 280, 10], [1380, 590, 7], [1140, 430, 12],
];

function Plate({ index }) {
  const pts = (...p) => p.map(([x, y]) => `${x},${y}`).join(' ');
  return <svg className="plate" viewBox={`-1 -1 ${W + 2} ${HALF * 2 + T + 2}`} width={W + 2} height={HALF * 2 + T + 2} aria-hidden="true">
    <polygon className="plate-left" fill={C.side} points={pts([0, HALF], [W / 2, HALF * 2], [W / 2, HALF * 2 + T], [0, HALF + T])} />
    <polygon className="plate-right" fill={C.sideDark} points={pts([W / 2, HALF * 2], [W, HALF], [W, HALF + T], [W / 2, HALF * 2 + T])} />
    <polygon className="plate-top" fill={C.paper} points={pts([W / 2, 0], [W, HALF], [W / 2, HALF * 2], [0, HALF])} />
    <polygon className="plate-inset" points={pts([W / 2, 14], [W - 28, HALF], [W / 2, HALF * 2 - 14], [28, HALF])} />
    {/* text laid flat on the top face: u-axis runs left corner → top corner */}
    <g transform={`matrix(1.2 -0.6 1.2 0.6 0 ${HALF})`}>
      <text className="plate-num" x="16" y="58">{String(index + 1).padStart(2, '0')}</text>
    </g>
    <circle className="plate-dot" cx={W / 2} cy={HALF} r="4" />
    <circle className="plate-ring" cx={W / 2} cy={HALF} r="4" />
  </svg>;
}

function LayerStack() {
  return <div className="stack-box" style={{ '--stack-h': `${STACK_H}px` }} role="img" aria-label={`BOUND security layers: ${layers.map(l => l.title).join(', ')}`}>
    <div className="stack-float">
      <div className="stack">
        <div className="stack-status"><span /> Decision shown before you sign</div>
        {layers.map((layer, i) => <div className="layer" key={layer.id} style={{ top: i * GAP, zIndex: layers.length - i }}>
          <Plate index={i} />
          <div className="layer-label" style={{ top: HALF }}>
            <i className="layer-leader" />
            <div>
              <span className="layer-tag">{layer.tag}</span>
              <strong>{layer.title}</strong>
              <p>{layer.text}</p>
            </div>
          </div>
        </div>)}
        <div className="scan-beam" style={{ height: SPAN }} />
        {/* One splatter pool per layer, centred where the beam meets that plate. Hidden until an impact. */}
        <svg className="splat" aria-hidden="true">
          {layers.map((layer, i) => <g className="splat-g" key={layer.id} transform={`translate(${W / 2} ${centerY(i)})`}>
            <ellipse className="shock" rx="0" ry="0" />
            {SPLAT.map((r, k) => <circle className="sp" key={k} r={r} />)}
          </g>)}
        </svg>
        <div className="scan-packet" />
      </div>
    </div>
  </div>;
}

export default function Hero({ Logo, Arrow, menu, setMenu }) {
  const root = useRef(null);
  const close = () => setMenu(false);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();

    // Intro, every layout: copy rises in, plates drop onto the stack bottom-first.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .from(q('.bh-reveal'), { yPercent: 110, autoAlpha: 0, duration: 1.2, stagger: 0.08 })
        .from(q('.plate'), { y: -70, autoAlpha: 0, duration: 1.1, stagger: { each: 0.09, from: 'end' } }, 0.15)
        .fromTo(q('.bh-copy mark'), { backgroundSize: '0% 42%' }, { backgroundSize: '100% 42%', duration: 1, ease: 'power3.inOut' }, 0.7);
      gsap.to(q('.stack-float'), { y: -10, duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    });

    // Desktop: pin the hero and scrub the story: collapse → explode → scan (each layer hits back) → ink floods the screen.
    mm.add('(min-width: 901px) and (prefers-reduced-motion: no-preference)', () => {
      const layerEls = q('.layer');
      const labels = q('.layer-label');
      const shaker = q('.bh-inner')[0];
      const pools = q('.splat-g');
      const blobs = q('.ink-blob');
      const drops = q('.ink-drop');
      gsap.set(layerEls, { y: i => collapsedY(i) });
      gsap.set(labels, { autoAlpha: 0, x: -14, '--label-bar': '#e6e6e1' });
      gsap.set(q('.stack-status'), { autoAlpha: 0, y: 12 });
      gsap.set(q('.scan-beam'), { scaleY: 0 });
      gsap.set(q('.scan-packet'), { autoAlpha: 0, y: -40, rotation: 45 });

      // A hit on a layer. Runs in real time (not scrubbed) so it lands with force however fast you scroll.
      const impact = (i) => {
        const amp = 4 + i * 2.4;
        gsap.fromTo(shaker, { x: 0, y: 0, rotation: 0 }, {
          keyframes: [
            { x: -amp, y: amp * 0.45, rotation: -0.22, duration: 0.05 },
            { x: amp * 0.9, y: -amp * 0.5, rotation: 0.2, duration: 0.06 },
            { x: -amp * 0.6, y: amp * 0.3, rotation: -0.1, duration: 0.06 },
            { x: amp * 0.35, y: -amp * 0.2, rotation: 0.05, duration: 0.07 },
            { x: 0, y: 0, rotation: 0, duration: 0.14 },
          ],
          ease: 'power1.out', overwrite: 'auto',
        });
        const g = pools[i];
        const dots = gsap.utils.toArray('.sp', g);
        dots.forEach((d, k) => {
          const a = (k / dots.length) * Math.PI * 2 + gsap.utils.random(-0.3, 0.3);
          const speed = gsap.utils.random(70, 215);
          const x = Math.cos(a) * speed, y = Math.sin(a) * speed * 0.5, lift = gsap.utils.random(20, 95);
          gsap.fromTo(d, { x: 0, y: 0, scale: 1, opacity: 1 }, {
            keyframes: { x: [0, x * 0.7, x], y: [0, y - lift, y + 34], scale: [1, 1, 0.15], opacity: [1, 1, 0], easeEach: 'power1.out' },
            duration: gsap.utils.random(0.75, 1.25), ease: 'none', overwrite: 'auto',
          });
        });
        gsap.fromTo(gsap.utils.toArray('.shock', g), { attr: { rx: 6, ry: 3 }, opacity: 1, strokeWidth: 4 }, { attr: { rx: 150, ry: 75 }, opacity: 0, strokeWidth: 0.5, duration: 0.85, ease: 'power2.out', overwrite: 'auto' });
        gsap.fromTo(layerEls[i].querySelector('.plate'), { scaleY: 0.88, transformOrigin: '50% 80%' }, { scaleY: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)', overwrite: 'auto' });
      };

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=470%', pin: true, scrub: 1, anticipatePin: 1 },
      });

      tl.addLabel('explode')
        .to(layerEls, { y: 0, duration: 3, stagger: 0.12 }, 'explode')
        .to(labels, { autoAlpha: 1, x: 0, duration: 1.4, stagger: 0.25 }, 'explode+=1.4')
        .to(q('.bh-copy'), { y: -24, duration: 3 }, 'explode')
        .addLabel('scan', '+=0.3');

      // One packet travels down the beam. Each plate lights up, shakes the screen and splatters as the packet reaches its centre.
      const SCAN = 7;
      tl.set(q('.scan-packet'), { autoAlpha: 1 }, 'scan')
        .to(q('.scan-packet'), { y: EXIT, duration: SCAN, ease: 'none' }, 'scan')
        .to(q('.scan-beam'), { scaleY: 1, duration: SCAN, ease: 'none' }, 'scan');
      layerEls.forEach((el, i) => {
        const at = `scan+=${SCAN * frac(centerY(i))}`;
        const s = gsap.utils.selector(el);
        tl.to(s('.plate-top'), { fill: C.accent, duration: 0.35 }, at)
          .to(s('.plate-left, .plate-right'), { fill: C.accentSide, duration: 0.35 }, at)
          .fromTo(s('.plate-ring'), { attr: { r: 4 }, autoAlpha: 1 }, { attr: { r: 34 }, autoAlpha: 0, duration: 0.9, ease: 'power2.out' }, at)
          .to(s('.layer-label'), { '--label-bar': C.accent, duration: 0.3 }, at)
          .to(s('.plate-top'), { fill: C.accentSoft, duration: 0.6 }, `${at}+=0.7`)
          .to(s('.plate-left'), { fill: C.side, duration: 0.6 }, `${at}+=0.7`)
          .to(s('.plate-right'), { fill: C.sideDark, duration: 0.6 }, `${at}+=0.7`)
          .call(impact, [i], at);
      });

      // The packet crosses the last plate and leaves the stack. Then black ink is thrown in from both sides.
      tl.addLabel('exit', `scan+=${SCAN * frac(LAST + HALF + T)}`)
        .to(q('.stack-status'), { autoAlpha: 1, y: 0, duration: 0.6, ease: 'back.out(2)' }, 'exit')
        .to(q('.scan-packet'), { autoAlpha: 0, duration: 0.4 }, `scan+=${SCAN - 0.4}`)
        .addLabel('ink', 'exit+=0.3');

      const INK = 6.5;
      drops.forEach((el, i) => tl.fromTo(el, { attr: { r: 0 } }, { attr: { r: DROPS[i][2] }, duration: 0.5, ease: 'back.out(3)' }, `ink+=${(i % 8) * 0.07}`));
      blobs.forEach((el, i) => tl.fromTo(el, { attr: { r: 0 } }, { attr: { r: BLOBS[i][2] }, duration: INK, ease: 'none' }, `ink+=${0.25 + BLOBS[i][3]}`));
      tl.fromTo(q('.ink-fill'), { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'none' }, `ink+=${INK - 0.1}`)
        .to({}, { duration: 0.15 }); // the Problem page is already in place under the end of this pin, so no long hold
    });

    // Mobile / tablet: no pin — the stack sits under the copy.
    mm.add('(max-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
      // TODO(human)
    });

    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  return <section className="bh" id="top" ref={root} aria-labelledby="bh-title">
    <div className="bh-inner">
      <header className="bh-nav">
        <Logo />
        <nav className={menu ? 'bh-links open' : 'bh-links'} id="bh-links" aria-label="Main navigation">
          <a href="#problem" onClick={close}>The problem</a>
          <a href="#record" onClick={close}>The record</a>
          <a href="#how" onClick={close}>How it works</a>
          <a href="#simulation" onClick={close}>Simulation</a>
          <Link to="/testing" onClick={close}>Testing</Link>
          <a href="#stack" onClick={close}>Technology</a>
          <a className="bh-mobile-only" href="#demo" onClick={close}>Watch the demo</a>
          <a className="bh-mobile-only" href="/bound-extension.zip" download onClick={close}>Download extension</a>
        </nav>
        <a className="bh-download" href="/bound-extension.zip" download>Download extension <span aria-hidden="true">↓</span></a>
        <button className="bh-menu" type="button" aria-controls="bh-links" aria-expanded={menu} aria-label={menu ? 'Close navigation' : 'Open navigation'} onClick={() => setMenu(!menu)}>{menu ? 'Close' : 'Menu'}</button>
      </header>

      <div className="bh-body">
        <div className="bh-copy">
          <div className="mask"><h1 id="bh-title" className="bh-reveal">BOUND</h1></div>
          <div className="mask"><p className="bh-reveal">The address looks familiar. The site looks right. But what if <mark>something behind it has changed?</mark></p></div>
          <div className="mask"><div className="bh-actions bh-reveal">
            <a className="bh-primary" href="#simulation">See BOUND in action <span className="bh-primary-icon" aria-hidden="true">↗</span></a>
            <a className="bh-secondary" href="#how">Explore how it works <Arrow /></a>
          </div></div>
          <div className="mask"><a className="bh-record bh-reveal" href="#record">Five documented compromises, 2021–2025 <b aria-hidden="true">↓</b></a></div>
        </div>
        <div className="bh-visual"><LayerStack /></div>
      </div>
    </div>

    {/* Black ink thrown in from the sides. The goo filter merges the circles into one liquid mass. */}
    <div className="bh-ink" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="bh-goo" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" />
          </filter>
        </defs>
        <g filter="url(#bh-goo)" fill="#0b0b0c">
          {DROPS.map(([cx, cy], i) => <circle className="ink-drop" key={`d${i}`} cx={cx} cy={cy} r="0" />)}
          {BLOBS.map(([cx, cy], i) => <circle className="ink-blob" key={`b${i}`} cx={cx} cy={cy} r="0" />)}
        </g>
        <rect className="ink-fill" width="1440" height="900" fill="#0b0b0c" opacity="0" />
      </svg>
    </div>
  </section>;
}
