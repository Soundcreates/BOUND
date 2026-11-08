import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { c, clamp, expoOut, fonts } from "../theme";
import { Mark, Typewriter } from "./ui";

export const SITE = "swap.example"; // fictional dApp, as in client/demo/test-dapp
export const ATTACKER = "0x7a3F…dE4d";

const Lock: React.FC<{ color?: string; size?: number }> = ({ color = "#a8d8c4", size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16">
    <rect x="3" y="7" width="10" height="8" rx="1.5" fill={color} />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke={color} strokeWidth="1.8" fill="none" />
  </svg>
);

/** Browser chrome. `children` is the page. */
export const Browser: React.FC<{
  width: number;
  height: number;
  urlAt?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  lockPulse?: number;
}> = ({ width, height, urlAt = 0, children, style, lockPulse }) => {
  const frame = useCurrentFrame();
  const pulse = lockPulse === undefined ? 0 : interpolate(frame, [lockPulse, lockPulse + 10, lockPulse + 30], [0, 1, 0], clamp);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: "hidden",
        background: c.slate,
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div style={{ height: 64, display: "flex", alignItems: "center", gap: 18, padding: "0 22px", background: c.navy, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((col) => (
            <div key={col} style={{ width: 14, height: 14, borderRadius: 99, background: col }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            background: c.night,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px",
            boxShadow: pulse > 0 ? `0 0 0 ${3 * pulse}px rgba(122,212,143,${0.6 * pulse})` : undefined,
          }}
        >
          <Lock />
          <Typewriter text={`https://${SITE}`} at={urlAt} cps={1.2} size={20} color="#e8e6df" caret={false} />
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", background: c.sand }}>{children}</div>
    </div>
  );
};

/** Generic swap page. */
export const SwapPage: React.FC<{ at?: number; scale?: number }> = ({ at = 0, scale = 1 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 20], [0, 1], { ...clamp, easing: expoOut });
  const row = (label: string, amt: string, token: string) => (
    <div style={{ background: c.sand, borderRadius: 16, padding: "18px 22px", marginBottom: 10 }}>
      <div style={{ fontFamily: fonts.sans, fontSize: 15, color: "#5c626a", fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <div style={{ fontFamily: fonts.sans, fontSize: 40, fontWeight: 600, color: "#181d26", letterSpacing: "-0.02em" }}>{amt}</div>
        <div style={{ fontFamily: fonts.sans, fontSize: 18, fontWeight: 700, background: "#fff", borderRadius: 99, padding: "8px 16px", border: "1px solid #e4e1d8" }}>{token}</div>
      </div>
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", boxSizing: "border-box" }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 800, fontSize: 22, color: "#181d26" }}>◐ swap</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 15, background: "#181d26", color: "#fff", borderRadius: 99, padding: "8px 14px" }}>0x91c…44e0</div>
      </div>
      <div
        style={{
          marginTop: 30 * scale,
          width: 460,
          background: "#fff",
          borderRadius: 26,
          padding: 18,
          boxShadow: "0 18px 50px rgba(0,0,0,0.08)",
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px) scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        <div style={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: 20, padding: "4px 6px 14px" }}>Swap</div>
        {row("You pay", "12.40", "ETH")}
        {row("You receive", "41,230.55", "USDC")}
        <div style={{ marginTop: 8, height: 62, borderRadius: 16, background: "#181d26", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.sans, fontWeight: 700, fontSize: 20 }}>
          Review swap
        </div>
      </div>
    </div>
  );
};

/** Generic wallet confirmation popup — deliberately looks ordinary. */
export const WalletPopup: React.FC<{ pressAt?: number }> = ({ pressAt = 9999 }) => {
  const frame = useCurrentFrame();
  const pressed = frame >= pressAt && frame < pressAt + 6;
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.07)", fontFamily: fonts.sans, fontSize: 21 }}>
      <span style={{ color: "#aab0b5" }}>{k}</span>
      <span style={{ color: "#f7f4ec", fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ width: 600, background: c.navy, borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 50px 140px rgba(0,0,0,0.7)", overflow: "hidden" }}>
      <div style={{ padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: 19, color: "#f7f4ec" }}>Wallet</span>
        <span style={{ fontFamily: fonts.mono, fontSize: 16, color: "#aab0b5", display: "flex", gap: 8, alignItems: "center" }}>
          <Lock size={14} /> {SITE}
        </span>
      </div>
      <div style={{ padding: "26px 28px 8px" }}>
        <div style={{ fontFamily: fonts.sans, fontSize: 15, letterSpacing: "0.1em", color: "#aab0b5", fontWeight: 700 }}>SPENDING CAP REQUEST</div>
        <div style={{ fontFamily: fonts.sans, fontSize: 32, fontWeight: 700, color: "#f7f4ec", lineHeight: 1.2, marginTop: 10, letterSpacing: "-0.02em" }}>
          Allow {SITE} to spend your USDC?
        </div>
        <div style={{ marginTop: 14 }}>
          {row("Spender", <span style={{ fontFamily: fonts.mono }}>{ATTACKER}</span>)}
          {row("Spending cap", "Unlimited")}
          {row("Network", "Ethereum")}
          {row("Est. fee", "$1.84")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, padding: "22px 28px 28px" }}>
        <div style={{ flex: 1, height: 62, borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.sans, fontWeight: 700, fontSize: 20, color: "#f7f4ec" }}>
          Reject
        </div>
        <div
          style={{
            flex: 1,
            height: 62,
            borderRadius: 14,
            background: pressed ? "#cfcbbf" : "#f7f4ec",
            transform: `scale(${pressed ? 0.96 : 1})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 20,
            color: "#111",
          }}
        >
          Confirm
        </div>
      </div>
    </div>
  );
};

/** BOUND's extension-owned warning window (copy mirrors client/extension/warning.js). */
export const WarningWindow: React.FC<{ at: number; pressAt?: number }> = ({ at, pressAt = 9999 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 18], [0, 1], { ...clamp, easing: expoOut });
  const pressed = frame >= pressAt && frame < pressAt + 6;
  const row = (k: string, v: React.ReactNode, i: number) => {
    const rp = interpolate(frame, [at + 10 + i * 4, at + 24 + i * 4], [0, 1], { ...clamp, easing: expoOut });
    return (
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", padding: "13px 0", borderTop: `1px solid ${c.border}`, opacity: rp, transform: `translateX(${(1 - rp) * 20}px)` }}>
        <span style={{ fontFamily: fonts.mono, fontSize: 16, color: c.muted, textTransform: "uppercase", letterSpacing: "0.08em", paddingTop: 3 }}>{k}</span>
        <span style={{ fontFamily: fonts.sans, fontSize: 20, color: c.ink, fontWeight: 600 }}>{v}</span>
      </div>
    );
  };
  return (
    <div
      style={{
        width: 720,
        background: c.canvas,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow: "0 60px 160px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.2)",
        opacity: p,
        transform: `translateX(${(1 - p) * 160}px) scale(${0.94 + 0.06 * p})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 26px", background: c.paper, borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mark height={34} />
          <span style={{ fontFamily: fonts.sans, fontWeight: 800, fontSize: 20, letterSpacing: "0.06em" }}>BOUND</span>
        </div>
        <span style={{ fontFamily: fonts.mono, fontSize: 16, fontWeight: 700, color: "#fff", background: c.dangerDeep, borderRadius: 99, padding: "7px 14px" }}>ESCALATED · 15/100</span>
      </div>
      <div style={{ padding: "22px 26px 26px" }}>
        <div style={{ fontFamily: fonts.serif, fontSize: 46, lineHeight: 1.05, color: c.ink }}>
          Stop: BOUND found a <span style={{ fontStyle: "italic", color: c.dangerDeep }}>serious problem</span>
        </div>
        <div style={{ marginTop: 18 }}>
          {row("Site", SITE, 0)}
          {row("Asks for", "Unlimited USDC approval", 1)}
          {row(
            "Spender",
            <span>
              <span style={{ fontFamily: fonts.mono }}>{ATTACKER}</span>
              <span style={{ color: c.dangerDeep }}> · never used by this site</span>
            </span>,
            2,
          )}
          {row("Role", "Rights — can move your tokens", 3)}
          {row("Site checks", "Nameservers + TLS changed 6 min ago", 4)}
        </div>
        <div style={{ marginTop: 16, height: 52, borderRadius: 12, border: `1.5px dashed ${c.muted}`, display: "flex", alignItems: "center", padding: "0 16px", fontFamily: fonts.mono, fontSize: 17, color: c.muted }}>
          Type I UNDERSTAND to continue this escalated request
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          <div
            style={{
              flex: 1.3,
              height: 60,
              borderRadius: 14,
              background: pressed ? "#000" : c.ink,
              color: c.lime,
              transform: `scale(${pressed ? 0.96 : 1})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fonts.sans,
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            Cancel transaction
          </div>
          <div style={{ flex: 1, height: 60, borderRadius: 14, border: `1.5px solid ${c.border}`, color: "#b3b0a6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.sans, fontWeight: 700, fontSize: 19 }}>
            Continue transaction
          </div>
        </div>
      </div>
    </div>
  );
};
