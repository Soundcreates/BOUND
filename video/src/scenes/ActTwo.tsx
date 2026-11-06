import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ATTACKER, SITE, WarningWindow } from "../components/mocks";
import { Chip, Cursor, DotGrid, Grain, Kicker, Mark, Vignette, Wordmark, Words } from "../components/ui";
import { c, clamp, easeInOut, easeOut, expoOut, fonts, lerp, pop } from "../theme";

const Canvas: React.FC<{ children?: React.ReactNode; bg?: string }> = ({ children, bg = c.canvas }) => (
  <AbsoluteFill style={{ background: bg }}>
    <DotGrid />
    {children}
    <Grain opacity={0.05} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ */
/* 26 - 32 s Reveal                                                    */
/* ------------------------------------------------------------------ */
export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iris = interpolate(frame, [0, 16], [0, 140], { ...clamp, easing: expoOut });
  const flash = interpolate(frame, [0, 3, 14], [0, 1, 0], clamp);
  const s = pop(frame, fps, 2, 11, 120);
  const lift = lerp(frame, 54, 82, 0, 1, easeInOut);
  const glint = interpolate(frame, [12, 22, 40], [0, 1, 0.25], clamp);
  const wordClip = interpolate(frame, [14, 30], [100, 0], { ...clamp, easing: expoOut });
  const hl = interpolate(frame, [112, 128], [0, 1], { ...clamp, easing: expoOut });
  return (
    <AbsoluteFill style={{ background: c.navy }}>
      <AbsoluteFill style={{ clipPath: `circle(${iris}% at 50% 50%)` }}>
        <Canvas>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                transform: `translateY(${lift * -250}px) scale(${(0.6 + 0.4 * s) * (1 - lift * 0.5)})`,
              }}
            >
              <div style={{ position: "relative" }}>
                <Mark height={360} />
                <Img
                  src={staticFile("brand/mark-lime.png")}
                  style={{ position: "absolute", left: 0, top: 0, height: 360, width: (360 * 640) / 855, opacity: glint, filter: `drop-shadow(0 0 ${24 * glint}px ${c.lime}) drop-shadow(0 0 ${50 * glint}px ${c.lime})` }}
                />
              </div>
              <div style={{ marginTop: 26, clipPath: `inset(${wordClip}% 0 0 0)` }}>
                <Wordmark height={100} />
              </div>
            </div>
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 190 }}>
            <Kicker at={74} style={{ marginBottom: 26 }}>
              Origin-aware wallet policy · Chromium extension
            </Kicker>
            <Words text="Know where your signature is going" at={80} stagger={3} size={108} align="center" />
            <div style={{ position: "relative", display: "inline-block", marginTop: 4 }}>
              <div style={{ position: "absolute", left: -16, right: -16, top: "18%", bottom: "6%", background: c.lime, transform: `scaleX(${hl})`, transformOrigin: "left center", borderRadius: 6 }} />
              <div style={{ position: "relative" }}>
                <Words text="*before you sign.*" at={100} stagger={4} size={108} align="center" />
              </div>
            </div>
          </AbsoluteFill>
        </Canvas>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: c.paper, opacity: flash }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 32 - 38 s Two questions                                             */
/* ------------------------------------------------------------------ */
const Panel: React.FC<{ at: number; x: number; n: string; title: string; children: React.ReactNode }> = ({ at, x, n, title, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(frame, fps, at, 15, 110);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 230,
        width: 800,
        height: 560,
        borderRadius: 28,
        background: c.ink,
        padding: "40px 44px",
        boxSizing: "border-box",
        color: c.canvas,
        opacity: Math.min(1, s * 1.4),
        transform: `translateY(${(1 - s) * 140}px) rotate(${(1 - s) * (x < 900 ? -3 : 3)}deg)`,
        boxShadow: "0 40px 90px rgba(20,20,20,0.22)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
        <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 120, lineHeight: 0.8, color: c.lime }}>{n}</span>
      </div>
      <div style={{ marginTop: 18 }}>
        <Words text={title} at={at + 6} stagger={2} size={50} color={c.canvas} accent={c.lime} lineHeight={1.08} />
      </div>
      <div style={{ marginTop: 26 }}>{children}</div>
    </div>
  );
};

const SignalRow: React.FC<{ at: number; k: string; v: string; tone?: string }> = ({ at, k, v, tone = c.sage }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 12], [0, 1], { ...clamp, easing: expoOut });
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid rgba(247,244,236,0.1)", opacity: p, transform: `translateX(${(1 - p) * 24}px)` }}>
      <span style={{ fontFamily: fonts.mono, fontSize: 21, color: c.canvas }}>{k}</span>
      <span style={{ fontFamily: fonts.mono, fontSize: 18, color: tone, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: tone }} />
        {v}
      </span>
    </div>
  );
};

export const Questions: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Canvas>
      <div style={{ position: "absolute", left: 120, top: 130 }}>
        <Kicker at={2}>Two questions · every value-moving request</Kicker>
      </div>
      <Panel at={4} x={120} n="01" title="Is this site *behaving* differently?">
        <SignalRow at={30} k="Nameservers" v="DNS-over-HTTPS" />
        <SignalRow at={35} k="TLS certificate" v="direct poll" />
        <SignalRow at={40} k="Serving IP · outbound hosts" v="page load" />
        <SignalRow at={45} k="The site's own history" v="Arkiv record" />
      </Panel>
      <Panel at={36} x={1000} n="02" title="Is this exact action *authorized* here?">
        <SignalRow at={62} k="trustedCounterparties" v="snapshot ✓" tone={c.lime} />
        <SignalRow at={67} k="trustedContracts" v="snapshot ✓" tone={c.lime} />
        <SignalRow at={72} k="protocol self-attestation" v="ENSv2 +40" tone={c.lime} />
        <SignalRow at={77} k="deployer lineage" v="+15" tone={c.lime} />
      </Panel>
      <div style={{ position: "absolute", left: 120, top: 840, width: 1700, opacity: interpolate(frame, [104, 116], [0, 1], clamp) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.12em", color: c.muted }}>THE RULE</span>
          <div style={{ flex: 1, height: 1, background: c.border }} />
        </div>
        <div style={{ marginTop: 16 }}>
          <Words text="Behaviour can only *lower* a verdict. Only authorization can *pass* one." at={108} stagger={2} size={56} />
        </div>
      </div>
    </Canvas>
  );
};

/* ------------------------------------------------------------------ */
/* 38 - 46 s Replay — same hijack, now with BOUND                      */
/* ------------------------------------------------------------------ */
const STEPS = [
  { at: 34, text: "Spender never used by this site", tag: "RIGHTS ROLE · CAP 35", score: 35 },
  { at: 60, text: "Nameservers changed 6 min ago", tag: "DRIFT · −30", score: 35 },
  { at: 82, text: "TLS issuer changed · corroborated", tag: "CAP → 15", score: 15 },
];

const stateFor = (v: number) =>
  v >= 70 ? { label: "GREEN", col: c.green } : v >= 40 ? { label: "AMBER", col: c.amber } : v >= 16 ? { label: "RED", col: c.danger } : { label: "ESCALATED", col: c.dangerDeep };

export const Replay: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const score = interpolate(frame, [20, 30, 34, 46, 82, 96], [0, 50, 50, 35, 35, 15], { ...clamp, easing: easeOut });
  const st = stateFor(score);
  const reqIn = pop(frame, fps, 2, 14, 140);
  const freeze = interpolate(frame, [14, 22], [0, 1], clamp);
  const CANCEL = 186;
  const stamp = pop(frame, fps, CANCEL + 2, 9, 220);
  const dim = interpolate(frame, [CANCEL + 2, CANCEL + 12], [0, 1], clamp);
  const R = 150;
  const circ = 2 * Math.PI * R;
  return (
    <AbsoluteFill style={{ background: c.navy }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 70% at 55% 45%, rgba(214,255,0,0.07), transparent 60%)` }} />
      <div style={{ position: "absolute", left: 110, top: 128 }}>
        <Kicker at={0} color={c.lime}>
          Same hijack · now with BOUND
        </Kicker>
      </div>

      {/* intercepted request */}
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 200,
          width: 640,
          borderRadius: 20,
          background: c.slate,
          border: `1px solid ${freeze > 0.5 ? "rgba(214,255,0,0.5)" : c.nightLine}`,
          padding: "22px 26px",
          boxSizing: "border-box",
          opacity: reqIn,
          transform: `translateY(${(1 - reqIn) * 50}px)`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 17, color: c.greyLight, letterSpacing: "0.1em" }}>EIP-1193 · eth_sendTransaction</span>
          <Chip at={14} tone="lime" size={14}>
            ❄ INTERCEPTED · FROZEN
          </Chip>
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 30, color: c.canvas, marginTop: 16 }}>
          approve(<span style={{ color: c.salmon }}>{ATTACKER}</span>, 2²⁵⁶−1)
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 18, color: c.greyLight, marginTop: 8 }}>origin {SITE} · chain 1 · decoded locally</div>
      </div>

      {/* signal ledger */}
      <div style={{ position: "absolute", left: 110, top: 440, width: 640 }}>
        {STEPS.map((s, i) => {
          const p = interpolate(frame, [s.at, s.at + 12], [0, 1], { ...clamp, easing: expoOut });
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", borderTop: `1px solid ${c.nightLine}`, opacity: p, transform: `translateX(${(1 - p) * -30}px)` }}>
              <span style={{ fontFamily: fonts.sans, fontSize: 26, fontWeight: 600, color: c.canvas }}>{s.text}</span>
              <span style={{ fontFamily: fonts.mono, fontSize: 16, color: c.salmon, border: "1px solid rgba(255,199,168,0.4)", borderRadius: 99, padding: "6px 12px", whiteSpace: "nowrap" }}>{s.tag}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 18, fontFamily: fonts.mono, fontSize: 17, color: c.greyLight, opacity: interpolate(frame, [100, 112], [0, 1], clamp) }}>
          500 fake witnesses or an 8-day-old verified contract? Still capped.
        </div>
      </div>

      {/* score dial */}
      <div style={{ position: "absolute", left: 800, top: 230, width: 400, height: 400, opacity: interpolate(frame, [16, 28], [0, 1], clamp) }}>
        <svg width="400" height="400" viewBox="0 0 400 400">
          <circle cx="200" cy="200" r={R} stroke={c.nightLine} strokeWidth="16" fill="none" />
          <circle
            cx="200"
            cy="200"
            r={R}
            stroke={st.col}
            strokeWidth="16"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - score / 100)}
            transform="rotate(-90 200 200)"
            style={{ filter: `drop-shadow(0 0 14px ${st.col})` }}
          />
        </svg>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: fonts.sans, fontWeight: 800, fontSize: 150, color: c.canvas, letterSpacing: "-0.05em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{Math.round(score)}</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: "0.16em", color: st.col === c.dangerDeep ? c.salmon : st.col, marginTop: 8, fontWeight: 700 }}>{frame >= 28 ? st.label : ""}</div>
        </AbsoluteFill>
        <div style={{ textAlign: "center", fontFamily: fonts.mono, fontSize: 16, color: c.greyLight, marginTop: 6 }}>scored locally · {"<"} 5 ms</div>
      </div>

      {/* the extension-owned warning */}
      <div style={{ position: "absolute", left: 1150, top: 150, transform: "scale(0.92)", transformOrigin: "top left", opacity: 1 - dim * 0.35 }}>
        <WarningWindow at={112} pressAt={CANCEL} />
      </div>
      <Cursor path={[[140, 1700, 1000], [176, 1345, 642], [210, 1345, 642]]} clickAt={[CANCEL]} until={CANCEL + 8} />

      {/* outcome */}
      {frame >= CANCEL + 2 ? (
        <div
          style={{
            position: "absolute",
            left: 1270,
            top: 380,
            transform: `rotate(-8deg) scale(${2 - stamp})`,
            opacity: Math.min(1, stamp * 1.5),
            border: `5px solid ${c.lime}`,
            background: c.ink,
            color: c.lime,
            borderRadius: 16,
            padding: "16px 28px",
            fontFamily: fonts.mono,
            fontWeight: 700,
            fontSize: 44,
            letterSpacing: "0.06em",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          }}
        >
          CANCELLED · 4001
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 110, bottom: 120 }}>
        <Words text="$0 lost. *Your wallet never saw it.*" at={CANCEL + 6} stagger={3} size={84} color={c.canvas} accent={c.lime} />
      </div>
      <Vignette strength={0.45} />
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 46 - 52 s Trust chain                                               */
/* ------------------------------------------------------------------ */
type Node = { id: string; x: number; y: number; w: number; t: string; s: string; at: number; tone?: "ink" | "lime" | "mint" | "peach" };
const NODES: Node[] = [
  { id: "cur", x: 110, y: 250, w: 290, t: "Curator", s: "reviews published addresses", at: 4, tone: "peach" },
  { id: "snap", x: 520, y: 250, w: 290, t: "snapshot.json", s: "sites → trusted addresses", at: 12 },
  { id: "swarm", x: 930, y: 250, w: 290, t: "Swarm", s: "content-addressed copy", at: 20 },
  { id: "ens", x: 930, y: 470, w: 290, t: "ENSv2 root", s: "hash + epoch · curator role", at: 28, tone: "ink" },
  { id: "ext", x: 1400, y: 380, w: 400, t: "BOUND extension", s: "hash match → accept", at: 40, tone: "lime" },
  { id: "arkiv", x: 1130, y: 700, w: 350, t: "Arkiv", s: "live record · drift · incidents · expiring", at: 48, tone: "mint" },
  { id: "anon", x: 1520, y: 700, w: 330, t: "Anon-RPC", s: "chain reads without linking you", at: 56, tone: "mint" },
];
const EDGES: { a: string; b: string; at: number; label?: string }[] = [
  { a: "cur", b: "snap", at: 10, label: "compiles" },
  { a: "snap", b: "swarm", at: 18, label: "uploads" },
  { a: "snap", b: "ens", at: 26, label: "hash" },
  { a: "swarm", b: "ext", at: 40 },
  { a: "ens", b: "ext", at: 44 },
  { a: "arkiv", b: "ext", at: 54 },
  { a: "anon", b: "ext", at: 60 },
];
const NH = 120;
const port = (n: Node, side: "l" | "r" | "t" | "b") =>
  side === "l" ? { x: n.x, y: n.y + NH / 2 } : side === "r" ? { x: n.x + n.w, y: n.y + NH / 2 } : side === "t" ? { x: n.x + n.w / 2, y: n.y } : { x: n.x + n.w / 2, y: n.y + NH };

export const Chain: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const pathFor = (a: Node, b: Node) => {
    let p0, p1;
    if (Math.abs(a.y - b.y) < 10) {
      p0 = port(a, "r");
      p1 = port(b, "l");
    } else if (a.id === "arkiv" || a.id === "anon") {
      p0 = port(a, "t");
      p1 = { x: b.x + (a.id === "arkiv" ? b.w * 0.25 : b.w * 0.75), y: b.y + NH + 10 };
      const my = (p0.y + p1.y) / 2;
      return { d: `M ${p0.x} ${p0.y} C ${p0.x} ${my}, ${p1.x} ${my}, ${p1.x} ${p1.y}`, p0, p1 };
    } else if (b.id === "ext") {
      p0 = port(a, "r");
      p1 = port(b, "l");
    } else {
      p0 = port(a, "b");
      p1 = port(b, "l");
    }
    const mx = (p0.x + p1.x) / 2;
    return { d: `M ${p0.x} ${p0.y} C ${mx} ${p0.y}, ${mx} ${p1.y}, ${p1.x} ${p1.y}`, p0, p1 };
  };
  const ok = pop(frame, fps, 76, 10, 200);
  return (
    <Canvas>
      <div style={{ position: "absolute", left: 120, top: 130 }}>
        <Kicker at={2}>Trust anchored outside the site</Kicker>
      </div>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {EDGES.map((e, i) => {
          const { d, p0, p1 } = pathFor(byId[e.a], byId[e.b]);
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 1.25 + 40;
          const p = interpolate(frame, [e.at, e.at + 16], [0, 1], { ...clamp, easing: easeOut });
          const dotT = ((frame - e.at - 16) % 40) / 40;
          return (
            <g key={i}>
              <path d={d} stroke={c.ink} strokeOpacity={0.55} strokeWidth="2.5" fill="none" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
              {p >= 1 ? <TravelDot d={d} t={dotT} /> : null}
              {e.label ? (
                <text x={(p0.x + p1.x) / 2} y={(p0.y + p1.y) / 2 - 12} fill={c.muted} fontFamily={fonts.mono} fontSize="16" textAnchor="middle" opacity={p}>
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {NODES.map((n) => {
        const s = pop(frame, fps, n.at, 13, 160);
        const tone = n.tone ?? "paper";
        const bg = { paper: c.paper, ink: c.ink, lime: c.lime, mint: c.mint, peach: c.peach }[tone];
        const fg = tone === "ink" ? c.canvas : c.ink;
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: n.w,
              height: n.id === "ext" ? NH + 10 : NH,
              borderRadius: 18,
              background: bg,
              border: tone === "paper" ? `1.5px solid ${c.border}` : "none",
              boxShadow: "0 16px 40px rgba(20,20,20,0.10)",
              padding: "20px 24px",
              boxSizing: "border-box",
              opacity: Math.min(1, s * 1.4),
              transform: `scale(${0.7 + 0.3 * s})`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {n.id === "ext" ? <Mark height={34} /> : null}
              <span style={{ fontFamily: fonts.sans, fontWeight: 800, fontSize: n.id === "ext" ? 32 : 28, color: fg, letterSpacing: "-0.02em" }}>{n.t}</span>
            </div>
            <div style={{ fontFamily: fonts.mono, fontSize: 16, color: tone === "ink" ? c.greyLight : c.muted, marginTop: 8 }}>{n.s}</div>
          </div>
        );
      })}
      {/* verification badge */}
      <div
        style={{
          position: "absolute",
          left: 1400,
          top: 300,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: c.ink,
          color: c.lime,
          borderRadius: 99,
          padding: "12px 22px",
          fontFamily: fonts.mono,
          fontSize: 20,
          fontWeight: 700,
          opacity: ok,
          transform: `scale(${ok})`,
        }}
      >
        ✓ sha256 matches ENS root · epoch 7
      </div>
      <div style={{ position: "absolute", left: 120, bottom: 120, width: 1700 }}>
        <Words text="Owning the site's DNS grants *zero* power over its trust list." at={92} stagger={2} size={66} />
      </div>
    </Canvas>
  );
};

const TravelDot: React.FC<{ d: string; t: number }> = ({ d, t }) => {
  // sample a cubic bezier path string "M x y C x1 y1, x2 y2, x y"
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
  const u = 1 - t;
  const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
  const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
  return <circle cx={x} cy={y} r="7" fill={c.lime} stroke={c.ink} strokeWidth="2" />;
};

/* ------------------------------------------------------------------ */
/* 52 - 56 s Verdict spectrum                                          */
/* ------------------------------------------------------------------ */
const BANDS = [
  { range: "0–15", name: "Escalated", what: "full-screen · typed confirm", w: 15, col: c.dangerDeep },
  { range: "16–39", name: "Red", what: "warning window", w: 24, col: c.danger },
  { range: "40–69", name: "Amber", what: "quiet note · address named", w: 30, col: c.amber },
  { range: "70–100", name: "Green", what: "nothing — stays out of the way", w: 31, col: c.green },
];

export const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  const total = 1680;
  const marker = interpolate(frame, [10, 50], [0.97, 0.08], { ...clamp, easing: easeInOut });
  let acc = 0;
  return (
    <AbsoluteFill style={{ background: c.forest }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 20%, rgba(168,216,196,0.16), transparent 70%)` }} />
      <div style={{ position: "absolute", left: 120, top: 130 }}>
        <Kicker at={0} color={c.sage}>
          Local verdict · milliseconds · user decides
        </Kicker>
      </div>
      <div style={{ position: "absolute", left: 120, top: 250, width: total }}>
        <div style={{ display: "flex", height: 90, gap: 8 }}>
          {BANDS.map((b, i) => {
            const p = interpolate(frame, [4 + i * 5, 20 + i * 5], [0, 1], { ...clamp, easing: expoOut });
            return (
              <div key={b.name} style={{ width: `${b.w}%`, position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: b.col, transform: `scaleX(${p})`, transformOrigin: "left", border: "1px solid rgba(255,255,255,0.15)" }} />
                <div style={{ position: "absolute", left: 18, top: 26, fontFamily: fonts.mono, fontSize: 22, color: "#fff", opacity: p, fontWeight: 700 }}>{b.range}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", top: -26, left: `${marker * 100}%`, transform: "translateX(-50%)" }}>
          <div style={{ width: 0, height: 0, borderLeft: "12px solid transparent", borderRight: "12px solid transparent", borderTop: `16px solid ${c.lime}` }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
          {BANDS.map((b, i) => {
            acc += b.w;
            const p = interpolate(frame, [14 + i * 5, 28 + i * 5], [0, 1], { ...clamp, easing: expoOut });
            return (
              <div key={b.name} style={{ width: `${b.w}%`, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                <div style={{ fontFamily: fonts.serif, fontSize: 52, color: c.canvas, lineHeight: 1 }}>{b.name}</div>
                <div style={{ fontFamily: fonts.mono, fontSize: 17, color: c.sage, marginTop: 8 }}>{b.what}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 600 }}>
        <Words text="Warns. *Never blocks.*" at={44} stagger={4} size={150} color={c.canvas} accent={c.lime} />
        <div style={{ marginTop: 26, fontFamily: fonts.mono, fontSize: 24, color: c.sage, opacity: interpolate(frame, [70, 82], [0, 1], clamp) }}>
          Protects victim #1 — no blocklist entry, no prior victim, no dApp cooperation.
        </div>
      </div>
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 56 - 60 s Outro                                                     */
/* ------------------------------------------------------------------ */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(frame, fps, 0, 12, 140);
  const black = interpolate(frame, [104, 119], [0, 1], { ...clamp, easing: easeInOut });
  const glint = interpolate(frame, [6, 16, 40], [0, 1, 0.3], clamp);
  return (
    <Canvas>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40, transform: `scale(${0.8 + 0.2 * s})`, opacity: Math.min(1, s * 1.5) }}>
          <div style={{ position: "relative" }}>
            <Mark height={230} />
            <Img src={staticFile("brand/mark-lime.png")} style={{ position: "absolute", left: 0, top: 0, height: 230, width: (230 * 640) / 855, opacity: glint, filter: `drop-shadow(0 0 18px ${c.lime})` }} />
          </div>
          <Wordmark height={130} />
        </div>
        <div style={{ marginTop: 50 }}>
          <Words text="Trust what you *connect to.*" at={14} stagger={4} size={96} align="center" />
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 44 }}>
          {["ENSv2", "Arkiv", "Swarm", "Anon-RPC", "EIP-1193"].map((t, i) => (
            <Chip key={t} at={34 + i * 4} tone={i === 0 ? "lime" : "default"} size={20}>
              {t}
            </Chip>
          ))}
        </div>
        <div style={{ marginTop: 34, fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.16em", color: c.muted, opacity: interpolate(frame, [56, 68], [0, 1], clamp) }}>
          ETHGLOBAL MUMBAI 2026 · KNOW WHERE YOUR SIGNATURE IS GOING
        </div>
      </AbsoluteFill>
      <Vignette strength={0.12} color="20,20,20" />
      <AbsoluteFill style={{ background: "#000", opacity: black }} />
    </Canvas>
  );
};
