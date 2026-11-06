"""Voiceover for the BOUND film, synthesized locally with Kokoro-82M (kokoro-onnx).

Run with the venv that has kokoro-onnx installed:
  <venv>/bin/python scripts/make_vo.py <model.onnx> <voices.bin>

Writes public/audio/vo.wav (exactly 60 s), public/audio/score_ducked.wav (score with the
voice side-chained out of it) and src/vo.json (line timings, used for on-screen captions).
"""
import json
import os
import sys

import numpy as np
from kokoro_onnx import Kokoro
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt

HERE = os.path.dirname(__file__)
AUD = os.path.join(HERE, "..", "public", "audio")
SR = 48000
DUR = 60.0
VOICE = os.environ.get("VO_VOICE", "af_heart")

# (start s, latest end s, text). Text is spelled for the TTS; `cap` is what appears on screen.
LINES = [
    (0.5, 3.7, "It starts like any other swap.", "It starts like any other swap."),
    (4.4, 9.6, "Right URL. Green padlock. Audited contracts. Everything looks normal.", "Right URL. Green padlock. Audited contracts. Everything looks normal."),
    (10.4, 15.6, "But the domain was just hijacked. Same address. Different code.", "But the domain was just hijacked. Same address. Different code."),
    (16.5, 21.7, "One click. Unlimited approval. One point two million dollars, gone.", "One click. Unlimited approval. $1.2 million, gone."),
    (22.2, 25.4, "Every warning sign was there. Nobody was checking.", "Every warning sign was there. Nobody was checking."),
    (27.0, 31.7, "This is Bound. Know where your signature is going, before you sign.", "This is BOUND. Know where your signature is going — before you sign."),
    (32.3, 37.7, "Bound asks two questions. Is this site acting differently? Is this action authorized here?", "BOUND asks two questions. Is this site acting differently? Is this action authorized here?"),
    (38.3, 45.7, "Same hijack. Unknown spender. Fresh D N S change. Escalated in milliseconds, and your wallet never sees it.", "Same hijack. Unknown spender. Fresh DNS change. Escalated in milliseconds — and your wallet never sees it."),
    (46.2, 51.95, "Trust is anchored in E N S and Swarm, watched live on Archive. Hijackers can't forge it.", "Trust is anchored in ENS and Swarm, watched live on Arkiv. Hijackers can't forge it."),
    (52.2, 55.95, "Bound warns. Never blocks. Protects the very first victim.", "BOUND warns. Never blocks. Protects the very first victim."),
    (56.4, 59.4, "Bound. Trust what you connect to.", "BOUND. Trust what you connect to."),
]


def trim(x, thr=0.01):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.02 * SR))
    b = min(len(x), idx[-1] + int(0.08 * SR))
    return x[a:b]


def synth(k, text, speed):
    samples, sr = k.create(text, voice=VOICE, speed=speed, lang="en-us")
    x = resample_poly(np.asarray(samples, dtype=np.float64), SR, sr)
    return trim(x)


def lp(x, hz):
    return sosfilt(butter(2, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz):
    return sosfilt(butter(2, hz, "high", fs=SR, output="sos"), x)


def compress(x, thr=0.25, ratio=3.0):
    env = np.abs(x)
    env = lp(env, 30)
    gain = np.where(env > thr, (thr + (env - thr) / ratio) / (env + 1e-9), 1.0)
    return x * gain


def main():
    model, voices = sys.argv[1], sys.argv[2]
    k = Kokoro(model, voices)
    N = int(DUR * SR)
    vo = np.zeros(N)
    timings = []
    for start, end, text, cap in LINES:
        window = end - start
        speed = 1.0
        x = synth(k, text, speed)
        if len(x) / SR > window:
            speed = min(1.3, (len(x) / SR) / window * 1.03)
            x = synth(k, text, speed)
        d = len(x) / SR
        print(f"{start:5.1f}s  {d:4.2f}s / {window:4.2f}s  speed {speed:.2f}  {text}")
        i = int(start * SR)
        j = min(N, i + len(x))
        vo[i:j] += x[: j - i]
        timings.append({"start": start, "end": round(start + d, 3), "text": cap})

    # voice chain: low cut, presence, gentle compression, small room
    vo = hp(vo, 90)
    vo = compress(vo / (np.max(np.abs(vo)) + 1e-9), 0.3, 3.0)
    ir_n = int(0.6 * SR)
    ir = np.random.default_rng(3).standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 9)
    room = fftconvolve(vo, lp(ir, 5000))[:N]
    vo = vo + room / (np.max(np.abs(room)) + 1e-9) * 0.06
    vo = vo / (np.max(np.abs(vo)) + 1e-9) * 0.92
    st = np.stack([vo, vo], 1)
    wavfile.write(os.path.join(AUD, "vo.wav"), SR, (st * 32767).astype(np.int16))

    # side-chain the score under the voice (about -9 dB, smooth attack/release)
    sr_s, score = wavfile.read(os.path.join(AUD, "score.wav"))
    assert sr_s == SR, sr_s
    score = score.astype(np.float64) / 32768
    act = lp((np.abs(vo) > 0.02).astype(np.float64), 4)
    act = np.clip(act * 3, 0, 1)
    duck = 1 - 0.65 * act
    score *= duck[:, None]
    wavfile.write(os.path.join(AUD, "score_ducked.wav"), SR, (np.clip(score, -1, 1) * 32767).astype(np.int16))

    with open(os.path.join(HERE, "..", "src", "vo.json"), "w") as f:
        json.dump(timings, f, indent=2)
    print("ok")


main()
