import React from "react";
import { Audio } from "@remotion/media";
import { linearTiming, TransitionPresentation, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Hud } from "./components/ui";
import { ColdOpen, Gap, Hijack, Normal, Sign } from "./scenes/ActOne";
import { Chain, Outro, Questions, Replay, Reveal, Verdict } from "./scenes/ActTwo";

type Tr = "fade" | "slide" | "wipe" | null;

// Durations in frames (30 fps). Every boundary sits on a 2-second bar of the 120 BPM score.
export const SCENES: { name: string; dur: number; C: React.FC; in: Tr; dark: boolean; act: string }[] = [
  { name: "ColdOpen", dur: 120, C: ColdOpen, in: null, dark: true, act: "ACT I · BEFORE" },
  { name: "Normal", dur: 180, C: Normal, in: "fade", dark: true, act: "ACT I · BEFORE" },
  { name: "Hijack", dur: 180, C: Hijack, in: null, dark: true, act: "ACT I · BEFORE" },
  { name: "Sign", dur: 180, C: Sign, in: "fade", dark: true, act: "ACT I · BEFORE" },
  { name: "Gap", dur: 120, C: Gap, in: null, dark: true, act: "ACT I · BEFORE" },
  { name: "Reveal", dur: 180, C: Reveal, in: null, dark: false, act: "ACT II · WITH BOUND" },
  { name: "Questions", dur: 180, C: Questions, in: "slide", dark: false, act: "ACT II · WITH BOUND" },
  { name: "Replay", dur: 240, C: Replay, in: "wipe", dark: true, act: "ACT II · WITH BOUND" },
  { name: "Chain", dur: 180, C: Chain, in: "wipe", dark: false, act: "ACT II · WITH BOUND" },
  { name: "Verdict", dur: 120, C: Verdict, in: "slide", dark: true, act: "ACT II · WITH BOUND" },
  { name: "Outro", dur: 120, C: Outro, in: "fade", dark: false, act: "BOUND" },
];
export const T = 12;
export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0); // 1800 = 60.0 s

export const START: Record<string, number> = {};
{
  let f = 0;
  for (const s of SCENES) {
    START[s.name] = f;
    f += s.dur;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pres = (t: Tr): TransitionPresentation<any> =>
  t === "slide" ? slide({ direction: "from-right" }) : t === "wipe" ? wipe({ direction: "from-bottom" }) : fade();

/** One-shot SFX list: [scene, local frame, file, volume] */
const SFX: [string, number, string, number][] = [
  // cold open — date typing + the minute flip to 14:54
  ...Array.from({ length: 12 }, (_, i) => ["ColdOpen", 4 + i * 2, "key.wav", 0.35] as [string, number, string, number]),
  ["ColdOpen", 90, "blip-lo.wav", 0.5],
  // everything looks right
  ["Normal", -4, "whoosh.wav", 0.35],
  ...[14, 36, 58, 80].map((f) => ["Normal", f, "blip.wav", 0.45] as [string, number, string, number]),
  ["Normal", 168, "glitch.wav", 0.35],
  // hijack
  ["Hijack", 0, "glitch.wav", 0.7],
  ...[20, 42, 64, 86].map((f) => ["Hijack", f, "blip-lo.wav", 0.4] as [string, number, string, number]),
  ["Hijack", 96, "glitch.wav", 0.6],
  // signature
  ["Sign", -4, "whoosh.wav", 0.3],
  ["Sign", 50, "click.wav", 0.8],
  ["Sign", 54, "subdrop.wav", 0.9],
  ["Sign", 54, "impact.wav", 0.45],
  ["Sign", 62, "coins.wav", 0.4],
  // gap
  ...Array.from({ length: 10 }, (_, i) => ["Gap", 46 + i * 2, "key.wav", 0.3] as [string, number, string, number]),
  // reveal
  ["Reveal", 0, "impact.wav", 0.8],
  ["Reveal", 54, "whoosh.wav", 0.3],
  // questions
  ["Questions", -6, "whoosh.wav", 0.35],
  ["Questions", 36, "whoosh.wav", 0.25],
  ...[30, 35, 40, 45, 62, 67, 72, 77].map((f) => ["Questions", f, "blip.wav", 0.18] as [string, number, string, number]),
  // replay
  ["Replay", -6, "whoosh.wav", 0.35],
  ["Replay", 14, "blip.wav", 0.5],
  ...[34, 60, 82].map((f) => ["Replay", f, "blip-lo.wav", 0.5] as [string, number, string, number]),
  ["Replay", 112, "alarm.wav", 0.4],
  ["Replay", 112, "whoosh.wav", 0.3],
  ["Replay", 186, "click.wav", 0.8],
  ["Replay", 188, "stamp.wav", 0.75],
  ["Replay", 194, "chime.wav", 0.5],
  // chain
  ["Chain", -6, "whoosh.wav", 0.35],
  ...[4, 12, 20, 28, 40, 48, 56].map((f) => ["Chain", f, "blip.wav", 0.22] as [string, number, string, number]),
  ["Chain", 76, "chime.wav", 0.45],
  // verdict
  ["Verdict", -6, "whoosh.wav", 0.35],
  // outro
  ["Outro", 0, "impact.wav", 0.6],
];

const HudLayer: React.FC = () => {
  const frame = useCurrentFrame();
  let cur = SCENES[0];
  for (const s of SCENES) if (frame >= START[s.name]) cur = s;
  if (cur.name === "Gap" && frame - START.Gap > 96) return null; // true black before the reveal
  if (cur.name === "Reveal" && frame - START.Reveal < 16) return null; // let the iris breathe
  const idx = SCENES.indexOf(cur);
  return <Hud dark={cur.dark} act={cur.act} scene={`${String(idx + 1).padStart(2, "0")} / ${SCENES.length}`} total={TOTAL} />;
};

export const Main: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <TransitionSeries>
        {SCENES.map((s, i) => {
          const next = SCENES[i + 1];
          // extend a scene by T when the next one overlaps it, so every cut stays on the bar grid
          const dur = s.dur + (next && next.in ? T : 0);
          return (
            <React.Fragment key={s.name}>
              {i > 0 && s.in ? <TransitionSeries.Transition presentation={pres(s.in)} timing={linearTiming({ durationInFrames: T })} /> : null}
              <TransitionSeries.Sequence name={s.name} durationInFrames={dur}>
                <s.C />
              </TransitionSeries.Sequence>
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      <HudLayer />

      <Audio src={staticFile("audio/score_ducked.wav")} volume={0.82} />
      <Audio src={staticFile("audio/vo.wav")} volume={1} />
      {SFX.map(([scene, f, file, vol], i) => (
        <Sequence key={i} from={Math.max(0, START[scene] + f)} durationInFrames={Math.min(150, TOTAL - Math.max(0, START[scene] + f))} layout="none">
          <Audio src={staticFile(`audio/${file}`)} volume={vol} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
