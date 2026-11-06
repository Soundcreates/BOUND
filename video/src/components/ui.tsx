import React from "react";
import { AbsoluteFill, Img, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { c, clamp, easeOut, expoOut, fonts } from "../theme";

/* ------------------------------------------------------------------ */
/* Atmosphere                                                          */
/* ------------------------------------------------------------------ */

/** Animated film grain. Re-seeds every 2 frames so it shimmers without strobing. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.08 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 50;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number; color?: string }> = ({ strength = 0.75, color = "0,0,0" }) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(ellipse at center, rgba(${color},0) 45%, rgba(${color},${strength}) 100%)`,
    }}
  />
);

/** Subtle dot grid used on the light canvas. */
export const DotGrid: React.FC<{ color?: string; drift?: number }> = ({ color = "rgba(20,20,20,0.09)", drift = 0.25 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(${color} 1.6px, transparent 1.6px)`,
        backgroundSize: "36px 36px",
        backgroundPosition: `${-frame * drift}px ${-frame * drift * 0.5}px`,
      }}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Type                                                                */
/* ------------------------------------------------------------------ */

export const Kicker: React.FC<{ children: React.ReactNode; at?: number; color?: string; style?: React.CSSProperties }> = ({
  children,
  at = 0,
  color = c.muted,
  style,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + 14], [0, 1], clamp);
  const text = String(children);
  const shown = Math.floor(interpolate(frame, [at, at + text.length * 0.9], [0, text.length], clamp));
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 20,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        opacity: o,
        ...style,
      }}
    >
      <span style={{ color: c.lime === color ? c.lime : undefined }}>{"// "}</span>
      {text.slice(0, shown)}
    </div>
  );
};

type Seg = { t: string; i?: boolean; color?: string };

/** Parse "Plain *italic* plain" into segments. Italic = serif italic, the editorial accent. */
const parse = (s: string, accent?: string): Seg[] =>
  s.split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (p.startsWith("*") ? { t: p.slice(1, -1), i: true, color: accent } : { t: p }));

/**
 * Word-by-word headline reveal: each word rises out of a mask with a slight blur.
 * `*word*` renders in italic (and in `accent` if provided).
 */
export const Words: React.FC<{
  text: string;
  at?: number;
  stagger?: number;
  size?: number;
  color?: string;
  accent?: string;
  family?: string;
  lineHeight?: number;
  style?: React.CSSProperties;
  out?: number;
  align?: "left" | "center";
}> = ({ text, at = 0, stagger = 3, size = 96, color = c.ink, accent, family = fonts.serif, lineHeight = 1.02, style, out, align = "left" }) => {
  const frame = useCurrentFrame();
  const segs = parse(text, accent);
  let wi = 0;
  const outO = out === undefined ? 1 : interpolate(frame, [out, out + 10], [1, 0], clamp);
  const outY = out === undefined ? 0 : interpolate(frame, [out, out + 10], [0, -24], { ...clamp, easing: easeOut });
  return (
    <div
      style={{
        fontFamily: family,
        fontSize: size,
        lineHeight,
        color,
        letterSpacing: family === fonts.serif ? "-0.01em" : "-0.03em",
        textAlign: align,
        opacity: outO,
        transform: `translateY(${outY}px)`,
        ...style,
      }}
    >
      {segs.map((seg, si) =>
        seg.t.split(/(\s+)/).map((w, k) => {
          if (/^\s+$/.test(w)) return <span key={`${si}-${k}`}> </span>;
          if (w === "") return null;
          if (w === "\n") return <br key={`${si}-${k}`} />;
          const d = at + wi++ * stagger;
          const p = interpolate(frame, [d, d + 16], [0, 1], { ...clamp, easing: expoOut });
          return (
            <span key={`${si}-${k}`} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.08em" }}>
              <span
                style={{
                  display: "inline-block",
                  transform: `translateY(${(1 - p) * 105}%)`,
                  filter: `blur(${(1 - p) * 6}px)`,
                  opacity: Math.min(1, p * 1.6),
                  fontStyle: seg.i ? "italic" : "normal",
                  color: seg.color ?? color,
                }}
              >
                {w}
              </span>
            </span>
          );
        }),
      )}
    </div>
  );
};

/** Monospace typewriter with a block caret. */
export const Typewriter: React.FC<{
  text: string;
  at?: number;
  cps?: number; // characters per frame
  size?: number;
  color?: string;
  caret?: boolean;
  style?: React.CSSProperties;
}> = ({ text, at = 0, cps = 0.8, size = 28, color = c.canvas, caret = true, style }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - at) * cps)));
  const done = n >= text.length;
  const blink = Math.floor(frame / 8) % 2 === 0;
  return (
    <div style={{ fontFamily: fonts.mono, fontSize: size, color, whiteSpace: "pre", ...style }}>
      {text.slice(0, n)}
      {caret && frame >= at && (!done || blink) ? (
        <span style={{ display: "inline-block", width: "0.6em", height: "1.05em", background: color, verticalAlign: "-0.15em", marginLeft: 2 }} />
      ) : null}
    </div>
  );
};

/** Scrambles characters before locking into the final text. */
export const Scramble: React.FC<{ text: string; at?: number; dur?: number; style?: React.CSSProperties; seed?: string }> = ({
  text,
  at = 0,
  dur = 18,
  style,
  seed = "s",
}) => {
  const frame = useCurrentFrame();
  const glyphs = "0123456789abcdef#$%&@!?";
  const p = interpolate(frame, [at, at + dur], [0, 1], clamp);
  const lock = Math.floor(p * text.length);
  const out = text
    .split("")
    .map((ch, i) => {
      if (i < lock || ch === " ") return ch;
      if (frame < at) return "";
      return glyphs[Math.floor(random(`${seed}${i}${Math.floor(frame / 2)}`) * glyphs.length)];
    })
    .join("");
  return <span style={{ fontFamily: fonts.mono, ...style }}>{out}</span>;
};

/* ------------------------------------------------------------------ */
/* UI atoms                                                            */
/* ------------------------------------------------------------------ */

export const Chip: React.FC<{
  children: React.ReactNode;
  at?: number;
  dark?: boolean;
  tone?: "default" | "lime" | "danger" | "ghost";
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, at = 0, dark, tone = "default", size = 20, style }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [at, at + 12], [0, 1], { ...clamp, easing: expoOut });
  const palette = {
    default: dark ? { bg: "transparent", fg: c.canvas, bd: c.nightLine } : { bg: c.paper, fg: c.ink, bd: c.border },
    lime: { bg: c.lime, fg: c.ink, bd: c.lime },
    danger: dark ? { bg: "rgba(170,45,0,0.22)", fg: c.salmon, bd: "rgba(232,167,132,0.55)" } : { bg: c.peach, fg: c.danger, bd: "rgba(180,35,24,0.4)" },
    ghost: dark ? { bg: "rgba(247,244,236,0.06)", fg: c.canvas, bd: "transparent" } : { bg: c.selected, fg: c.ink, bd: "transparent" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: `${size * 0.42}px ${size * 0.9}px`,
        borderRadius: 999,
        border: `1.5px solid ${palette.bd}`,
        background: palette.bg,
        color: palette.fg,
        fontFamily: fonts.mono,
        fontSize: size,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        opacity: s,
        transform: `translateY(${(1 - s) * 14}px) scale(${0.92 + 0.08 * s})`,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

export const Dot: React.FC<{ color: string; size?: number; pulse?: boolean }> = ({ color, size = 12, pulse }) => {
  const frame = useCurrentFrame();
  const k = pulse ? 0.5 + 0.5 * Math.sin(frame / 4) : 1;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 99,
        background: color,
        boxShadow: pulse ? `0 0 ${10 + 14 * k}px ${color}` : undefined,
        opacity: pulse ? 0.6 + 0.4 * k : 1,
      }}
    />
  );
};

/** Animated count-up number. */
export const Count: React.FC<{ from?: number; to: number; at: number; dur: number; format?: (n: number) => string; style?: React.CSSProperties }> = ({
  from = 0,
  to,
  at,
  dur,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  style,
}) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [at, at + dur], [from, to], { ...clamp, easing: easeOut });
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{format(v)}</span>;
};

/** Logo pieces (transparent PNGs generated from apps/extension/BOUND.jpeg). */
export const Mark: React.FC<{ variant?: "ink" | "cream"; height: number; style?: React.CSSProperties }> = ({ variant = "ink", height, style }) => (
  <Img src={staticFile(`brand/mark-${variant}.png`)} style={{ height, width: (height * 640) / 855, ...style }} />
);
export const Wordmark: React.FC<{ variant?: "ink" | "cream"; height: number; style?: React.CSSProperties }> = ({ variant = "ink", height, style }) => (
  <Img src={staticFile(`brand/word-${variant}.png`)} style={{ height, width: (height * 700) / 190, ...style }} />
);

/** Mouse cursor that travels along keyframes and "clicks" (scale dip). */
export const Cursor: React.FC<{ path: [number, number, number][]; clickAt?: number[]; color?: string; until?: number }> = ({ path, clickAt = [], color = c.canvas, until = 1e9 }) => {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p[0]);
  const x = interpolate(frame, fs, path.map((p) => p[1]), { ...clamp, easing: easeOut });
  const y = interpolate(frame, fs, path.map((p) => p[2]), { ...clamp, easing: easeOut });
  const pressed = clickAt.some((f) => frame >= f && frame < f + 5);
  const ring = clickAt.map((f) => interpolate(frame, [f, f + 14], [0, 1], clamp)).find((v) => v > 0 && v < 1) ?? 0;
  if (frame < fs[0] || frame > until + 8) return null;
  const fadeAway = interpolate(frame, [until, until + 8], [1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 50, pointerEvents: "none", opacity: fadeAway }}>
      {ring > 0 ? (
        <div
          style={{
            position: "absolute",
            left: -30 * ring,
            top: -30 * ring,
            width: 60 * ring,
            height: 60 * ring,
            borderRadius: 99,
            border: `3px solid ${c.lime}`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
      <svg width="34" height="40" viewBox="0 0 17 20" style={{ transform: `scale(${pressed ? 0.85 : 1})`, transformOrigin: "0 0", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }}>
        <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" fill={color === c.canvas ? "#fff" : color} stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** RGB-split + slice glitch wrapper. `amount` 0..1 */
export const Glitch: React.FC<{ amount: number; children: React.ReactNode; seed?: string }> = ({ amount, children, seed = "g" }) => {
  const frame = useCurrentFrame();
  if (amount <= 0.001) return <>{children}</>;
  const r = (k: string) => random(`${seed}${k}${Math.floor(frame / 2)}`);
  const dx = (r("x") - 0.5) * 40 * amount;
  const slices = Array.from({ length: 6 }, (_, i) => ({ top: r(`t${i}`) * 100, h: 2 + r(`h${i}`) * 9, off: (r(`o${i}`) - 0.5) * 140 * amount }));
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${dx}px)` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.7 * amount, transform: `translateX(${dx + 14 * amount}px)`, filter: "url(#none)" }}>
        <AbsoluteFill style={{ background: "rgba(255,0,60,0.25)" }} />
      </AbsoluteFill>
      {slices.map((s, i) => (
        <AbsoluteFill key={i} style={{ clipPath: `inset(${s.top}% 0 ${Math.max(0, 100 - s.top - s.h)}% 0)`, transform: `translateX(${s.off}px)` }}>
          {children}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

/** Thin horizontal progress ticks, like the reference's chapter marker. */
export const Chapter: React.FC<{ index: number; total: number; dark?: boolean; label: string }> = ({ index, total, dark, label }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [4, 18], [0, 1], clamp);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, opacity: o }}>
      <div style={{ display: "flex", gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ width: i === index ? 46 : 22, height: 3, borderRadius: 3, background: i <= index ? (dark ? c.lime : c.ink) : dark ? c.nightLine : c.border }} />
        ))}
      </div>
      <span style={{ fontFamily: fonts.mono, fontSize: 16, letterSpacing: "0.12em", color: dark ? c.creamDim : c.muted }}>{label}</span>
    </div>
  );
};

/** CrewOS-style HUD: corner labels, running timecode, act marker, progress rail. Global-frame aware. */
export const Hud: React.FC<{ dark: boolean; act: string; scene: string; total: number }> = ({ dark, act, scene, total }) => {
  const frame = useCurrentFrame();
  const col = dark ? "rgba(247,244,236,0.55)" : "rgba(20,20,20,0.5)";
  const line = dark ? "rgba(247,244,236,0.18)" : "rgba(20,20,20,0.14)";
  const secs = frame / 30;
  const tc = `00:${String(Math.floor(secs)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`;
  const label: React.CSSProperties = { position: "absolute", fontFamily: fonts.mono, fontSize: 15, letterSpacing: "0.14em", color: col, textTransform: "uppercase" };
  const corner = (pos: React.CSSProperties, rot: number) => (
    <div style={{ position: "absolute", width: 22, height: 22, borderTop: `1.5px solid ${line}`, borderLeft: `1.5px solid ${line}`, transform: `rotate(${rot}deg)`, ...pos }} />
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {corner({ left: 36, top: 36 }, 0)}
      {corner({ right: 36, top: 36 }, 90)}
      {corner({ right: 36, bottom: 36 }, 180)}
      {corner({ left: 36, bottom: 36 }, 270)}
      <div style={{ ...label, left: 70, top: 40 }}>
        <span style={{ color: dark ? c.apricot : c.ink, fontWeight: 700 }}>BOUND</span> · ORIGIN-AWARE WALLET POLICY
      </div>
      <div style={{ ...label, right: 70, top: 40, fontVariantNumeric: "tabular-nums" }}>
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 9, background: dark ? c.rust : c.green, marginRight: 10, verticalAlign: 1 }} />
        {tc}
      </div>
      <div style={{ ...label, left: 70, bottom: 40 }}>{act}</div>
      <div style={{ ...label, right: 70, bottom: 40, display: "flex", alignItems: "center", gap: 16 }}>
        {scene}
        <div style={{ width: 180, height: 2, background: line, position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(frame / total) * 100}%`, background: dark ? c.apricot : c.ink }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
