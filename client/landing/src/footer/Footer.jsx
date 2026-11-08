import React from 'react';
import { Logo } from '../lib/shared.jsx';
import './footer.css';

const links = [['The problem', '#problem'], ['The record', '#record'], ['How it works', '#how'], ['Simulation', '#simulation'], ['Technology', '#stack'], ['Demo', '#demo'], ['Testing', '/testing']];

export default function Footer() {
  return <footer className="ft">
    <div className="ft-inner">
      <div className="ft-top">
        <div className="ft-brand"><Logo /><p>More context for the moments<br />that matter in Web3.</p></div>
        <nav className="ft-links" aria-label="Footer">{links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
      </div>
      <div className="ft-bottom"><span>© BOUND, a browser security project</span><span>Built for more informed decisions</span></div>
    </div>
  </footer>;
}
