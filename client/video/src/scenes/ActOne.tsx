import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { ATTACKER, Browser, SITE, SwapPage, WalletPopup } from "../components/mocks";
import { Chip, Count, Cursor, Glitch, Grain, Kicker, Scramble, Typewriter, Vignette, Words } from "../components/ui";
import { c, clamp, easeInOut, easeOut, expoOut, fonts, lerp, pop } from "../theme";

/** Shared dark "before" backdrop: navy with a slow rust bloom. */
const Night: React.FC<{ bloom?: number; children?: React.ReactNode }> = ({ bloom = 0.25, children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: c.night }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${50 + Math.sin(frame / 60) * 6}% 40%, rgba(170,45,0,${bloom}) 0%, rgba(24,29,38,0.0) 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
        }}
      />
      {children}
      <Vignette strength={0.7} />
      <Grain opacity={0.1} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 0 - 4 s   Cold open                                                 */
/* ------------------------------------------------------------------ */
export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const sec = 57 + Math.floor(frame / 30);
  const mm = sec >= 60 ? "54" : "53";
  const ss = String(sec % 60).padStart(2, "0");
  const hit = frame >= 90;
  const zoom = interpolate(frame, [0, 120], [1, 1.06]);
  return (
    <Night bloom={interpolate(frame, [0, 120], [0.05, 0.22])}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${zoom})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 44 }}>
          <span style={{ width: 12, height: 12, borderRadius: 9, background: c.rust, opacity: Math.floor(frame / 15) % 2 ? 0.35 : 1, boxShadow: `0 0 18px ${c.rust}` }} />
          <Typewriter text="14 APR 2026 · ETHEREUM MAINNET ·" at={4} cps={1.4} size={26} color={c.creamDim} caret={false} />
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 26,
              color: hit ? c.salmon : c.creamDim,
              opacity: frame > 26 ? 1 : 0,
              fontVariantNumeric: "tabular-nums",
              textShadow: hit ? `0 0 24px ${c.rust}` : undefined,
            }}
          >
            14:{mm}:{ss} UTC
          </span>
        </div>
        <Words text="It starts like any" at={16} stagger={4} size={150} color={c.canvas} align="center" />
        <Words text="other *swap.*" at={34} stagger={5} size={150} color={c.canvas} accent={c.apricot} align="center" />
      </AbsoluteFill>
    </Night>
  );
};

/* ------------------------------------------------------------------ */
/* 4 - 10 s  Everything looks right                                    */
/* ------------------------------------------------------------------ */
const CHECKS = ["Right URL", "Green padlock", "Audited contracts", "The interface you know"];

export const Normal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rot = lerp(frame, 0, 180, -14, -4, easeInOut);
  const push = lerp(frame, 0, 180, 0.92, 1.0, easeInOut);
  const flicker = frame >= 168 && frame < 172 ? 1 : 0;
  return (
    <Night bloom={0.12}>
      <div style={{ position: "absolute", left: 130, top: 190, width: 640 }}>
        <Kicker at={2} color={c.apricot}>
          What the user sees
        </Kicker>
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 26 }}>
          {CHECKS.map((t, i) => {
            const at = 14 + i * 22;
            const s = pop(frame, fps, at, 12, 180);
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 22, opacity: Math.min(1, s * 1.5), transform: `translateX(${(1 - s) * -30}px)` }}>
                <div style={{ width: 52, height: 52, borderRadius: 99, background: c.mint, display: "grid", placeItems: "center", transform: `scale(${s})` }}>
                  <svg width="26" height="26" viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke={c.forest} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" strokeDashoffset={30 * (1 - Math.min(1, s))} />
                  </svg>
                </div>
                <span style={{ fontFamily: fonts.sans, fontSize: 42, fontWeight: 600, color: c.canvas, letterSpacing: "-0.02em" }}>{t}</span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 70 }}>
          <Words text="Everything *looks* normal." at={112} stagger={4} size={96} color={c.canvas} accent={c.apricot} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 830, top: 170, perspective: 1800 }}>
        <div style={{ transform: `rotateY(${rot}deg) scale(${push})`, transformOrigin: "left center" }}>
          <Browser width={980} height={720} urlAt={6} lockPulse={36}>
            <SwapPage at={10} scale={1.18} />
            {flicker ? <AbsoluteFill style={{ background: "rgba(170,45,0,0.35)" }} /> : null}
          </Browser>
        </div>
      </div>
    </Night>
  );
};

/* ------------------------------------------------------------------ */
/* 10 - 16 s Registrar hijack                                          */
/* ------------------------------------------------------------------ */
const DNS = [
  { k: "NS", from: "ns1.trusted-dns.net", to: "ns1.parked-x9.net" },
  { k: "A", from: "104.18.22.7", to: "45.95.11.203" },
  { k: "TLS", from: "issuer R11 · 61 days left", to: "new cert · issued 14:52" },
  { k: "JS", from: "app.3f9a.js · 412 kB", to: "app.3f9a.js · +1 drainer" },
];

export const Hijack: React.FC = () => {
  const frame = useCurrentFrame();
  const g = interpolate(frame, [0, 14], [1, 0], clamp) + (frame >= 96 && frame < 104 ? 0.7 : 0);
  const morph = frame >= 100;
  return (
    <Glitch amount={g} seed="hij">
      <Night bloom={0.32}>
        <div style={{ position: "absolute", left: 130, top: 150 }}>
          <Kicker at={4} color={c.salmon}>
            Meanwhile · registrar takeover
          </Kicker>
        </div>
        {/* DNS / infra table */}
        <div style={{ position: "absolute", left: 130, top: 220, width: 860, borderRadius: 20, background: c.nightPanel, border: `1px solid ${c.nightLine}`, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "18px 26px", borderBottom: `1px solid ${c.nightLine}`, fontFamily: fonts.mono, fontSize: 17, color: c.greyLight, letterSpacing: "0.1em" }}>
            <span>{SITE.toUpperCase()} · WHAT THE BROWSER IS SERVED</span>
            <span style={{ color: c.salmon }}>● LIVE</span>
          </div>
          {DNS.map((r, i) => {
            const at = 16 + i * 22;
            const strike = interpolate(frame, [at, at + 10], [0, 1], { ...clamp, easing: easeOut });
            return (
              <div key={r.k} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "center", padding: "20px 26px", borderBottom: i < 3 ? `1px solid ${c.nightLine}` : undefined }}>
                <span style={{ fontFamily: fonts.mono, fontSize: 20, color: c.greyLight }}>{r.k}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ position: "relative", fontFamily: fonts.mono, fontSize: 24, color: strike > 0 ? "rgba(247,244,236,0.35)" : c.canvas, alignSelf: "flex-start" }}>
                    {r.from}
                    <span style={{ position: "absolute", left: 0, top: "52%", height: 2.5, width: `${strike * 100}%`, background: c.rust }} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 14, height: 34 }}>
                    {frame >= at + 4 ? (
                      <>
                        <span style={{ color: c.rust, fontFamily: fonts.mono, fontSize: 24 }}>→</span>
                        <Scramble text={r.to} at={at + 4} dur={14} seed={r.k} style={{ fontSize: 26, color: c.salmon, fontWeight: 700 }} />
                        <Chip at={at + 14} dark tone="danger" size={14}>
                          CHANGED
                        </Chip>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {/* the same page, different code */}
        <div style={{ position: "absolute", left: 1050, top: 220 }}>
          <Browser width={740} height={560} urlAt={-100}>
            <SwapPage scale={0.86} at={-100} />
            <div
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                bottom: 24,
                borderRadius: 14,
                background: c.night,
                padding: "18px 22px",
                fontFamily: fonts.mono,
                fontSize: 21,
                lineHeight: 1.55,
                color: c.canvas,
                boxShadow: morph ? `0 0 0 2px ${c.rust}, 0 0 50px rgba(170,45,0,0.5)` : "0 10px 30px rgba(0,0,0,0.3)",
                opacity: interpolate(frame, [40, 54], [0, 1], clamp),
              }}
            >
              <div style={{ color: c.greyLight }}>{"// app.3f9a.js — served from " + SITE}</div>
              {!morph ? (
                <div>
                  <span style={{ color: c.sage }}>await</span> router.swap(order)
                </div>
              ) : (
                <>
                  <div>
                    <span style={{ color: c.sage }}>await</span> usdc.<span style={{ color: c.salmon }}>approve</span>(
                  </div>
                  <div style={{ paddingLeft: 28 }}>
                    <Scramble text={`"${ATTACKER}",`} at={100} dur={12} seed="atk" style={{ color: c.salmon }} />
                    <span style={{ color: c.greyLight }}> // not the router</span>
                  </div>
                  <div style={{ paddingLeft: 28, color: c.salmon }}>MAX_UINT256</div>
                  <div>)</div>
                </>
              )}
            </div>
          </Browser>
        </div>
        <div style={{ position: "absolute", left: 130, bottom: 130 }}>
          <Words text="Same address. *Different code.*" at={118} stagger={4} size={104} color={c.canvas} accent={c.salmon} />
        </div>
      </Night>
    </Glitch>
  );
};

/* ------------------------------------------------------------------ */
/* 16 - 22 s One signature. $1.2M gone                                 */
/* ------------------------------------------------------------------ */
export const Sign: React.FC = () => {
  const frame = useCurrentFrame();
  const CLICK = 50;
  const popOut = interpolate(frame, [CLICK + 4, CLICK + 18], [0, 1], { ...clamp, easing: easeInOut });
  const flash = interpolate(frame, [CLICK + 4, CLICK + 8, CLICK + 30], [0, 0.85, 0], clamp);
  const shake = frame > CLICK + 4 && frame < CLICK + 22 ? (random(`sh${frame}`) - 0.5) * 22 * (1 - (frame - CLICK - 4) / 18) : 0;
  const after = frame >= CLICK + 16;
  const bar = interpolate(frame, [96, 156], [0, 1], { ...clamp, easing: easeOut });
  return (
    <Night bloom={after ? 0.5 : 0.2}>
      <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.4}px)` }}>
        {/* the wallet prompt */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - popOut, transform: `scale(${1 - popOut * 0.25}) translateY(${interpolate(frame, [0, 16], [40, 0], { ...clamp, easing: expoOut })}px)` }}>
          <WalletPopup pressAt={CLICK} />
        </AbsoluteFill>
        <Cursor path={[[6, 1500, 960], [44, 1090, 752], [70, 1090, 752]]} clickAt={[CLICK]} until={CLICK + 6} />

        {after ? (
          <AbsoluteFill style={{ padding: "150px 130px 0" }}>
            <Kicker at={CLICK + 16} color={c.salmon}>
              This happened · cow.fi · 14 April 2026
            </Kicker>
            <div style={{ marginTop: 26, fontFamily: fonts.sans, fontWeight: 800, fontSize: 250, letterSpacing: "-0.055em", lineHeight: 0.9, color: c.canvas }}>
              $<Count from={0} to={1200000} at={CLICK + 16} dur={76} />
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 30 }}>
              <Chip at={CLICK + 30} dark tone="danger" size={22}>
                drained in ~3 hours
              </Chip>
              <Chip at={CLICK + 40} dark tone="danger" size={22}>
                219 ETH from a single trader
              </Chip>
            </div>
            {/* the silent window */}
            <div style={{ position: "absolute", left: 130, right: 130, top: 700 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fonts.mono, fontSize: 22, color: c.creamDim, marginBottom: 16, opacity: interpolate(frame, [90, 100], [0, 1], clamp) }}>
                <span>
                  <span style={{ color: c.salmon }}>14:54</span> hijack begins
                </span>
                <span>
                  first public warning <span style={{ color: c.canvas }}>15:41</span>
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 9, background: c.nightLine, overflow: "hidden" }}>
                <div style={{ width: `${bar * 100}%`, height: "100%", background: `linear-gradient(90deg, ${c.rust}, ${c.salmon})` }} />
              </div>
              <div style={{ marginTop: 18, fontFamily: fonts.serif, fontStyle: "italic", fontSize: 54, color: c.canvas, opacity: interpolate(frame, [130, 144], [0, 1], clamp) }}>
                47 minutes of silence.
              </div>
            </div>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: c.rust, opacity: flash, mixBlendMode: "screen" }} />
    </Night>
  );
};

/* ------------------------------------------------------------------ */
/* 22 - 26 s The gap (ends on half a second of black)                  */
/* ------------------------------------------------------------------ */
export const Gap: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [92, 104], [1, 0], { ...clamp, easing: easeInOut });
  const sc = interpolate(frame, [92, 104], [1, 0.94], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out, transform: `scale(${sc})` }}>
        <Words text="Every warning sign" at={2} stagger={4} size={128} color={c.canvas} align="center" />
        <Words text="was *already there.*" at={16} stagger={5} size={128} color={c.canvas} accent={c.apricot} align="center" />
        <div style={{ marginTop: 50 }}>
          <Typewriter text="NOBODY WAS CHECKING." at={46} cps={0.9} size={34} color={c.salmon} />
        </div>
      </AbsoluteFill>
      <Grain opacity={0.08} />
    </AbsoluteFill>
  );
};
