import React, { useEffect, useState } from 'react';
import { CASES, runCase } from './cases.js';
import { decide, lifecycleEvent } from '../sim/engine.js';
import './testing.css';

const SWARM = 'https://bzz.limo/bzz/fa43f135f708b18f7f97008971e977f8ac74385f9f7237fb58bdc20ad2ba14ef/';
export default function Testing() {
  useEffect(() => { const previous=document.title; document.title='BOUND · Testing workbench'; return ()=>{document.title=previous;}; }, []);
  const [selected, setSelected] = useState(CASES[0].id);
  const [overrides, setOverrides] = useState({});
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState({});
  const [phrase, setPhrase] = useState('');
  const [decision, setDecision] = useState('');
  const [wallet, setWallet] = useState('');
  const [connecting, setConnecting] = useState(false);
  const scenario = CASES.find(c => c.id === selected);
  function run() {
    const output = { ...runCase(selected, overrides), time: new Date().toISOString() };
    setResult(output); setRuns(previous => ({...previous, [selected]: output})); setDecision(''); setPhrase('');
  }
  function select(id) { setSelected(id); setOverrides({}); setResult(null); setDecision(''); setPhrase(''); }
  const effective = {...scenario.settings, ...overrides};
  function toggle(name) { setOverrides(previous => ({...previous, [name]: !effective[name]})); setResult(null); setDecision(''); }
  function act(action) { setDecision(decide({...result, requiresTyped: result.verdict === 'escalated'}, action, phrase === 'I UNDERSTAND' ? phrase : '').text); }
  function deadline() { setDecision(lifecycleEvent({requiresTyped: result.verdict === 'escalated'}, 'deadline').text); }
  function runAll() {
    setRuns(Object.fromEntries(CASES.map(c => [c.id, {...runCase(c.id), time: new Date().toISOString()}])));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({source:'BOUND testing route; synthetic inputs, real decoder/policy/frontend functions',runs},null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href=url; a.download='bound-testing-results.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function connect() {
    setConnecting(true);
    try {
      const injected=window.ethereum;
      const provider=injected?.providers?.find(p=>p.isMetaMask)||injected;
      if(!provider?.request) throw Error('No injected wallet found. Open this route in Chrome with your wallet and BOUND enabled.');
      const accounts=await provider.request({method:'eth_requestAccounts'});
      setWallet(accounts?.[0] ? `Connected: ${accounts[0]}` : 'No account returned.');
    } catch(error) {setWallet(error.message || 'Connection did not complete.');}
    finally {setConnecting(false);}
  }
  return <div className="testing-page">
    <header className="lab-nav"><a href="/" className="lab-brand">bound<span>.</span></a><span>PRODUCT TESTING / 01—05</span><a href="/">Back to home ↗</a></header>
    <main id="main" className="lab-main">
      <div className="lab-intro"><div><p className="lab-eyebrow">THE JUDGE’S WORKBENCH</p><h1>Ask the hard<br/>questions.</h1><p className="lab-sub">Five cases. Inspect the inputs, change the evidence, and see what BOUND actually computes.</p></div><div className="lab-scope"><b>Real decision code. Controlled inputs.</b><p>This page calls the repository’s decoder, policy engine and frontend comparator with fictional addresses and records. It does not publish to Arkiv, write ENS, or send transactions.</p><p>Wallet connection below is a separate live action. Browser mediation and gateway availability need their own verification.</p></div></div>
      <div className="lab-toolbar"><span>{Object.keys(runs).length} / 5 cases evaluated</span><div><button onClick={runAll}>Evaluate all five</button><button disabled={!Object.keys(runs).length} onClick={download}>Export report ↓</button><button onClick={()=>{setRuns({});select(CASES[0].id);}}>Reset</button></div></div>
      <div className="lab-workbench"><nav className="lab-cases" aria-label="Test scenarios">{CASES.map((c,i)=><button key={c.id} aria-pressed={selected===c.id} onClick={()=>select(c.id)}><span className="lab-number">0{i+1}</span><span><strong>{c.title}</strong><small>{runs[c.id] ? `${runs[c.id].score ?? 'Unknown'}${runs[c.id].score===null?'':'/100'} · ${runs[c.id].redirectEligible?'Fallback eligible':'Review on site'}`:'Ready to evaluate'}</small></span><span>↗</span></button>)}</nav>
      <section className="lab-panel" aria-label="Selected scenario"><p className="lab-eyebrow">QUESTION TO TEST</p><h2>{scenario.question || scenario.title}</h2><p>{scenario.description}</p>
        <fieldset className="lab-switches"><legend>Change the evidence</legend><label><input type="checkbox" checked={!!effective.stale} onChange={()=>toggle('stale')}/> Stale watcher data</label><label><input type="checkbox" checked={!!effective.immature} onChange={()=>toggle('immature')}/> Baseline not mature</label><label><input type="checkbox" checked={!effective.drift} onChange={()=>toggle('drift')}/> No drift corroboration</label><label><input type="checkbox" checked={!!effective.unconfirmed} onChange={()=>toggle('unconfirmed')}/> Fewer than three reporters</label></fieldset>
        <button className="lab-run" onClick={run}>Evaluate this case →</button>
        <div aria-live="polite">{result ? <div className="lab-result" data-verdict={result.verdict}>
          <div className="lab-result-top"><div><span className="lab-eyebrow">CONFIDENCE CHECK SCORE</span><strong className="lab-score">{result.score ?? '—'}{result.score!==null&&<small>/100</small>}</strong></div><span className="lab-verdict">{result.verdict}</span></div>
          <p>{result.score===null?'Unknown: no usable baseline. Missing evidence does not establish safety.':'Higher means stronger policy support. This score is not a measured probability of safety.'}</p>
          <dl className="lab-evidence"><div><dt>Frontend comparison</dt><dd>{result.comparison}</dd></div><div><dt>Automatic fallback</dt><dd>{result.redirectEligible?'Eligible: low score + fresh, corroborated mismatch':'Not eligible'}</dd></div><div><dt>Evaluated at</dt><dd>{new Date(result.time).toLocaleString()}</dd></div></dl>
          <p>{result.explanation}</p><ul>{(result.reasons || []).map((reason,i)=><li key={i}>{reason}</li>)}</ul>
          <div className="lab-actions"><h3>Try the review decision</h3>{result.verdict==='escalated'&&<label>Type I UNDERSTAND<input aria-label="Confirmation phrase" value={phrase} onChange={e=>setPhrase(e.target.value)} autoComplete="off"/></label>}<div><button onClick={()=>act('cancel')}>Cancel request</button><button onClick={()=>act('continue')}>Continue to wallet</button><button onClick={deadline}>Advance review to timeout</button></div><p role="status">{decision || 'These controls calculate the review outcome without calling a wallet.'}</p></div>
          {result.redirectEligible&&<a className="lab-swarm" href={`${SWARM}#presentation=${encodeURIComponent(JSON.stringify({origin:window.location.origin,score:result.score,time:result.time}))}`} target="_blank" rel="noreferrer">Open Swarm report ↗</a>}
          <details><summary>Inspect request and computed evidence</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
        </div> : <p className="lab-empty">Choose inputs, then evaluate. Results are computed on demand.</p>}</div>
      </section></div>
      <section className="lab-live"><div><p className="lab-eyebrow">SEPARATE LIVE CHECK</p><h2>Test the installed extension.</h2><p>Connect your wallet here to exercise BOUND’s real connection interception. The five fixtures above do not change the installed extension’s score for this origin.</p></div><div><button onClick={connect} disabled={connecting}>{connecting?'Waiting for wallet…':'Connect real wallet'}</button><p role="status">{wallet || 'Requires a wallet extension. No signing or transaction requests.'}</p></div></section>
      <p className="lab-footnote">Implementation: shared/decoder · shared/policy-core · shared/policy-core/frontend.mjs. Inspired by the final architecture and security whitepaper; proposed features are not presented as implemented.</p>
    </main>
  </div>;
}
