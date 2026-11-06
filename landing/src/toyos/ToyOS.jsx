import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { scenarios, byId, GROUPS } from '../sim/scenarios.js';
import { assess, decide, lifecycleEvent, walletOutcome, withoutBound, coverageRow, CONFIRM_PHRASE, DEADLINE_MINUTES } from '../sim/engine.js';
import { labelOf, short } from '../sim/requests.js';
import { byIncident } from '../proof/incidents.js';
import Proof from '../proof/Proof.jsx';
import './toyos.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// ── UI state only. Every verdict, outcome and sentence of consequence comes from ../sim/engine.js ──
const fresh = (id, bound) => ({ id, bound, phase: 'idle', a: null, typed: '', note: null, tag: null, outcome: null, log: [], focus: 'browser', shake: 0 });
const entry = (who, text) => ({ who, text });

function reducer(s, act) {
  const sc = byId[s.id];
  switch (act.type) {
    case 'select': return fresh(act.id, s.bound);
    case 'bound': return fresh(s.id, act.on);
    case 'reset': return fresh(s.id, s.bound);
    case 'focus': return { ...s, focus: act.win };
    case 'typed': return { ...s, typed: act.value };
    case 'request': {
      if (s.phase !== 'idle') return s;
      if (!s.bound) return { ...s, phase: 'wallet', focus: 'wallet', note: withoutBound(sc).text, tag: 'NO CHECK', log: [entry('page', `Page calls ${sc.request.method}`), entry('wallet', 'Request reaches the wallet unchecked')] };
      if (sc.mediated === false) return { ...s, phase: 'wallet', focus: 'wallet', a: null, note: 'BOUND saw nothing. The page called a provider reference it had saved before the hook ran, so the request went straight to the wallet.', tag: 'UNSEEN', log: [entry('page', `Page calls ${sc.request.method} on a saved provider reference`), entry('bound', 'No request observed. Coverage: bypass possible'), entry('wallet', 'Request reaches the wallet unchecked')] };
      const a = assess(sc);
      return { ...s, phase: 'review', focus: 'bound', a, note: null, tag: null, log: [entry('page', `Page calls ${sc.request.method}`), entry('bound', `Request held. Decoded as ${a.kind}${a.label ? ` (${a.label})` : ''}`), entry('bound', `Verdict ${a.verdict}${a.score === null ? '' : ` · score ${a.score}`}`)] };
    }
    case 'decide': {
      if (s.phase !== 'review') return s;
      const d = decide(s.a, act.action, s.typed);
      if (d.error) return { ...s, note: d.text, tag: 'CONFIRM', shake: s.shake + 1 };
      if (d.forwarded) return { ...s, phase: 'wallet', focus: 'wallet', note: d.text, tag: 'FORWARDED', log: [...s.log, entry('you', act.action === 'continue' && s.a.requiresTyped ? 'Typed the confirmation and continued' : 'Pressed Continue'), entry('wallet', 'Same request forwarded unchanged')] };
      return { ...s, phase: 'done', focus: 'inspector', outcome: { kind: 'none', text: 'No change. The wallet never received the request.' }, note: d.text, tag: 'CANCELLED', log: [...s.log, entry('you', 'Pressed Cancel'), entry('bound', 'Page receives “User rejected the request”')] };
    }
    case 'life': {
      if (s.phase !== 'review') return s;
      const r = lifecycleEvent(s.a, act.event);
      if (r.ignored) return { ...s, note: r.text, tag: 'IGNORED', log: [...s.log, entry('page', 'Clicked a dialog the page drew itself'), entry('bound', 'Ignored: not the extension’s window')] };
      if (r.forwarded) return { ...s, phase: 'wallet', focus: 'wallet', note: r.text, tag: 'TIMED OUT', log: [...s.log, entry('bound', `${DEADLINE_MINUTES} min deadline reached`), entry('wallet', 'Request handed to the wallet')] };
      return { ...s, phase: 'done', focus: 'inspector', outcome: { kind: 'none', text: 'No change. The request was cancelled and must be sent again.' }, note: r.text, tag: 'CANCELLED', log: [...s.log, entry('bound', act.event === 'stateChange' ? 'Wallet account changed during review' : 'Deadline reached'), entry('bound', 'Request cancelled')] };
    }
    case 'wallet': {
      if (s.phase !== 'wallet') return s;
      const outcome = walletOutcome(sc, act.confirm);
      return { ...s, phase: 'done', focus: 'inspector', outcome, note: outcome.text, tag: outcome.kind === 'loss' ? 'FUNDS AT RISK' : outcome.kind === 'fine' ? 'NO LOSS' : 'NO CHANGE', log: [...s.log, entry('you', act.confirm ? 'Confirmed in the wallet' : 'Rejected in the wallet')] };
    }
    default: return s;
  }
}

// ── Display helpers ──
const friendly = (text) => text.replace(/0x[0-9a-fA-F]{40}/g, (a) => `${labelOf(a)} ${short(a.toLowerCase())}`);
const VERDICT_NAME = { green: 'Green', amber: 'Amber', red: 'Red', escalated: 'Firewall', grey: 'No score', unseen: 'Unseen' };

function summarize(request) {
  const first = request.params?.[0];
  if (request.method === 'eth_sendTransaction') return [['Method', 'eth_sendTransaction'], ['To', `${labelOf(first.to)} ${short(first.to)}`], ['Data', first.data === '0x' ? 'none' : `${first.data.slice(0, 10)}… ${(first.data.length - 2) / 2} bytes`]];
  if (request.method.startsWith('eth_signTypedData')) { let type = 'typed data'; try { type = JSON.parse(request.params[1]).primaryType; } catch { /* keep default */ } return [['Method', request.method], ['Type', type], ['Shown by this wallet', 'raw fields only']]; }
  if (request.method === 'eth_sign') return [['Method', 'eth_sign'], ['Payload', '32-byte hash, unreadable']];
  if (request.method === 'personal_sign') return [['Method', 'personal_sign'], ['Message', new TextDecoder().decode(Uint8Array.from(first.slice(2).match(/../g).map((h) => parseInt(h, 16))))]];
  if (request.method === 'wallet_signAuthorization') return [['Method', request.method], ['Delegate', `${labelOf(first.address)} ${short(first.address)}`], ['Chain id', first.chainId]];
  return [['Method', request.method]];
}

function Meter({ score, verdict }) {
  const ref = useRef(null);
  useGSAP(() => { if (score !== null) gsap.fromTo(ref.current, { left: '0%' }, { left: `${score}%`, duration: 1, ease: 'expo.out' }); }, { dependencies: [score] });
  return <div className="bw-meter" role="img" aria-label={score === null ? 'No score' : `Score ${score} of 100`}>
    <div className="bw-track"><i className="z-stop" /><i className="z-red" /><i className="z-amber" /><i className="z-green" /></div>
    {score === null ? <span className="bw-nomark">no score</span> : <span className={`bw-mark v-${verdict}`} ref={ref}><b>{score}</b></span>}
    <div className="bw-ticks"><span>0</span><span>16</span><span>40</span><span>70</span><span>100</span></div>
  </div>;
}

function ReviewWindow({ s, dispatch }) {
  const { a } = s;
  const ref = useRef(null);
  const cancelBtn = useRef(null);
  const input = useRef(null);
  useGSAP(() => { gsap.fromTo(ref.current, { autoAlpha: 0, y: 18, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'expo.out' }); cancelBtn.current?.focus({ preventScroll: true }); }, { dependencies: [a.scenarioId] });
  useGSAP(() => { if (s.shake) gsap.fromTo(input.current ?? ref.current, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1,0.3)' }); }, { dependencies: [s.shake] });
  return <section className={`bw tone-${a.tone} v-${a.verdict}`} ref={ref} role="dialog" aria-label="BOUND review" aria-describedby="bw-sum">
    <header className="bw-bar"><span className="bw-extension">◆ BOUND</span><span className="bw-own">Extension window · the page cannot draw or click this</span></header>
    <div className="bw-main">
      <div className="bw-head"><span className="bw-badge">{VERDICT_NAME[a.verdict]}</span><h4>{a.title}</h4></div>
      <p id="bw-sum" className="bw-sum">{a.summary}</p>
      <Meter score={a.score} verdict={a.verdict} />
      <p className="bw-conf">{a.score === null ? 'No score. BOUND had nothing to compare against, which is not a safe signal.' : `Policy score ${a.score} of 100 heuristic points. This is not a probability that the request is safe.`}</p>
      {a.drift && <p className="bw-drift">Watcher reports infrastructure drift for this site.</p>}
      {a.reasons.length > 0 && <ul className="bw-reasons">{a.reasons.map((r) => <li key={r}>{friendly(r)}</li>)}</ul>}
      {a.entries.length > 0 && <table className="bw-table"><caption className="sr-only">Addresses in this request</caption><thead><tr><th>Role</th><th>Address</th><th>Trusted list</th></tr></thead><tbody>
        {a.entries.map((e) => <tr key={e.role + e.address}><td>{e.role}</td><td>{e.label} <code>{e.shortAddress}</code></td><td>{!e.verified ? 'unverified' : e.listed ? 'listed' : 'not listed'}</td></tr>)}
      </tbody></table>}
      {a.requiresTyped && <label className="bw-type">Type <b>{CONFIRM_PHRASE}</b> to continue past the firewall<input ref={input} value={s.typed} onChange={(e) => dispatch({ type: 'typed', value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} autoComplete="off" spellCheck="false" /></label>}
      <div className="bw-actions">
        <button type="button" className="os-btn" ref={cancelBtn} onClick={() => dispatch({ type: 'decide', action: 'cancel' })}>Cancel</button>
        <button type="button" className="os-btn os-btn-ink" onClick={() => dispatch({ type: 'decide', action: 'continue' })}>Continue to wallet</button>
      </div>
      <p className="bw-limit">Continuing sends the request to your wallet. BOUND cannot guarantee safety and cannot see wallet paths that bypass it.</p>
    </div>
  </section>;
}

function Win({ id, title, s, dispatch, chip, className = '', children }) {
  return <section className={`os-win os-${id} ${className}${s.focus === id ? ' is-focus' : ''}`} onPointerDown={() => s.focus !== id && dispatch({ type: 'focus', win: id })} aria-label={title}>
    <header className="os-bar"><span className="os-lights" aria-hidden="true"><i /><i /><i /></span><span className="os-title">{title}</span>{chip && <span className="os-chip">{chip}</span>}</header>
    <div className="os-body">{children}</div>
  </section>;
}

export default function ToyOS() {
  const root = useRef(null);
  const [s, dispatch] = useReducer(reducer, null, () => fresh('badger', true));
  const sc = byId[s.id];
  const rows = useMemo(() => scenarios.map(coverageRow), []);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, scenarios.filter((x) => x.group === g.id).length])), []);

  useEffect(() => {
    const onReplay = (e) => { if (byId[e.detail?.id]) dispatch({ type: 'select', id: e.detail.id }); };
    window.addEventListener('bound:replay', onReplay);
    return () => window.removeEventListener('bound:replay', onReplay);
  }, []);

  useGSAP(() => {
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // The desktop rises into place as you scroll to it, then its windows settle in.
      gsap.fromTo(q('.os')[0], { y: 70, scale: 0.94, autoAlpha: 0.5 }, { y: 0, scale: 1, autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: q('.os')[0], start: 'top 92%', end: 'top 45%', scrub: 0.6 } });
      gsap.from(q('.os-win'), { autoAlpha: 0, y: 24, duration: 0.8, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.os')[0], start: 'top 70%', once: true } });
      gsap.from(q('.os-head > *'), { autoAlpha: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: q('.os-head')[0], start: 'top 85%', once: true } });
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, { scope: root });

  // Result toast and loss flash.
  const toast = useRef(null);
  useGSAP(() => { if (s.note && toast.current) gsap.fromTo(toast.current, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'expo.out' }); }, { dependencies: [s.note, s.tag] });
  const wallet = useRef(null);
  useGSAP(() => { if (s.outcome?.kind === 'loss' && wallet.current) gsap.fromTo(wallet.current, { backgroundColor: 'rgba(217,56,30,0.35)' }, { backgroundColor: 'rgba(217,56,30,0)', duration: 1.6, ease: 'power2.out' }); }, { dependencies: [s.outcome] });

  // Dock click: change focus AND make it unmistakable (pulse + scroll into view). A subtle ring alone
  // read as "nothing happened", since every pane is already on screen with nothing to visually "open".
  const jumpTo = (id) => {
    dispatch({ type: 'focus', win: id });
    const el = root.current?.querySelector(`.os-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    gsap.fromTo(el, { '--pulse': 1 }, { '--pulse': 0, duration: 0.9, ease: 'power2.out', overwrite: true });
    gsap.fromTo(el, { scale: 1.025 }, { scale: 1, duration: 0.55, ease: 'back.out(3)', overwrite: true });
  };

  const raw = sc.request;
  const lost = s.outcome?.kind === 'loss';
  const step = s.phase === 'idle' ? 'Press the page’s button to send a request.' : s.phase === 'review' ? 'Decide in BOUND’s window.' : s.phase === 'wallet' ? 'The wallet is asking. Confirm or reject.' : 'Done. Pick another replay or reset.';

  return <section className="os-sec" id="simulation" ref={root} aria-labelledby="sim-title">
    <div className="os-inner">
      <header className="os-head">
        <h2 id="sim-title">Same request.<br /><em>Different outcome.</em></h2>
        <p>A small pretend computer with a browser, a wallet and BOUND’s extension. Replay a documented incident, switch BOUND off to see what happened, then switch it on. Verdicts are computed live by BOUND’s own decoder and scoring code.</p>
        <p className="os-counts" aria-label="Replay coverage">{scenarios.length} replays · {counts.incident} documented incidents · {counts.edge} edge cases · {counts.limit} known limits · {counts.lifecycle} lifecycle cases</p>
      </header>

      <div className="os" role="group" aria-label="Simulated desktop">
        <div className="os-menubar">
          <span className="os-apple" aria-hidden="true">◆</span>
          <b>{{ browser: 'Browser', wallet: 'Wallet', bound: 'BOUND', inspector: 'Inspector', replays: 'Replays' }[s.focus]}</b>
          <span className="os-menu-sp" />
          <span className="os-sim-chip">Simulation</span>
          <button type="button" role="switch" aria-checked={s.bound} className={`os-switch${s.bound ? ' on' : ''}`} onClick={() => dispatch({ type: 'bound', on: !s.bound })}>
            <span className="os-switch-label">BOUND</span><span className="os-switch-track"><i /></span><span className="os-switch-state">{s.bound ? 'On' : 'Off'}</span>
          </button>
          <span className="os-clock">9:41</span>
        </div>

        <div className="os-desk">
          <Win id="replays" title="Replays" s={s} dispatch={dispatch}>
            {GROUPS.map((g) => <div className="rp-group" key={g.id}>
              <h4>{g.label}<small>{g.hint}</small></h4>
              <ul>{scenarios.filter((x) => x.group === g.id).map((x) => <li key={x.id}>
                <button type="button" className={`rp-item${x.id === s.id ? ' is-on' : ''}`} onClick={() => dispatch({ type: 'select', id: x.id })} aria-pressed={x.id === s.id}>
                  <span>{x.title}</span>{x.incident && <em>{byIncident[x.incident].name.split(' ')[0]} {byIncident[x.incident].year}</em>}
                </button>
              </li>)}</ul>
            </div>)}
          </Win>

          <Win id="browser" title="Browser" s={s} dispatch={dispatch} chip={sc.group === 'incident' ? 'Replay: compromised page' : 'Mock page'}>
            <div className="br-url"><span aria-hidden="true">🔒</span> https://{sc.page.site}</div>
            <div className="br-page">
              <div className="br-brand">{sc.page.site.split('.')[0]}<span>.</span></div>
              <h3>{sc.page.headline}</h3>
              <p>{sc.page.body}</p>
              <button type="button" className="br-cta" onClick={() => dispatch({ type: 'request' })} disabled={s.phase !== 'idle'}>{sc.page.button}</button>
              {sc.lifecycle === 'spoof' && s.phase === 'review' && <div className="br-fake" role="group" aria-label="Dialog drawn by the page">
                <b>✔ Security check passed</b><span>This request has been verified safe.</span>
                <button type="button" onClick={() => dispatch({ type: 'life', event: 'spoofClick' })}>Continue</button>
                <small>Drawn by the page</small>
              </div>}
            </div>
            <p className="br-foot">Mock page. Nothing here is real.</p>
          </Win>

          <div className="os-right">
            <Win id="wallet" title="Wallet" s={s} dispatch={dispatch} chip="Toy wallet" className="wl-win">
              <div className="wl" ref={wallet}>
                <div className="wl-bal"><small>TOKEN balance (toy)</small><b>{lost ? '0' : '1,000'}</b></div>
                {s.phase === 'wallet'
                  ? <div className="wl-prompt"><h4>Confirm request</h4><dl>{summarize(raw).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                      <div className="wl-actions"><button type="button" className="os-btn" onClick={() => dispatch({ type: 'wallet', confirm: false })}>Reject</button><button type="button" className="os-btn os-btn-ink" onClick={() => dispatch({ type: 'wallet', confirm: true })}>Confirm</button></div></div>
                  : <p className="wl-idle">{s.phase === 'done' ? (s.outcome?.text ?? 'Idle.') : 'No pending request.'}</p>}
              </div>
            </Win>
            <Win id="inspector" title="Inspector" s={s} dispatch={dispatch} chip="Engine output" className="in-win">
              <div className="in">
                <div><small>Request</small><code>{raw.method}</code></div>
                {s.a ? <>
                  <div><small>Decoder</small><code>{s.a.kind}{s.a.label ? ` · ${s.a.label}` : ''}</code></div>
                  <div><small>Policy</small><code>{s.a.verdict} · score {s.a.score ?? 'none'} · {s.a.coverage}{s.a.drift ? ' · drift' : ''}</code></div>
                </> : <p className="in-empty">{s.phase === 'idle' ? 'Waiting for a request.' : s.bound ? 'BOUND observed no request.' : 'BOUND is off. Nothing was decoded or scored.'}</p>}
                {s.log.length > 0 && <ol className="in-log">{s.log.map((l, i) => <li key={i} className={`who-${l.who}`}><b>{l.who}</b> {l.text}</li>)}</ol>}
              </div>
            </Win>
          </div>

          {s.phase === 'review' && s.a && <div className="os-sheet"><ReviewWindow s={s} dispatch={dispatch} /></div>}
        </div>

        <div className="os-toast-row">
          {s.note ? <div className={`os-toast tag-${(s.tag || '').toLowerCase().replace(/\s/g, '-')}`} ref={toast} role="status"><span className="os-tag">{s.tag}</span><span>{s.note}</span></div> : <div className="os-toast os-toast-idle">{step}</div>}
        </div>

        <nav className="os-dock" aria-label="Dock">
          {[['replays', '▤', 'Replays'], ['browser', '◎', 'Browser'], ['wallet', '◈', 'Wallet'], ['inspector', '≣', 'Inspector']].map(([id, glyph, name]) => <button key={id} type="button" className={s.focus === id ? 'is-on' : ''} onClick={() => jumpTo(id)} aria-label={name} title={name}><span aria-hidden="true">{glyph}</span></button>)}
        </nav>
      </div>

      <div className="os-tray" role="group" aria-label="Simulation controls">
        <span className="os-tray-label">Simulation controls</span>
        <button type="button" className="os-btn" disabled={sc.lifecycle !== 'deadline' || s.phase !== 'review'} onClick={() => dispatch({ type: 'life', event: 'deadline' })}>Wait {DEADLINE_MINUTES} minutes</button>
        <button type="button" className="os-btn" disabled={sc.lifecycle !== 'stateChange' || s.phase !== 'review'} onClick={() => dispatch({ type: 'life', event: 'stateChange' })}>Switch wallet account</button>
        <button type="button" className="os-btn" onClick={() => dispatch({ type: 'reset' })}>Reset replay</button>
      </div>

      <article className="os-case" aria-live="polite">
        <div><h3>{sc.title}</h3>{sc.incident && <Proof ids={[sc.incident]} label="Replays" />}</div>
        <p>{sc.note}</p>
      </article>

      <div className="os-cover">
        <h3>What BOUND returns for every replay</h3>
        <p>Computed live from the same code, not written by hand. “Unseen” means the request never reached BOUND.</p>
        <div className="os-scroll"><table>
          <thead><tr><th>Replay</th><th>Kind</th><th>Verdict</th><th>Score</th><th>Note</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className={r.id === s.id ? 'is-on' : ''}>
            <td><button type="button" onClick={() => { dispatch({ type: 'select', id: r.id }); root.current?.querySelector('.os')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>{r.title}</button></td>
            <td>{GROUPS.find((g) => g.id === r.group).label}</td>
            <td><span className={`vd v-${r.verdict}`}>{VERDICT_NAME[r.verdict]}</span></td>
            <td>{r.score ?? '—'}</td>
            <td>{r.limit ? 'Known limit' : r.label ?? ''}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <p className="os-foot">Simulation. Timing is compressed, amounts are fictional, and the pages are mock-ups. BOUND provides context; it does not guarantee a site or transaction is safe. It is not an audit, and it does not cover every wallet path or every kind of attack.</p>
    </div>
  </section>;
}
