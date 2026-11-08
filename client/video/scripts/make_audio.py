"""Procedural score + SFX for the BOUND 60-second product film.

120 BPM, one bar = 2 s = 60 video frames. Every scene cut lands on a downbeat.

  0 -  4  cold open     sub drone, clock ticks, heartbeat
  4 - 10  normal swap   too-calm music box over a closed, pulsing bass
 10 - 16  hijack        glitch, distorted 16th bass, toms, dissonant strings
 16 - 22  signature     half-time drums, shepard riser, drain
 22 - 25.5 the gap      strip back to drone + fast heartbeat + riser
 25.5 - 26 silence
 26 - 28  reveal        BRAAM + impact, D major pad
 28 - 52  BOUND         hopeful drive: Bb  F  C  Dm -> D major lift, arp, 4/4 kick
 52 - 60  outro         final braam, ring-out, fade to zero exactly at 60 s
"""
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM  # 0.5 s
BAR = BEAT * 4  # 2 s
DUR = 60.0
N = int(DUR * SR)
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audio")
t_all = np.arange(N) / SR


# ---------------- dsp helpers ----------------
def lp(x, hz, order=2):
    return sosfilt(butter(order, min(hz, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def var_lp(x, cutoff, block=256):
    out = np.zeros_like(x)
    zi = np.zeros((1, 2))
    for s in range(0, len(x), block):
        fc = float(np.clip(cutoff[min(s, len(cutoff) - 1)], 40, SR / 2 - 200))
        sos = butter(2, fc, "low", fs=SR, output="sos")
        out[s : s + block], zi = sosfilt(sos, x[s : s + block], zi=zi)
    return out


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def add(buf, sig, t):
    i = int(round(t * SR))
    if i >= len(buf) or i < 0:
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def saw(freq, n, detune=(0,)):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in detune:
        f = freq * 2 ** (d / 1200)
        out += 2 * ((t * f + rng.random()) % 1) - 1
    return out / len(detune)


def env(n, a, d, s, r, hold):
    t = np.arange(n) / SR
    e = np.minimum(t / max(a, 1e-4), 1.0)
    e = np.where(t > a, 1 - (1 - s) * np.clip((t - a) / d, 0, 1), e)
    return e * (1 - np.clip((t - hold) / r, 0, 1))


def reverb(x, secs=2.2, wet=0.25, seed=0):
    n = int(secs * SR)
    r = np.random.default_rng(seed).standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / secs))
    r = lp(r, 6000)
    y = fftconvolve(x, r)[: len(x)]
    y /= np.max(np.abs(y)) + 1e-9
    return x + y * wet * np.max(np.abs(x))


# ---------------- instruments ----------------
def kick(v=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 45 + 150 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6)
    clk = hp(rng.standard_normal(n), 2500) * np.exp(-t * 200) * 0.4
    return np.tanh((body + clk) * 2.2) * v * 0.7


def snare(v=1.0):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 1200, 9000) * np.exp(-t * 13)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    return np.tanh((noise * 0.8 + tone * 0.7) * 1.5) * v * 0.45


def clap(v=1.0):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    e = sum(np.exp(-np.clip(t - k * 0.011, 0, None) * 60) * (t >= k * 0.011) for k in range(3))
    return bp(rng.standard_normal(n), 900, 5000) * (e + np.exp(-t * 14) * 0.6) * v * 0.3


def hat(v=1.0, open_=False):
    n = int((0.3 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 8000) * np.exp(-t * (12 if open_ else 90)) * v * 0.16


def tick(v=1.0, hi=True):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    f = 2600 if hi else 1900
    return (np.sin(2 * np.pi * f * t) + 0.5 * bp(rng.standard_normal(n), 3000, 9000)) * np.exp(-t * 140) * v * 0.28


def heartbeat(v=1.0):
    """lub-dub"""
    n = int(0.6 * SR)
    t = np.arange(n) / SR

    def thump(t0, amp):
        tt = np.clip(t - t0, 0, None)
        f = 48 + 30 * np.exp(-tt * 20)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 16) * (t >= t0) * amp

    return (thump(0, 1.0) + thump(0.18, 0.7)) * v * 0.8


def tom(freq=90, v=1.0, decay=5.0):
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    f = freq + freq * 1.2 * np.exp(-t * 25)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    skin = lp(rng.standard_normal(n), 1500) * np.exp(-t * 30) * 0.4
    return np.tanh((body + skin) * 1.8) * v * 0.6


def bass_note(freq, dur, v=1.0, grit=1.0):
    n = int((dur + 0.02) * SR)
    s = saw(freq, n, (-6, 6)) * 0.8 + np.sin(2 * np.pi * freq * np.arange(n) / SR) * 0.6
    return np.tanh(s * grit) * env(n, 0.003, 0.08, 0.6, 0.02, dur) * v * 0.35


def pad(freqs, dur, v=1.0, cut=1400):
    n = int((dur + 1.5) * SR)
    s = sum(saw(f, n, (-12, -4, 4, 12)) for f in freqs) / len(freqs)
    return lp(s, cut) * env(n, 0.5, 1.0, 0.85, 1.4, dur) * v * 0.25


def strings(freqs, dur, v=1.0):
    """bowed, slightly tremolo cluster"""
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    s = sum(saw(f, n, (-7, 0, 7)) for f in freqs) / len(freqs)
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * 7 * t)
    return bp(s, 200, 3500) * trem * env(n, 0.4, 0.5, 0.9, 0.9, dur) * v * 0.22


def musicbox(freq, v=1.0):
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 3.01 * t) * np.exp(-t * 6)
    return s * np.exp(-t * 3.2) * np.minimum(t / 0.002, 1) * v * 0.16


def pluck(freq, v=1.0):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    sq = np.sign(np.sin(2 * np.pi * freq * t)) * 0.5 + saw(freq * 2, n) * 0.3
    return var_lp(sq, 400 + 5200 * np.exp(-t * 16)) * np.exp(-t * 8) * v * 0.17


def braam(root, v=1.0, length=4.5):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = saw(midi(root), n, (-15, -5, 5, 15)) + saw(midi(root + 12), n, (-10, 10)) * 0.7 + saw(midi(root + 19), n, (-8, 8)) * 0.35
    cut = 150 + 2600 * np.clip(t / 0.25, 0, 1) * np.exp(-np.clip(t - 0.25, 0, None) * 1.1)
    s = var_lp(s, cut)
    sub = np.sin(2 * np.pi * midi(root - 12) * t) * 0.8
    e = np.minimum(t / 0.02, 1) * np.exp(-t * 0.7)
    return np.tanh((s + sub) * 2.0) * e * v * 0.55


bus = {k: np.zeros(N) for k in ["drums", "bass", "pad", "lead", "fx", "drone", "strings"]}
kick_times = []


def K(t, v=1.0):
    add(bus["drums"], kick(v), t)
    kick_times.append(t)


# ================= ACT I: BEFORE (0 - 25.5 s) =================
# sub drone D1 + A1, slow beating, swelling into the gap
dn = int(25.6 * SR)
tt = np.arange(dn) / SR
drone = (np.sin(2 * np.pi * midi(26) * tt) + 0.6 * np.sin(2 * np.pi * midi(33) * 1.003 * tt)
         + 0.25 * saw(midi(38), dn, (-20, 20)))
drone = lp(drone, 500) * np.interp(tt, [0, 2, 10, 22, 25.4, 25.6], [0, 0.55, 0.6, 0.9, 1.0, 0])
bus["drone"][:dn] += drone * 0.35

# clock ticks every beat 0 - 22 (tick/tock), heartbeat every 2 beats, faster in the gap
for b in range(int(22 / BEAT)):
    add(bus["fx"], tick(0.9 if b % 2 == 0 else 0.6, hi=b % 2 == 0), b * BEAT)
for t0 in np.arange(0.0, 10.0, 1.0):
    add(bus["drums"], heartbeat(0.9), t0)
for t0 in np.arange(22.0, 25.4, 0.5):
    add(bus["drums"], heartbeat(1.0), t0)

# 4-10 s: music box (Dm add9, too calm) + closed pulse bass
box = [62, 65, 69, 72, 74, 72, 69, 65]
for i, t0 in enumerate(np.arange(4.0, 10.0, BEAT)):
    add(bus["lead"], musicbox(midi(box[i % len(box)] + 12)), t0)
for t0 in np.arange(4.0, 10.0, BEAT / 2):
    add(bus["bass"], bass_note(midi(38), BEAT / 2 * 0.8, 0.7), t0)
add(bus["pad"], pad([midi(n) for n in (50, 53, 57, 64)], 6.0, 0.6, 900), 4.0)

# 10-22 s: hijack + signature. 16th ostinato, distorted, Dm  Bb  Gm  A(b9)
roots = [38, 34, 31, 33]
for k, bar_t in enumerate(np.arange(10.0, 22.0, BAR)):
    r = roots[k % 4]
    for s in range(16):
        nt = r + (12 if s % 4 == 2 else 0)
        add(bus["bass"], bass_note(midi(nt), BEAT / 4 * 0.85, 0.9, grit=2.5), bar_t + s * BEAT / 4)
# toms on 1 and 3 (10-16), half-time drums (16-22)
for t0 in np.arange(10.0, 16.0, BAR):
    add(bus["drums"], tom(80, 1.0), t0)
    add(bus["drums"], tom(60, 0.8), t0 + 2 * BEAT)
    add(bus["drums"], tom(110, 0.5), t0 + 3.5 * BEAT)
for t0 in np.arange(16.0, 22.0, BAR):
    K(t0)
    K(t0 + 1.5 * BEAT, 0.7)
    add(bus["drums"], snare(1.0), t0 + 2 * BEAT)
    for h in range(8):
        add(bus["drums"], hat(0.6 + 0.3 * (h % 2)), t0 + h * BEAT / 2)
# snare roll 20-22
for i, t0 in enumerate(np.arange(20.0, 22.0, BEAT / 4)):
    add(bus["drums"], snare(0.25 + 0.75 * i / 16), t0)
# dissonant strings: minor 2nd cluster swelling
add(bus["strings"], strings([midi(n) for n in (62, 63, 69)], 6.0, 0.8), 10.0)
add(bus["strings"], strings([midi(n) for n in (65, 66, 70, 74)], 6.0, 1.0), 16.0)
add(bus["strings"], strings([midi(n) for n in (74, 75, 81)], 3.5, 1.1), 22.0)

# shepard-ish riser 16 -> 25.5
rn = int(9.5 * SR)
rt = np.arange(rn) / SR
rise = np.zeros(rn)
for o in range(4):
    f = 110 * 2 ** (((rt / 9.5) * 2 + o) % 4)
    w = np.sin(np.pi * (((rt / 9.5) * 2 + o) % 4) / 4) ** 2
    rise += np.sin(2 * np.pi * np.cumsum(f) / SR) * w
rise = lp(rise, 3500) * (rt / 9.5) ** 1.6 * 0.12
add(bus["fx"], rise, 16.0)

# ================= ACT II: AFTER (26 - 60 s) =================
REVEAL = 26.0
add(bus["fx"], braam(26, 1.1), REVEAL)
K(REVEAL, 1.2)
add(bus["pad"], pad([midi(n) for n in (50, 54, 57, 62, 66)], 2.0, 1.0, 2200), REVEAL)

# Progression per bar from 28: Bb  F  C  Dm | Bb F C D(major lift)
prog = [
    (34, (58, 62, 65, 69)),  # Bb maj7
    (29, (57, 60, 65, 69)),  # F
    (36, (55, 60, 64, 67)),  # C
    (38, (57, 62, 65, 69)),  # Dm
    (34, (58, 62, 65, 70)),  # Bb
    (29, (57, 60, 65, 72)),  # F
    (36, (55, 60, 64, 67)),  # C
    (38, (57, 62, 66, 69)),  # D major
]
DRIVE_END = 56.0
for k, bar_t in enumerate(np.arange(28.0, DRIVE_END, BAR)):
    r, chord = prog[k % 8]
    add(bus["pad"], pad([midi(n) for n in chord], BAR, 0.9, 1800 if bar_t < 32 else 2600), bar_t)
    # arp 16ths
    seq = [chord[0], chord[1], chord[2], chord[3], chord[2] + 12, chord[3], chord[1] + 12, chord[2]]
    for s in range(16):
        add(bus["lead"], pluck(midi(seq[s % 8] + 12), 0.8 if bar_t >= 32 else 0.7), bar_t + s * BEAT / 4)
    if bar_t >= 28:
        for s in range(8):
            add(bus["bass"], bass_note(midi(r + (12 if s % 2 else 0)), BEAT / 2 * 0.8, 0.85), bar_t + s * BEAT / 2)
    if bar_t >= 32:
        for b in range(4):
            K(bar_t + b * BEAT)
            add(bus["drums"], hat(0.9, open_=True), bar_t + b * BEAT + BEAT / 2)
        add(bus["drums"], clap(1.0), bar_t + BEAT)
        add(bus["drums"], clap(1.0), bar_t + 3 * BEAT)
    else:
        K(bar_t, 0.9)
        K(bar_t + 2 * BEAT, 0.9)
        add(bus["drums"], hat(0.8, open_=True), bar_t + BEAT)
        add(bus["drums"], hat(0.8, open_=True), bar_t + 3 * BEAT)
# lift hits: replay entry (38), cancel (45.5 -> 46), chain (46), verdict (52)
for t0, root in [(38.0, 34), (46.0, 38), (52.0, 34)]:
    add(bus["fx"], braam(root + 12, 0.45, 3.0), t0)
# drop-out before cancel: one bar with no kick 44-46 is too long; pull kick on last beat
# outro
add(bus["fx"], braam(26, 1.0, 4.0), 56.0)
K(56.0, 1.2)
add(bus["pad"], pad([midi(n) for n in (50, 57, 62, 66, 69, 74)], 2.5, 1.1, 2400), 56.0)
add(bus["strings"], strings([midi(n) for n in (74, 78, 81)], 2.5, 0.7), 56.0)

# ---------------- mix ----------------
bass_cut = np.interp(t_all, [0, 4, 10, 16, 22, 25.5, 26, 30, 32, 56, 60], [180, 260, 500, 1500, 2800, 400, 400, 900, 2400, 3200, 800])
bass = var_lp(bus["bass"], bass_cut)

duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    L = int(0.2 * SR)
    shape = 1 - 0.5 * np.exp(-np.arange(L) / SR * 20)
    j = min(N, i + L)
    duck[i:j] = np.minimum(duck[i:j], shape[: j - i])

lead = bus["lead"]
dl = int(0.75 * BEAT * SR)
lead_d = lead.copy()
for k in range(1, 4):
    lead_d[dl * k :] += lead[: -dl * k] * (0.38**k)

mix = (
    reverb(bus["drums"], 1.2, 0.2, 1) * 0.95
    + bass * duck
    + reverb(lead_d, 2.2, 0.4, 3) * duck * 0.75
    + reverb(bus["pad"], 3.0, 0.45, 4) * duck * 0.85
    + reverb(bus["strings"], 3.0, 0.45, 6) * 0.9
    + reverb(bus["fx"], 2.5, 0.3, 5) * 0.9
    + bus["drone"]
)

# hard silence 25.5 -> 26.0 (a tiny tail keeps it from sounding like a glitch)
gate = np.ones(N)
gi, ge = int(25.5 * SR), int(26.0 * SR)
fade = int(0.03 * SR)
gate[gi : gi + fade] = np.linspace(1, 0, fade)
gate[gi + fade : ge] = 0.0
mix *= gate

mix = np.tanh(mix * 1.5) / 1.5
mix = hp(mix, 28)
mix *= np.clip(t_all / 0.3, 0, 1)
mix *= np.interp(t_all, [0, 58.2, 59.9, 60], [1, 1, 0, 0])  # lands on true silence at exactly 60 s

d = int(0.011 * SR)
L = mix
R = np.concatenate([np.zeros(d), mix[:-d]]) * 0.85 + mix * 0.15
st = np.stack([L, R], 1)
st /= np.max(np.abs(st)) + 1e-9
st *= 0.89
os.makedirs(OUT, exist_ok=True)
wavfile.write(os.path.join(OUT, "score.wav"), SR, (st * 32767).astype(np.int16))


# ---------------- SFX ----------------
def write(name, x, peak=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    wavfile.write(os.path.join(OUT, name), SR, (np.stack([x, x], 1) * 32767).astype(np.int16))


def whoosh(dur=0.8):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    centers = 300 + 3500 * np.sin(np.pi * tt / dur) ** 2
    out = np.zeros(n)
    noise = rng.standard_normal(n)
    block = 512
    for s in range(0, n, block):
        c = centers[s]
        segn = noise[max(0, s - 2048) : s + block]
        f = bp(segn, max(80, c * 0.6), min(18000, c * 1.6))
        out[s : s + block] = f[-len(out[s : s + block]) :]
    return out * np.sin(np.pi * tt / dur) ** 1.5


def impact():
    n = int(2.5 * SR)
    tt = np.arange(n) / SR
    f = 38 + 70 * np.exp(-tt * 10)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.8)
    air = lp(rng.standard_normal(n), 2500) * np.exp(-tt * 4) * 0.3
    shimmer = sum(np.sin(2 * np.pi * midi(m_) * tt) for m_ in [74, 78, 81, 86]) * np.exp(-tt * 1.2) * 0.08
    return np.tanh((boom + air) * 1.5) + shimmer


def click():
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1800 * tt) * 0.6 + hp(rng.standard_normal(n), 4000) * 0.4) * np.exp(-tt * 90)


def key():
    n = int(0.04 * SR)
    tt = np.arange(n) / SR
    return (bp(rng.standard_normal(n), 2000, 8000) * 0.7 + np.sin(2 * np.pi * 900 * tt) * 0.3) * np.exp(-tt * 160)


def blip(freq=1320):
    n = int(0.25 * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 18) + 0.3 * np.sin(2 * np.pi * freq * 2 * tt) * np.exp(-tt * 30)


def glitch():
    parts = []
    for i in range(14):
        L = int(rng.uniform(0.01, 0.04) * SR)
        kind = i % 3
        tt = np.arange(L) / SR
        if kind == 0:
            parts.append(bp(rng.standard_normal(L), 400, 6000))
        elif kind == 1:
            parts.append(np.sign(np.sin(2 * np.pi * rng.uniform(80, 1200) * tt)) * 0.7)
        else:
            parts.append(np.zeros(L))
    return np.concatenate(parts)


def alarm():
    """two-tone warning pulse"""
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f = np.where((tt * 6).astype(int) % 2 == 0, 880, 660)
    s = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.4 + np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.6
    return lp(s, 3000) * np.exp(-tt * 2.2)


def chime():
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    out = np.zeros(n)
    for k, m_ in enumerate([74, 78, 81, 86]):
        st_ = k * 0.06
        e = np.clip(tt - st_, 0, None)
        out += np.sin(2 * np.pi * midi(m_) * tt) * np.exp(-e * 3.5) * (tt >= st_)
    return out


def coins():
    """rapid register ticks for the drain counter"""
    n = int(3.2 * SR)
    out = np.zeros(n)
    t0 = 0.0
    while t0 < 3.1:
        add_i = int(t0 * SR)
        s = tick(1.0, hi=True)
        out[add_i : add_i + len(s)] += s[: max(0, min(len(s), n - add_i))]
        t0 += max(0.03, 0.11 * np.exp(-t0 * 0.6))
    return out * np.interp(np.arange(n) / SR, [0, 2.8, 3.2], [1, 1, 0])


def stamp():
    n = int(0.6 * SR)
    tt = np.arange(n) / SR
    thud = np.sin(2 * np.pi * np.cumsum(70 + 120 * np.exp(-tt * 40)) / SR) * np.exp(-tt * 12)
    snap = hp(rng.standard_normal(n), 1500) * np.exp(-tt * 70)
    return np.tanh((thud + snap * 0.6) * 2)


def sub_drop():
    n = int(1.5 * SR)
    tt = np.arange(n) / SR
    f = 90 * np.exp(-tt * 2.0) + 30
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.0)


write("whoosh.wav", whoosh(), 0.55)
write("impact.wav", impact(), 0.85)
write("click.wav", click(), 0.45)
write("key.wav", key(), 0.35)
write("blip.wav", blip(), 0.32)
write("blip-lo.wav", blip(880), 0.32)
write("glitch.wav", glitch(), 0.5)
write("alarm.wav", alarm(), 0.45)
write("chime.wav", chime(), 0.45)
write("coins.wav", coins(), 0.4)
write("stamp.wav", stamp(), 0.7)
write("subdrop.wav", sub_drop(), 0.8)
print("ok", N / SR, "s")
