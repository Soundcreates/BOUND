import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadSans } from "@remotion/google-fonts/PlusJakartaSans";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Easing, interpolate, spring } from "remotion";

loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
export const fonts = {
  serif: loadSerif("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
  sans: loadSans("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily,
  mono: loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] }).fontFamily,
};

// Every value below is lifted from the product itself:
//   client/extension/ui.css  -> canvas, paper, ink, muted, border, selected, lime, green (#166534), red (#b42318)
//   client/landing/src/style.css  -> navy (#181d26), slate (#20252c), rust (#aa2d00), peach (#f5e9d4), sand (#f4eee5),
//                             mint (#d9ece3), forest (#0a2e0e), sage (#a8d8c4), salmon (#ffc7a8), apricot (#e8a784),
//                             ochre (#987849), wine (#8b2525), greys (#41454d, #5c626a)
export const c = {
  // extension
  canvas: "#f7f4ec",
  paper: "#ffffff",
  ink: "#141414",
  muted: "#5b5b54",
  border: "#e4e1d8",
  selected: "#ede8dc",
  lime: "#d6ff00",
  // landing
  navy: "#181d26",
  slate: "#20252c",
  rust: "#aa2d00",
  peach: "#f5e9d4",
  sand: "#f4eee5",
  mint: "#d9ece3",
  forest: "#0a2e0e",
  sage: "#a8d8c4",
  salmon: "#ffc7a8",
  apricot: "#e8a784",
  ochre: "#987849",
  grey: "#41454d",
  greyLight: "#aab0b5",
  // dark-surface helpers (navy family)
  night: "#11151c",
  nightPanel: "#20252c",
  nightLine: "rgba(255,255,255,0.10)",
  creamDim: "rgba(247,244,236,0.6)",
  // verdict states (extension: #166534 green, #b42318 red; landing: ochre, wine)
  green: "#166534",
  amber: "#987849",
  danger: "#b42318",
  dangerDeep: "#8b2525",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const BAR = 60; // 120 BPM: one bar = 2 s = 60 frames

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const expoOut = Easing.bezier(0.19, 1, 0.22, 1);
export const backOut = Easing.bezier(0.34, 1.56, 0.64, 1);

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const fade = (frame: number, start: number, dur = 18) =>
  interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing: easeOut });

export const fadeOut = (frame: number, start: number, dur = 12) =>
  interpolate(frame, [start, start + dur], [1, 0], { ...clamp, easing: easeInOut });

export const pop = (frame: number, fps: number, delay = 0, damping = 16, stiffness = 140) =>
  spring({ frame: frame - delay, fps, config: { damping, mass: 0.8, stiffness } });

export const lerp = (frame: number, a: number, b: number, from: number, to: number, ease = easeInOut) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: ease });
