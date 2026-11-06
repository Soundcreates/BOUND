# BOUND — 60-second product film

Remotion project. Output: `out/bound-film.mp4` (1920×1080, 30 fps, exactly 60.0 s).

## Story (120 BPM, one bar = 2 s, every cut on a downbeat)

| Time | Scene | Beat |
|---|---|---|
| 0–4 | Cold open | 14:53:57 UTC ticks to 14:54. "It starts like any other swap." |
| 4–10 | Normal | Right URL, padlock, audited contracts — everything looks normal |
| 10–16 | Hijack | NS / A / TLS / JS swapped. Same address, different code |
| 16–22 | Sign | One click → unlimited approval → $1.2M drained, 47 min of silence |
| 22–26 | Gap | "Every warning sign was already there." then 0.5 s of true silence |
| 26–32 | Reveal | Iris to cream, logo, "Know where your signature is going — before you sign." |
| 32–38 | Questions | Behaviour vs authorization; the cap rule |
| 38–46 | Replay | Same hijack intercepted: 50 → 35 → 15 escalated, warning window, Cancel → 4001 |
| 46–52 | Chain | Curator → snapshot → Swarm, hash → ENSv2 root, Arkiv, Anon-RPC |
| 52–56 | Verdict | Escalated / Red / Amber / Green. Warns, never blocks |
| 56–60 | Outro | Logo, "Trust what you connect to.", fade to black |

Palette is lifted verbatim from `apps/extension/ui.css` and `landing/src/style.css` (see `src/theme.ts`).

## Rebuild

```bash
python3 scripts/make_audio.py                     # score.wav + SFX (numpy/scipy, fully synthesized)
<kokoro-venv>/bin/python scripts/make_vo.py kokoro-v1.0.onnx voices-v1.0.bin   # vo.wav + score_ducked.wav
npx remotion render src/index.ts BoundFilm out/bound-film.mp4 --codec=h264 --crf=16 --audio-bitrate=320k
```

Voice: Kokoro-82M (`af_heart`) run locally via `kokoro-onnx`. Music and every sound effect are synthesized
from oscillators and noise in `scripts/make_audio.py` — no stock audio.

`node scripts/stills.mjs <dir> <frame…>` renders preview stills.
