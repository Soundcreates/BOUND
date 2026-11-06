import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Lenis from 'lenis';
import './style.css';

const Arrow = ({ diagonal = false }) => <span aria-hidden="true" className="arrow">{diagonal ? '↗' : '→'}</span>;
const Logo = () => <a className="logo" href="#top" aria-label="BOUND home"><span className="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>bound<span className="logo-dot">.</span></a>;

function SiteIllustration() {
  return <div className="hero-art" aria-label="Illustration of BOUND comparing a site with a trusted reference">
    <div className="art-grid" />
    <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
    <span className="art-caption top-caption"><span className="tiny-dot" /> LIVE VERIFICATION</span>
    <div className="browser-card">
      <div className="browser-top"><span className="browser-dots"><i /><i /><i /></span><span className="browser-url"><span className="lock-icon">⌑</span> app.example.org</span><span className="browser-more">···</span></div>
      <div className="browser-content"><div className="mini-label">YOUR WEB3 APP</div><div className="mini-title">A familiar place.<br /><span>A different story.</span></div><div className="mini-skeleton long" /><div className="mini-skeleton short" /><div className="mini-cta">Connect wallet <Arrow /></div></div>
    </div>
    <div className="scan-line" />
    <div className="result-card"><div className="result-symbol">✳</div><div><span className="mini-label">BOUND CHECK</span><strong>Something changed.</strong><small>Take a closer look before connecting.</small></div><span className="result-indicator" /></div>
    <span className="art-caption bottom-caption">AN INDEPENDENT LAYER OF CONTEXT <span>01 / 03</span></span>
  </div>;
}

const scenarioSteps = {
  without: [
    { title: 'You open a familiar site', detail: 'The address looks right. The interface looks like the one you know.', node: 'SITE', state: 'normal' },
    { title: 'The page has been changed', detail: 'A compromised frontend can ask your wallet for something unexpected.', node: 'SITE', state: 'changed' },
    { title: 'The wallet prompt arrives', detail: 'Without more context, the change can be easy to miss.', node: 'WALLET', state: 'risk' }
  ],
  with: [
    { title: 'You open a familiar site', detail: 'BOUND starts checking the site and its available trusted reference.', node: 'SITE', state: 'normal' },
    { title: 'BOUND finds a difference', detail: 'The observed page is compared with the reference. A mismatch needs attention.', node: 'BOUND', state: 'checking' },
    { title: 'You get a clear warning', detail: 'You can pause and decide what to do next. Your wallet stays in your control.', node: 'ALERT', state: 'alert' }
  ]
};

function Simulation() {
  const [mode, setMode] = useState('without');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const items = scenarioSteps[mode];
  useEffect(() => {
    if (!playing) return;
    if (step >= items.length - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => setStep(value => value + 1), 1700);
    return () => window.clearTimeout(id);
  }, [playing, step, items.length]);
  const choose = value => { setMode(value); setStep(0); setPlaying(false); };
  const play = () => { if (step === items.length - 1) setStep(0); setPlaying(true); };
  return <section className="section simulation-section" id="simulation"><div className="container"><div className="section-heading sim-heading"><div><span className="kicker"><span>03</span> / SEE IT IN ACTION</span><h2>Same site.<br /><em>Different context.</em></h2></div><p>A familiar address isn't the whole story. Explore an illustrative scenario and see where BOUND adds context.</p></div>
    <div className="simulation-shell"><div className="simulation-toolbar"><div className="scenario-tabs" role="group" aria-label="Choose a simulation"><button type="button" aria-pressed={mode === 'without'} onClick={() => choose('without')}>Without BOUND</button><button type="button" aria-pressed={mode === 'with'} onClick={() => choose('with')}>With BOUND</button></div><span className="demo-tag"><span /> INTERACTIVE EXAMPLE</span></div>
      <div className="simulation-body"><div className="sim-copy"><span className="sim-step">SCENARIO {mode === 'without' ? '01' : '02'} <span>/</span> 0{step + 1}</span><h3>{items[step].title}</h3><p aria-live="polite">{items[step].detail}</p><div className="sim-controls"><button className="play-button" type="button" onClick={play}>{playing ? 'Playing…' : step === 2 ? 'Replay scenario' : 'Play scenario'} <Arrow /></button><button className="step-button" type="button" onClick={() => { setPlaying(false); setStep((step + 1) % items.length); }}>Next step <Arrow /></button></div><div className="step-dots" aria-label={`Step ${step + 1} of 3`}>{items.map((item, index) => <button key={item.title} type="button" className={index === step ? 'active' : ''} onClick={() => { setPlaying(false); setStep(index); }} aria-label={`Show step ${index + 1}: ${item.title}`} aria-current={index === step ? 'step' : undefined} />)}</div></div>
      <div className={`sim-visual ${mode} state-${items[step].state}`}><div className="sim-browser"><div className="sim-browser-top"><span className="browser-dots"><i /><i /><i /></span><span>app.example.org</span><span>⌑</span></div><div className="sim-browser-main"><span className="sim-app-icon">✳</span><strong>example<span>.</span></strong><div className="sim-app-lines"><i /><i /><i /></div><div className="sim-app-button">Connect wallet <Arrow /></div></div></div><div className="sim-overlay" key={`${mode}-${step}`}><span className="sim-overlay-icon">{step === 0 ? '↗' : mode === 'with' ? '✳' : '!'}</span><div><small>{items[step].node}</small><strong>{step === 0 ? 'Site loaded' : mode === 'with' ? step === 1 ? 'Checking reference' : 'Difference detected' : step === 1 ? 'Page modified' : 'Request received'}</strong></div></div><div className="sim-corner">BOUND LAB / 0{step + 1}</div></div></div>
    </div><p className="simulation-note">Illustrative simulation. BOUND provides context; it does not guarantee a site or transaction is safe.</p></div></section>;
}

const architecture = [
  { n:'01', title:'The site you visit', text:'The browser identifies the actual site and gathers available page evidence.', tag:'BROWSER' },
  { n:'02', title:'A reference to compare', text:'ENS points to a trusted reference. Arkiv stores public, verifiable records.', tag:'ENS + ARKIV' },
  { n:'03', title:'A clearer signal', text:'BOUND compares what is available and presents a concise status in the browser.', tag:'BOUND' }
];

const stack = [ ['01', 'Browser extension', 'A context layer where people already browse.', 'CHROMIUM · EIP-1193'], ['02', 'ENS', 'A verifiable starting point for trusted references.', 'IDENTITY · REFERENCE'], ['03', 'Arkiv', 'Public records and snapshots that can be checked.', 'RECORDS · STORAGE'], ['04', 'Anon-RPC', 'A privacy-minded route for eligible chain reads.', 'PRIVATE LOOKUPS'] ];

function App() {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let scrolling;
    const update = () => {
      scrolling?.destroy();
      scrolling = preference.matches ? undefined : new Lenis({ autoRaf: true, anchors: true });
    };
    update();
    preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); scrolling?.destroy(); };
  }, []);
  const videoId = import.meta.env.VITE_DEMO_VIDEO_ID?.trim();
  const validVideoId = videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  return <><a href="#main" className="skip-link">Skip to content</a><header className="site-header" id="top"><div className="nav-inner"><Logo /><nav className={menu ? 'nav-links open' : 'nav-links'} aria-label="Main navigation"><a href="#problem" onClick={() => setMenu(false)}>The problem</a><a href="#how" onClick={() => setMenu(false)}>How it works</a><a href="#simulation" onClick={() => setMenu(false)}>Simulation</a><a href="#stack" onClick={() => setMenu(false)}>Technology</a><a className="mobile-nav-link" href="#demo" onClick={() => setMenu(false)}>Watch the demo</a><a className="mobile-nav-link" href="/bound-extension.zip" download onClick={() => setMenu(false)}>Download extension</a></nav><div className="nav-actions"><a className="nav-cta" href="#demo">Watch the demo <Arrow diagonal /></a><a className="nav-download" href="/bound-extension.zip" download>Download extension <span aria-hidden="true">↓</span></a></div><button className="menu-button" type="button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? 'Close' : 'Menu'}</button></div></header>
  <main id="main"><section className="hero"><div className="container hero-grid"><div className="hero-copy"><span className="hero-eyebrow"><span /> A SAFER WAY TO NAVIGATE WEB3</span><h1>Trust what<br />you <span>connect to.</span></h1><p>The address looks familiar. The site looks right. But what if something behind it has changed?</p><div className="hero-actions"><a className="button primary" href="#simulation">See BOUND in action <Arrow diagonal /></a><a className="text-link" href="#how">Explore how it works <Arrow /></a></div><div className="hero-footnote"><span className="asterisk">✳</span><span>A browser security project for a more<br />transparent Web3 experience.</span></div></div><SiteIllustration /></div><div className="container hero-bottom"><span>INDEPENDENT CONTEXT FOR EVERYDAY DECISIONS</span><a href="#problem">SCROLL TO EXPLORE <span>↓</span></a></div></section>

  <section className="section problem-section" id="problem"><div className="container"><div className="section-heading"><div><span className="kicker"><span>01</span> / THE PROBLEM</span><h2>Looking right<br />isn't the same as<br /><em>being right.</em></h2></div><p>In Web3, the interface is where trust becomes action. But an attacker can change what a familiar site serves without changing what you expect to see.</p></div><div className="problem-grid"><article className="problem-card"><span className="card-index">01 / THE SURFACE</span><div className="problem-icon icon-window"><span /><span /><span /></div><h3>A familiar address</h3><p>You arrive at a website you recognize. The address and the design feel reassuring.</p></article><article className="problem-card problem-card-peach"><span className="card-index">02 / THE CHANGE</span><div className="problem-icon icon-change"><span>↗</span><span>↘</span></div><h3>Something underneath shifts</h3><p>A lookalike domain or a changed frontend can put a different request in front of you.</p></article><article className="problem-card problem-card-dark"><span className="card-index">03 / THE MOMENT</span><div className="problem-icon icon-wallet">⌑</div><h3>A decision without context</h3><p>By the time your wallet asks you to act, it may be difficult to tell what changed.</p></article></div></div></section>

  <section className="statement-section"><div className="container statement-inner"><div><span className="kicker light"><span>THE IDEA</span> / A LITTLE MORE CLARITY</span><h2>Security should help you<br /><em>understand the moment.</em></h2></div><p>BOUND is built around a simple idea: compare what you're seeing with independently verifiable information, then make the result easier to understand.</p><div className="statement-star" aria-hidden="true">✳</div></div></section>

  <section className="section architecture-section" id="how"><div className="container"><div className="section-heading"><div><span className="kicker"><span>02</span> / HOW IT WORKS</span><h2>A small check.<br /><em>A bigger picture.</em></h2></div><p>Three pieces work together to bring independent context into the browser, without asking you to decode the infrastructure.</p></div><div className="architecture-layout"><div className="architecture-list">{architecture.map(item => <article className="arch-row" key={item.n}><span className="arch-number">{item.n}</span><div><h3>{item.title}</h3><p>{item.text}</p></div><span className="arch-arrow">↗</span></article>)}</div><div className="architecture-diagram" aria-label="Diagram showing site evidence compared against ENS and Arkiv references, producing a BOUND status"><div className="diagram-label">THE BOUND ARCHITECTURE <span>↗</span></div><div className="diagram-flow"><div className="diagram-node"><span className="diagram-icon">⌘</span><div><small>THE INPUT</small><strong>Website & browser</strong></div><span className="node-end">01</span></div><div className="diagram-connector"><span>OBSERVE</span><i /></div><div className="diagram-node"><span className="diagram-icon mint">◎</span><div><small>THE REFERENCE</small><strong>ENS + Arkiv</strong></div><span className="node-end">02</span></div><div className="diagram-connector"><span>COMPARE</span><i /></div><div className="diagram-node dark-node"><span className="diagram-icon white">✳</span><div><small>THE OUTCOME</small><strong>A clearer status</strong></div><span className="node-end">03</span></div></div><div className="diagram-foot">A CHECK, NOT A GUARANTEE <span>● ● ●</span></div></div></div><p className="architecture-note">The site-safety flow shown here is the project’s proposed direction. Live integrations and browser coverage are still being verified.</p></div></section>

  <Simulation />
  <section className="section stack-section" id="stack"><div className="container"><div className="section-heading"><div><span className="kicker"><span>04</span> / THE TECHNOLOGY</span><h2>Built on open<br /><em>infrastructure.</em></h2></div><p>Different tools, one purpose: make information about the sites you use easier to verify.</p></div><div className="stack-grid">{stack.map(([n,title,text,tag]) => <article className="stack-card" key={n}><div className="stack-top"><span>{n} /</span><span>↗</span></div><div className={`stack-symbol stack-symbol-${n}`}>{n === '01' ? '▣' : n === '02' ? '◈' : n === '03' ? '◫' : '◎'}</div><h3>{title}</h3><p>{text}</p><span className="stack-tag">{tag}</span></article>)}</div><p className="architecture-note">Technologies shown reflect the project architecture; their live integration and privacy properties require verification.</p></div></section>

  <section className="section demo-section" id="demo"><div className="container"><div className="section-heading demo-heading"><div><span className="kicker"><span>05</span> / THE DEMO</span><h2>See the full<br /><em>story unfold.</em></h2></div><p>A closer look at the problem, the proposed approach, and the experience BOUND is working towards.</p></div><div className="video-frame">{validVideoId ? <iframe title="BOUND project demo" src={`https://www.youtube-nocookie.com/embed/${validVideoId}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /> : <div className="video-placeholder"><div className="video-mark">✳</div><span className="video-label">BOUND / PROJECT DEMO</span><h3>The full picture,<br />coming into focus.</h3><p>Demo video coming soon.</p><span className="video-corner">05 / 05</span></div>}</div><p className="download-instructions">Extension prototype: extract the downloaded ZIP, open <strong>chrome://extensions</strong> or <strong>edge://extensions</strong>, enable Developer mode, and select <strong>Load unpacked</strong>. Choose the extracted folder containing <strong>manifest.json</strong>. Configuration is required, and live integrations are still being verified.</p></div></section>
  <section className="closing"><div className="container closing-inner"><div><span className="kicker light"><span>BOUND</span> / BROWSE WITH MORE CONTEXT</span><h2>Confidence starts<br /><em>with a better question.</em></h2></div><a className="button light-button" href="#top">Back to the beginning <Arrow diagonal /></a><span className="closing-star" aria-hidden="true">✳</span></div></section></main>
  <footer><div className="container footer-top"><div><Logo /><p>More context for the moments<br />that matter in Web3.</p></div><div className="footer-links"><a href="#problem">The problem</a><a href="#how">How it works</a><a href="#simulation">Simulation</a><a href="#demo">Demo</a></div></div><div className="container footer-bottom"><span>© BOUND — A BROWSER SECURITY PROJECT</span><span>BUILT FOR MORE INFORMED DECISIONS</span></div></footer></>;
}

createRoot(document.getElementById('root')).render(<App />);
