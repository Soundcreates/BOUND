import React from 'react';

export const Arrow = ({ diagonal = false }) => <span aria-hidden="true" className="arrow">{diagonal ? '↗' : '→'}</span>;

// The actual BOUND mark: a lowercase "b", recoloured for whichever section it sits in.
// Body = currentColor (matches the surrounding text colour). Slash = the accent yellow, in both
// themes. Hole = --logo-hole, which defaults to the page background and is overridden on black sections.
export const Logo = () => <a className="logo" href="#top" aria-label="BOUND home">
  <svg className="logo-mark" viewBox="0 0 64 86" aria-hidden="true">
    {/* stem: dome-topped column (sweep=0 arcs up, not down) */}
    <path className="lm-body" d="M1.5 14 A12.5 12.5 0 0 0 26.5 14 L26.5 58 L1.5 58 Z" />
    {/* bowl */}
    <circle className="lm-body" cx="38" cy="56.5" r="26" />
    {/* the accent slash, where the stem meets the bowl */}
    <path className="lm-slash" d="M1.5 49 L6 52.5 L26.5 29.5 L22 26 Z" />
    {/* the teardrop cut-out: a round body pointing up-left, built upright then rotated into place */}
    <path className="lm-hole" d="M34 36 C41.5 36 47 44.5 47 55 A13 13 0 1 1 21 55 C21 44.5 26.5 36 34 36 Z" transform="rotate(-45 34 63)" />
  </svg>
  bound<span className="logo-dot">.</span>
</a>;

/** Splits text into per-word spans so a scrubbed GSAP tween can write it in left to right. Spaces stay real text, so wrapping is normal. */
export const Words = ({ text }) => text.split(/\s+/).filter(Boolean).map((w, i, all) => (
  <React.Fragment key={i}><span className="rv-w">{w}</span>{i < all.length - 1 ? ' ' : null}</React.Fragment>
));
