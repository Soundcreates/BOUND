import React from 'react';

export const Arrow = ({ diagonal = false }) => <span aria-hidden="true" className="arrow">{diagonal ? '↗' : '→'}</span>;

export const Logo = () => <a className="logo" href="#top" aria-label="BOUND home">
  <img className="logo-mark" src="/logo.png" alt="" />
  bound<span className="logo-dot">.</span>
</a>;

/** Splits text into per-word spans so a scrubbed GSAP tween can write it in left to right. Spaces stay real text, so wrapping is normal. */
export const Words = ({ text }) => text.split(/\s+/).filter(Boolean).map((w, i, all) => (
  <React.Fragment key={i}><span className="rv-w">{w}</span>{i < all.length - 1 ? ' ' : null}</React.Fragment>
));
