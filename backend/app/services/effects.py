"""formcut's audio effects in formwav.

AUDIO_CHAINS is formcut v2.2.2's `backend/app/catalogue.py` AUDIO_CHAINS, vendored verbatim: named ffmpeg filter
chains, rendered as formcut renders them, by running the audio through ffmpeg. Applying one writes a new media file
(the source is never changed) at the source's rate; mono stays mono except for the two stereo-image effects.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from ..core.paths import media_dir
from . import media

AUDIO_CHAINS = {
    "pitch_up": "aresample=48000,asetrate=60000,aresample=48000,atempo=0.8",
    "pitch_down": "aresample=48000,asetrate=38400,aresample=48000,atempo=1.25",
    "echo": "aecho=0.8:0.7:100|220:0.4|0.2",
    "radio": "highpass=f=400,lowpass=f=2600,acompressor=threshold=0.12:ratio=4",
    "denoise": "afftdn=nf=-25",
    "voice-clean": "highpass=f=90,afftdn=nf=-25,acompressor=threshold=0.12:ratio=3,alimiter",
    "bass": "bass=g=8:f=120",
    "treble": "treble=g=6:f=3500",
    "telephone": "highpass=f=700,lowpass=f=2000",
    "room": "aecho=0.8:0.7:25|47|71:0.25|0.16|0.1",
    "hall": "aecho=0.8:0.7:90|170|290|410:0.4|0.28|0.18|0.1",
    "cathedral": "aecho=0.8:0.7:190|370|590|830:0.5|0.38|0.27|0.17",
    "plate": "aecho=0.8:0.7:41|73|113|167:0.4|0.3|0.2|0.1",
    "robot": "afftfilt=real='hypot(re,im)':imag='0':win_size=512:overlap=0.75",
    "tremolo": "tremolo=f=6:d=0.7",
    "vibrato": "vibrato=f=5:d=0.6",
    "distortion": "asoftclip=type=tanh:threshold=0.35:output=0.8",
    "compress": "acompressor=threshold=0.12:ratio=4:attack=10:release=150",
    "normalize": "loudnorm=I=-16:TP=-1.5:LRA=11",
    "de-ess": "deesser=i=0.5:m=0.5:f=0.5",
    "octave-up": "aresample=48000,asetrate=96000,aresample=48000,atempo=0.5",
    "octave-down": "aresample=48000,asetrate=24000,aresample=48000,atempo=2.0",
    "double-voice": "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|2.3",
    "jet-flange": "flanger=delay=2:depth=4:regen=40:speed=0.4",
    "swirl-phase": "aphaser=in_gain=0.6:out_gain=0.8:delay=3:decay=0.5:speed=0.6",
    "bullhorn": "highpass=f=600,lowpass=f=3200,acompressor=threshold=0.08:ratio=6,asoftclip=type=atan:threshold=0.5",
    "two-way-radio": "highpass=f=500,lowpass=f=2800,acrusher=bits=8:mode=log:aa=1,acompressor=threshold=0.1:ratio=5",
    "warm-lows": "lowshelf=g=5:f=180,highshelf=g=-2:f=6000",
    "presence-lift": "equalizer=f=3000:t=q:w=1.2:g=5",
    "mid-scoop": "equalizer=f=800:t=q:w=0.8:g=-7",
    "bit-crush": "volume=0.125,aformat=sample_fmts=u8,aformat=sample_fmts=flt,volume=8",
    "tape-warmth": "asoftclip=type=sin:threshold=0.7,lowpass=f=12000",
    "crisp-detail": "crystalizer=i=2",
    "lofi-band": "highpass=f=150,lowpass=f=3500,acrusher=bits=10:mode=log:aa=1",
    "slapback": "aecho=0.8:0.6:120:0.45",
    "wide-stage": "haas=left_delay=2.05:right_delay=10",
    "stereo-bloom": "stereowiden=delay=20:feedback=0.3:crossfeed=0.3:drymix=0.8",
    "long-tail": "aecho=0.8:0.8:400|800|1200:0.5|0.35|0.2",
    "tunnel": "aecho=0.8:0.85:60|120|180|240:0.6|0.45|0.3|0.2,lowpass=f=5000",
    "small-booth": "aecho=0.8:0.6:8|14|21:0.3|0.2|0.1,lowpass=f=6000",
    "far-away": "highpass=f=200,lowpass=f=2500,aecho=0.8:0.6:180|340:0.35|0.25,volume=0.6",
    "noise-gate": "agate=threshold=0.1:ratio=6:attack=5:release=120:range=0.05",
    "hiss-cut": "lowpass=f=9000,afftdn=nf=-30:nt=w",
    "hum-remover": "bandreject=f=50:width_type=q:w=4,bandreject=f=60:width_type=q:w=4,bandreject=f=100:width_type=q:w=4,bandreject=f=120:width_type=q:w=4",
    "rumble-cut": "highpass=f=80:poles=2",
    "level-rider": "dynaudnorm=f=100:g=5:p=0.9:m=8",
    "peak-limiter": "alimiter=limit=0.8:attack=5:release=50",
    "deep-denoise": "afftdn=nf=-35:nr=20:tn=1",
}

#: formwav's own chains, written against the behaviour of Audacity's built-in effects, iZotope RX's modules and
#: Audition's processes (references only; no code taken). "peak-normalize" is measured first, so its chain is built in apply().
FORMWAV_CHAINS = {
    "amplify-up": "volume=6dB",
    "amplify-down": "volume=-6dB",
    "invert": "aeval=-val(ch):c=same",
    "reverse": "areverse",
    "dc-offset": "highpass=f=5:poles=1",
    "click-removal": "adeclick",
    "gap-repair": "adeclick=w=10:o=50:a=4",
    "truncate-silence": "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-45dB",
    "graphic-eq-voice": "superequalizer=1b=0.7:2b=0.8:3b=0.9:4b=1:5b=1:6b=1.1:7b=1.2:8b=1.3:9b=1.3:10b=1.2:11b=1.1:12b=1:13b=1:14b=1:15b=0.9:16b=0.9:17b=0.8:18b=0.8",
    "filter-curve-lowcut": "firequalizer=gain_entry='entry(0,-30);entry(80,-30);entry(120,0);entry(20000,0)'",
    "tempo-faster": "rubberband=tempo=1.1",
    "stretch-rhythmic": "rubberband=tempo=1.1:window=short",
    "tempo-slower": "rubberband=tempo=0.9",
    "pitch-up-semitone": "rubberband=pitch=1.0594631",
    "pitch-down-semitone": "rubberband=pitch=0.9438743",
    "speed-faster": "aresample=48000,asetrate=52800,aresample=48000",
    "extreme-stretch": "rubberband=tempo=0.25",
    "de-clip": "adeclip",
    "de-crackle": "adeclick=w=20:o=75:t=5",
    "mouth-declick": "highpass=f=60,adeclick=w=10:o=75:t=2",
    "de-plosive": "highpass=f=100:poles=2",
    "de-wind": "highpass=f=150:poles=2,afftdn=nf=-30",
    "voice-denoise": "anlmdn=s=7:p=0.002:r=0.006",
    "guitar-denoise": "afftdn=nf=-40:tn=1",
    "de-ess-strong": "deesser=i=0.8:m=0.5:f=0.5",
    "leveler": "speechnorm=e=6:r=0.0001:l=1",
    "dither": "aresample=osf=s16:dither_method=shibata,aresample=osf=flt",
    "phase-rotate": "",
    "azimuth": "adelay=delays=0|1",
    "center-extract": "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
    "center-remove": "pan=stereo|c0=c0-c1|c1=c1-c0",
    "swap-channels": "pan=stereo|c0=c1|c1=c0",
    "mid-side-encode": "stereotools=mode=lr>ms",
    "mid-side-decode": "stereotools=mode=ms>lr",
    "peak-normalize": "",
    "paulstretch": "",
    "downmix-mono": "",
    "loudness-streaming": "loudnorm=I=-14:TP=-1:LRA=11",
    "loudness-broadcast": "loudnorm=I=-23:TP=-2:LRA=15",
    "exciter": "aexciter=amount=2",
    "eq-3band": "lowshelf=g=0:f=120,equalizer=f=1000:t=q:w=1:g=0,highshelf=g=0:f=8000",
    "graphic-eq-5": "firequalizer=gain_entry='entry(60,0);entry(250,0);entry(1000,0);entry(4000,0);entry(12000,0)'",
    "band-gain": "firequalizer=gain_entry='entry(0,0);entry(1940,0);entry(2000,-30);entry(4000,-30);entry(4120,0);entry(24000,0)'",
    "dialogue-isolate": "",
    "reverb": "asplit=3[d][s][m];[s]atrim=0:1.5,aeval=(random(0)*2-1)*exp(-t/0.8):c=same[ir];[m][ir]afir=dry=1:wet=1:gtype=rms[w];[d][w]amix=inputs=2:weights=0.7 0.3:normalize=0",
    "ramp": "rubberband=tempo=1:pitch=1",
    "dereverb": "anull",
    "spot-heal": "anull",
    "wow-flutter": "anull",
    "pitch-correct": "anull",
    "dialogue-contour": "anull",
}
ALL_CHAINS = {**AUDIO_CHAINS, **FORMWAV_CHAINS}

#: Menu groups for formwav's Inspector; every chain appears exactly once.
GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("Clean up", [("voice-clean", "Enhance speech"), ("denoise", "Denoise"), ("deep-denoise", "Deep denoise"), ("hiss-cut", "Hiss cut"), ("hum-remover", "Hum remover"), ("rumble-cut", "Rumble cut"), ("noise-gate", "Noise gate"), ("de-ess", "De-ess"), ("dialogue-isolate", "Dialogue isolate (neural)...")]),
    ("Dynamics", [("compress", "Compress"), ("normalize", "Normalize to -16 LUFS"), ("level-rider", "Level rider"), ("peak-limiter", "Peak limiter")]),
    ("Tone", [("bass", "Bass boost"), ("treble", "Treble boost"), ("warm-lows", "Warm lows"), ("presence-lift", "Presence lift"), ("mid-scoop", "Mid scoop"), ("crisp-detail", "Crisp detail"), ("eq-3band", "Parametric EQ, 3 bands..."), ("graphic-eq-5", "Graphic EQ, 5 bands...")]),
    ("Space", [("reverb", "Reverb..."), ("room", "Room echo"), ("hall", "Hall echo"), ("cathedral", "Cathedral echo"), ("plate", "Plate echo"), ("echo", "Echo"), ("slapback", "Slapback"), ("long-tail", "Long tail"), ("tunnel", "Tunnel"), ("small-booth", "Small booth"), ("far-away", "Far away"), ("wide-stage", "Wide stage"), ("stereo-bloom", "Stereo bloom")]),
    ("Character", [("radio", "Radio"), ("telephone", "Telephone"), ("bullhorn", "Bullhorn"), ("two-way-radio", "Two-way radio"), ("lofi-band", "Lo-fi band"), ("tape-warmth", "Tape warmth"), ("bit-crush", "Bit crush"), ("distortion", "Distortion"), ("robot", "Robot")]),
    ("Modulation", [("tremolo", "Tremolo"), ("vibrato", "Vibrato"), ("double-voice", "Double voice"), ("jet-flange", "Jet flange"), ("swirl-phase", "Swirl phase")]),
    ("Pitch", [("pitch_up", "Pitch up"), ("pitch_down", "Pitch down"), ("octave-up", "Octave up"), ("octave-down", "Octave down")]),
    ("Audacity effects", [("amplify-up", "Amplify..."), ("amplify-down", "Amplify -6 dB"), ("invert", "Invert"), ("reverse", "Reverse"), ("dc-offset", "Remove DC offset"), ("click-removal", "Click removal"), ("gap-repair", "Repair short gaps"), ("truncate-silence", "Truncate silence"), ("graphic-eq-voice", "Graphic EQ: voice"), ("filter-curve-lowcut", "Filter curve: low cut"), ("tempo-faster", "Change tempo..."), ("stretch-rhythmic", "Change tempo, rhythmic..."), ("tempo-slower", "Change tempo -10%"), ("pitch-up-semitone", "Change pitch..."), ("pitch-down-semitone", "Change pitch -1 semitone"), ("speed-faster", "Change speed..."), ("extreme-stretch", "Extreme stretch..."), ("paulstretch", "Paulstretch..."), ("ramp", "Ramp tempo and pitch...")]),
    ("Repair", [("de-clip", "De-clip"), ("de-crackle", "De-crackle"), ("mouth-declick", "Mouth de-click"), ("de-plosive", "De-plosive"), ("de-wind", "De-wind"), ("voice-denoise", "Voice de-noise"), ("guitar-denoise", "Guitar de-noise"), ("de-ess-strong", "De-ess, strong"), ("leveler", "Leveler"), ("dither", "Dither to 16-bit (noise shaped)"), ("phase-rotate", "Phase rotation"), ("azimuth", "Azimuth: right 1 ms"), ("band-gain", "Band gain (spectral)..."), ("dereverb", "De-reverb..."), ("spot-heal", "Spot heal (spectral)..."), ("wow-flutter", "Wow and flutter..."), ("pitch-correct", "Pitch correction..."), ("dialogue-contour", "Dialogue contour...")]),
    ("Channels", [("center-extract", "Center extract"), ("center-remove", "Center remove"), ("swap-channels", "Swap channels"), ("downmix-mono", "Downmix to mono"), ("mid-side-encode", "Mid-side encode"), ("mid-side-decode", "Mid-side decode")]),
    ("Mastering", [("peak-normalize", "Peak normalize..."), ("loudness-streaming", "Loudness to a target..."), ("loudness-broadcast", "Loudness: broadcast -23 LUFS"), ("exciter", "Exciter")]),
]
LABELS = {key: label for _, items in GROUPS for key, label in items}
#: Effects that make a stereo image, so their output is stereo even from mono.
STEREO = {"wide-stage", "stereo-bloom"}
#: Effects that work between two channels and so need a stereo source.
STEREO_ONLY = {"center-extract", "center-remove", "swap-channels", "mid-side-encode", "mid-side-decode", "azimuth"}


def _lin(db: float) -> float:
    return 10 ** (db / 20)


RNNOISE_URL = "https://raw.githubusercontent.com/GregorR/rnnoise-models/master/beguiling-drafter-2018-08-30/bd.rnnn"


def _rnnoise_model() -> str:
    """The RNNoise model (voice amid noise, from GregorR/rnnoise-models) for ffmpeg's arnndn, fetched once into the
    git-ignored backend/models/rnnoise."""
    path = Path(__file__).resolve().parents[2] / "models" / "rnnoise" / "bd.rnnn"
    if not path.exists():
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = urllib.request.urlopen(RNNOISE_URL, timeout=60).read()
        except OSError as err:
            raise media.MediaError(f"dialogue isolation needs its RNNoise model, which could not be fetched ({err}); place bd.rnnn in {path.parent}") from err
        if not data.startswith(b"rnnoise"):
            raise media.MediaError("the fetched RNNoise model is not a model file")
        path.write_bytes(data)
    return str(path)


#: Adjustable effects: each parameter is (label, min, max, default, unit); the builder makes the chain from clamped values.
#: Enhance speech's strength follows formcut's own voice-clean strength control (noise floor and ratio scale with it).
PARAMS: dict[str, tuple[dict[str, tuple[str, float, float, float, str]], object]] = {
    "dialogue-isolate": ({"strength": ("Strength", 0, 100, 100, "%")}, lambda v: f"arnndn=m={_rnnoise_model()}:mix={v['strength'] / 100:.2f}"),
    "voice-clean": ({"strength": ("Strength", 0, 100, 50, "%")}, lambda v: f"highpass=f=90,afftdn=nf={-15 - 20 * v['strength'] / 100:.1f},acompressor=threshold=0.12:ratio={1.5 + 3 * v['strength'] / 100:.2f},alimiter"),
    "amplify-up": ({"db": ("Gain", -24, 24, 6, "dB")}, lambda v: f"volume={v['db']:.2f}dB"),
    "peak-normalize": ({"target": ("Peak", -24, 0, -1, "dBFS"), "dc": ("Remove DC (1 = on)", 0, 1, 0, "", 1), "independent": ("Each channel (1 = on)", 0, 1, 0, "", 1)}, None),
    "loudness-streaming": ({"target": ("Target", -36, -8, -14, "LUFS")}, lambda v: f"loudnorm=I={v['target']:.1f}:TP=-1:LRA=11"),
    "compress": ({"threshold": ("Threshold", -60, 0, -18, "dB"), "ratio": ("Ratio", 1, 20, 4, ":1")}, lambda v: f"acompressor=threshold={_lin(v['threshold']):.5f}:ratio={v['ratio']:.2f}:attack=10:release=150"),
    "noise-gate": ({"threshold": ("Threshold", -80, 0, -20, "dB")}, lambda v: f"agate=threshold={_lin(v['threshold']):.5f}:ratio=6:attack=5:release=120:range=0.05"),
    "tempo-faster": ({"percent": ("Tempo", -50, 100, 10, "%")}, lambda v: f"rubberband=tempo={1 + v['percent'] / 100:.5f}"),
    # A short window keeps percussive attacks where they belong: at Rubber Band's defaults a stretched beat pattern
    # kept 6 of its 12 attacks at the wrong spacing; with window=short the spacing held (0.5435 s against 0.5449).
    "stretch-rhythmic": ({"percent": ("Tempo", -50, 100, 10, "%")}, lambda v: f"rubberband=tempo={1 + v['percent'] / 100:.5f}:window=short"),
    "pitch-up-semitone": ({"semitones": ("Pitch", -12, 12, 1, "st")}, lambda v: f"rubberband=pitch={2 ** (v['semitones'] / 12):.6f}"),
    "speed-faster": ({"percent": ("Speed", -50, 100, 10, "%")}, lambda v: f"aresample=48000,asetrate={round(48000 * (1 + v['percent'] / 100))},aresample=48000"),
    "extreme-stretch": ({"factor": ("Stretch", 1.5, 10, 4, "x")}, lambda v: f"rubberband=tempo={1 / v['factor']:.5f}"),
    "paulstretch": ({"factor": ("Stretch", 1, 100, 8, "x"), "resolution": ("Time resolution", 0.02, 2, 0.25, "s")}, None),
    "phase-rotate": ({"angle": ("Angle", -180, 180, 90, " degrees", 1), "auto": ("Find the angle (1 = on)", 0, 1, 0, "", 1)}, None),
    # RX-18: dither to any depth from 8 to 24 bits. ffmpeg dithers (with Shibata noise shaping) only to its integer
    # formats, so the signal is scaled by an exact power of two around it: for N bits at 16 (N up to 16) or 32 (above),
    # 2^(N - 16) or 2^(N - 32), which lands the grid on 2^-(N - 1); 16 bits shaped is the chain this replaced, unchanged
    "dither": (
        {"bits": ("Bit depth", 8, 24, 16, " bits", 1), "shaping": ("Noise shaping (1 = on)", 0, 1, 1, "", 1)},
        lambda v: (lambda bits, fmt, top, method: f"volume={2.0 ** (bits - top)!r},aresample=osf={fmt}:dither_method={method},aresample=osf=flt,volume={2.0 ** (top - bits)!r}")(
            int(round(v["bits"])), "s16" if v["bits"] <= 16 else "s32", 16 if v["bits"] <= 16 else 32, "shibata" if v["shaping"] >= 0.5 else "triangular"
        ),
    ),
    # RX-04's amount: the processed channels blended with the untouched ones; 100% is the fixed chain these replaced
    "center-extract": ({"amount": ("Amount", 0, 100, 100, "%")}, lambda v: f"pan=stereo|c0={1 - v['amount'] / 200:.6f}*c0+{v['amount'] / 200:.6f}*c1|c1={v['amount'] / 200:.6f}*c0+{1 - v['amount'] / 200:.6f}*c1"),
    "center-remove": ({"amount": ("Amount", 0, 100, 100, "%")}, lambda v: f"pan=stereo|c0=c0-{v['amount'] / 100:.6f}*c1|c1=c1-{v['amount'] / 100:.6f}*c0"),
    "truncate-silence": ({"threshold": ("Below", -80, -20, -45, "dB"), "seconds": ("Longer than", 0.1, 5, 0.5, "s")}, lambda v: f"silenceremove=stop_periods=-1:stop_duration={v['seconds']:.2f}:stop_threshold={v['threshold']:.1f}dB"),
    "denoise": ({"floor": ("Noise floor", -80, -20, -25, "dB")}, lambda v: f"afftdn=nf={v['floor']:.1f}"),
    "de-ess-strong": ({"intensity": ("Intensity", 0, 100, 80, "%")}, lambda v: f"deesser=i={v['intensity'] / 100:.2f}:m=0.5:f=0.5"),
    "bass": ({"gain": ("Gain", -20, 20, 8, "dB")}, lambda v: f"bass=g={v['gain']:.1f}:f=120"),
    "treble": ({"gain": ("Gain", -20, 20, 6, "dB")}, lambda v: f"treble=g={v['gain']:.1f}:f=3500"),
    "presence-lift": ({"freq": ("Frequency", 200, 12000, 3000, "Hz"), "gain": ("Gain", -15, 15, 5, "dB")}, lambda v: f"equalizer=f={v['freq']:.0f}:t=q:w=1.2:g={v['gain']:.1f}"),
    "echo": ({"delay": ("Delay", 20, 2000, 100, "ms"), "decay": ("Decay", 5, 90, 40, "%")}, lambda v: f"aecho=0.8:0.7:{v['delay']:.0f}:{v['decay'] / 100:.2f}"),
    "click-removal": ({"threshold": ("Threshold", 1, 20, 2, ""), "window": ("Window", 10, 100, 55, "ms")}, lambda v: f"adeclick=w={v['window']:.0f}:t={v['threshold']:.1f}"),
    "gap-repair": ({"window": ("Window", 10, 100, 10, "ms"), "order": ("Order", 0, 25, 4, "")}, lambda v: f"adeclick=w={v['window']:.0f}:o=50:a={v['order']:.0f}"),
    "de-clip": ({"threshold": ("Threshold", 1, 100, 10, ""), "window": ("Window", 10, 100, 55, "ms")}, lambda v: f"adeclip=w={v['window']:.0f}:t={v['threshold']:.1f}"),
    "de-crackle": ({"threshold": ("Threshold", 1, 20, 5, ""), "window": ("Window", 10, 100, 20, "ms")}, lambda v: f"adeclick=w={v['window']:.0f}:o=75:t={v['threshold']:.1f}"),
    "mouth-declick": ({"threshold": ("Threshold", 1, 20, 2, ""), "window": ("Window", 10, 100, 10, "ms")}, lambda v: f"highpass=f=60,adeclick=w={v['window']:.0f}:o=75:t={v['threshold']:.1f}"),
    "de-plosive": ({"cutoff": ("Cutoff", 40, 300, 100, "Hz")}, lambda v: f"highpass=f={v['cutoff']:.0f}:poles=2"),
    "de-wind": ({"cutoff": ("Cutoff", 60, 400, 150, "Hz"), "floor": ("Noise floor", -80, -20, -30, "dB")}, lambda v: f"highpass=f={v['cutoff']:.0f}:poles=2,afftdn=nf={v['floor']:.1f}"),
    "hum-remover": (
        {"harmonics": ("Harmonics", 1, 6, 2, ""), "width": ("Notch width", 1, 30, 4, "Q")},
        lambda v: ",".join(f"bandreject=f={f * k}:width_type=q:w={v['width']:.1f}" for k in range(1, int(round(v["harmonics"])) + 1) for f in (50, 60)),
    ),
    "reverb": (
        {"size": ("Size", 0.2, 6, 1.5, "s"), "decay": ("Decay", 0.1, 5, 0.8, "s"), "mix": ("Mix", 0, 100, 30, "%")},
        lambda v: f"asplit=3[d][s][m];[s]atrim=0:{v['size']:.2f},aeval=(random(0)*2-1)*exp(-t/{v['decay']:.2f}):c=same[ir];[m][ir]afir=dry=1:wet=1:gtype=rms[w];[d][w]amix=inputs=2:weights={1 - v['mix'] / 100:.2f} {v['mix'] / 100:.2f}:normalize=0",
    ),
    "ramp": (
        {"tempo_from": ("Tempo at start", 50, 200, 100, "%"), "tempo_to": ("Tempo at end", 50, 200, 100, "%"), "pitch_from": ("Pitch at start", -12, 12, 0, "st"), "pitch_to": ("Pitch at end", -12, 12, 0, "st")},
        lambda v: "rubberband=tempo=1:pitch=1",
    ),
    "dereverb": (
        {"amount": ("Amount", 0, 100, 70, "%"), "rt60": ("Reverb time", 0.2, 3, 0.8, "s"), "floor": ("Floor", 6, 30, 18, "dB")},
        lambda v: "anull",
    ),
    "spot-heal": (
        {"low": ("Low", 20, 24000, 1000, "Hz"), "high": ("High", 20, 24000, 8000, "Hz"), "from": ("From", 0, 86400, 0, "s"), "to": ("To", 0, 86400, 0.1, "s")},
        lambda v: "anull",
    ),
    "wow-flutter": (
        {"low": ("Track from", 30, 12000, 500, "Hz"), "high": ("Track to", 30, 12000, 4000, "Hz"), "amount": ("Amount", 0, 100, 100, "%")},
        lambda v: "anull",
    ),
    "dialogue-contour": (
        {"range": ("Intonation range", 0, 200, 100, "%"), "start": ("Shift at start", -6, 6, 0, "st"), "end": ("Shift at end", -6, 6, 0, "st"), "smooth": ("Smoothing", 0, 500, 80, "ms"), "from": ("From", 0, 86400, 0, "s"), "to": ("To", 0, 86400, 0, "s")},
        lambda v: "anull",
    ),
    "pitch-correct": (
        {"key": ("Key (0 C to 11 B)", 0, 11, 0, ""), "scale": ("Scale (0 chromatic, 1 major, 2 minor)", 0, 2, 0, ""), "speed": ("Retune speed", 0, 400, 20, "ms"), "amount": ("Amount", 0, 100, 100, "%")},
        lambda v: "anull",
    ),
    "band-gain": (
        {"low": ("From", 20, 20000, 2000, "Hz"), "high": ("To", 40, 22000, 4000, "Hz"), "gain": ("Gain", -60, 24, -30, "dB")},
        lambda v: (lambda lo, hi, g: f"firequalizer=gain_entry='entry(0,0);entry({lo * 0.97:.1f},0);entry({lo:.1f},{g:.1f});entry({hi:.1f},{g:.1f});entry({hi * 1.03:.1f},0);entry(24000,0)'")(
            min(v["low"], v["high"]), max(v["high"], v["low"] * 1.05), v["gain"]
        ),
    ),
    "eq-3band": (
        {"low": ("Low shelf 120 Hz", -15, 15, 0, "dB"), "freq": ("Mid frequency", 200, 8000, 1000, "Hz"), "mid": ("Mid gain", -15, 15, 0, "dB"), "high": ("High shelf 8 kHz", -15, 15, 0, "dB")},
        lambda v: f"lowshelf=g={v['low']:.1f}:f=120,equalizer=f={v['freq']:.0f}:t=q:w=1:g={v['mid']:.1f},highshelf=g={v['high']:.1f}:f=8000",
    ),
    "graphic-eq-5": (
        {"b60": ("60 Hz", -15, 15, 0, "dB"), "b250": ("250 Hz", -15, 15, 0, "dB"), "b1k": ("1 kHz", -15, 15, 0, "dB"), "b4k": ("4 kHz", -15, 15, 0, "dB"), "b12k": ("12 kHz", -15, 15, 0, "dB")},
        lambda v: f"firequalizer=gain_entry='entry(60,{v['b60']:.1f});entry(250,{v['b250']:.1f});entry(1000,{v['b1k']:.1f});entry(4000,{v['b4k']:.1f});entry(12000,{v['b12k']:.1f})'",
    ),
}


def _values(name: str, given: dict | None) -> dict[str, float]:
    """The effect's parameter values: given ones clamped to their ranges, defaults for the rest."""
    spec = PARAMS.get(name, ({}, None))[0]
    out = {}
    for key, (_, lo, hi, default, *_rest) in spec.items():
        try:
            value = float((given or {}).get(key, default))
        except (TypeError, ValueError):
            value = default
        out[key] = min(max(value, lo), hi)
    return out


def _noise_range(params: dict | None, duration: float) -> tuple[float, float] | None:
    """The learned noise range in seconds, (start, end), from `noise_from` and `noise_to`; None when absent. At least 0.1 s, inside the file."""
    if not params or "noise_from" not in params or "noise_to" not in params:
        return None
    try:
        start, end = float(params["noise_from"]), float(params["noise_to"])
    except (TypeError, ValueError) as err:
        raise media.MediaError("the noise range must be two numbers in seconds") from err
    if not (0 <= start < end <= duration + 1e-6) or end - start < 0.1:
        raise media.MediaError(f"the noise range must lie inside the clip and last at least 0.1 s (got {start:.2f} to {end:.2f} s of {duration:.2f})")
    return start, min(end, duration)


LEARNS_NOISE = frozenset(key for key, chain in ALL_CHAINS.items() if "afftdn" in chain) | frozenset(key for key, (_, builder) in PARAMS.items() if callable(builder) and "afftdn" in builder({k: v[3] for k, v in PARAMS[key][0].items()}))


def _controls(key: str) -> list[dict]:
    spec = PARAMS.get(key, ({}, None))[0]
    return [{"id": p, "label": label, "min": lo, "max": hi, "default": default, "unit": unit, **({"step": step[0]} if step else {})} for p, (label, lo, hi, default, unit, *step) in spec.items()]


#: Effects whose output does not line up sample for sample with the source (length or order changes), so they apply to a
#: whole clip only, never to a range inside one.
RETIMING = {"tempo-faster", "tempo-slower", "stretch-rhythmic", "speed-faster", "extreme-stretch", "paulstretch", "truncate-silence", "reverse", "ramp"}


def _ramp_chain(v: dict[str, float], duration: float, steps: int = 100) -> str:
    """rubberband driven by asendcmd: tempo and pitch move linearly from their start to their end values in `steps` pieces over `duration` seconds, each piece set at its own centre."""
    tf, tt = v["tempo_from"] / 100, v["tempo_to"] / 100
    pf, pt = 2 ** (v["pitch_from"] / 12), 2 ** (v["pitch_to"] / 12)
    cmds = []
    for i in range(steps):
        at = i * duration / steps
        k = (i + 0.5) / steps
        tempo = tf + (tt - tf) * k
        pitch = pf * (pt / pf) ** k
        if abs(pitch - tempo) < 0.002:
            pitch *= 1.001
        cmds.append(f"{at:.4f} rubberband tempo {tempo:.5f}; {at:.4f} rubberband pitch {pitch:.5f}")
    joined = "; ".join(cmds)
    return f"asendcmd=c='{joined}',rubberband=tempo={tf:.5f}:pitch={pf:.5f}"


def catalogue() -> list[dict]:
    from . import plugins

    built_in = [{"group": group, "effects": [{"id": key, "label": label, "params": _controls(key), "retimes": key in RETIMING, "learnsNoise": key in LEARNS_NOISE} for key, label in items]} for group, items in GROUPS]
    return built_in + plugins.catalogue_group()


def _dereverb(x, rate: int, v: dict):
    """Late-reverberation suppression (Lebart and Boucher's model): in a short-time spectrum, the late reverberant power
    at a frame is the power about 50 ms earlier, decayed at the rate a reverb time of `rt60` implies; a spectral
    subtraction gain removes `amount` of it, floored at `floor` dB. Periodic Hann windows at a quarter-frame hop
    overlap-add to exactly 1.5, so at amount 0 the output equals the input; frames are processed 1024 at a time."""
    import math

    import numpy as np

    n = 2048 if rate > 32000 else 1024
    hop = n // 4
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
    ola = float((win**2).sum()) / hop
    amount = v["amount"] / 100.0
    floor2 = 10 ** (-v["floor"] / 10)
    tail = max(1, round(0.05 * rate / hop))
    decay = math.exp(-2 * (3 * math.log(10) / v["rt60"]) * tail * hop / rate)
    y = np.zeros(x.shape, dtype=np.float32)
    for c in range(x.shape[1]):
        sig = np.concatenate([np.zeros(n), x[:, c].astype(np.float64), np.zeros(n)])
        frames = np.lib.stride_tricks.sliding_window_view(sig, n)[::hop]
        out = np.zeros(len(sig))
        history = np.zeros((tail, n // 2 + 1))
        smooth = np.zeros(n // 2 + 1)
        for b in range(0, len(frames), 1024):
            spec = np.fft.rfft(frames[b : b + 1024] * win, axis=1)
            power = np.abs(spec) ** 2
            # a reverberant tail's power in one bin and frame fluctuates widely, so the ratio is taken between powers
            # smoothed over about 20 ms, and Amount 100% over-subtracts twice the estimate
            ps = np.empty_like(power)
            for k in range(len(power)):
                smooth = 0.6 * smooth + 0.4 * power[k]
                ps[k] = smooth
            prev = np.vstack([history, ps])
            late = decay * prev[: len(ps)]
            gain = np.sqrt(np.maximum(1 - 2 * amount * late / (ps + 1e-20), floor2)) if amount > 0 else 1.0
            back = np.fft.irfft(spec * gain, n, axis=1) * win
            for k in range(len(back)):
                at = (b + k) * hop
                out[at : at + n] += back[k]
            history = prev[-tail:]
        y[:, c] = (out[n : n + len(x)] / ola).astype(np.float32)
    return y


def _spot_heal(x, rate: int, v: dict):
    """Spectral repair of a box (Audition's Spot Healing Brush, RX's Spectral Repair in its attenuate mode): inside the
    box from `from` to `to` seconds and `low` to `high` Hz, each bin's magnitude is capped at the level the four frames
    before and after the box predict (interpolated between them in dB across the box), the phase kept; whatever stands
    above its surroundings (a whistle, a click) comes down to them, and material running through the box at its
    surroundings' level passes. Only a segment around the box is transformed; every frame outside it reconstructs
    exactly, so the audio outside the box is unchanged."""
    import numpy as np

    n = 2048 if rate > 32000 else 1024
    hop = n // 4
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
    ola = float((win**2).sum()) / hop
    lo, hi = sorted((float(v["low"]), float(v["high"])))
    t0, t1 = sorted((float(v["from"]), float(v["to"])))
    bins = n // 2 + 1
    b0, b1 = max(0, int(lo * n / rate)), min(bins, int(np.ceil(hi * n / rate)) + 1)
    s0 = max(0, int(t0 * rate) - 6 * n)
    s1 = min(len(x), int(t1 * rate) + 6 * n)
    if b1 <= b0 or s1 - s0 < 2 * n:
        return x.astype(np.float32)
    y = x.astype(np.float32).copy()
    for c in range(x.shape[1]):
        seg = np.concatenate([np.zeros(n), x[s0:s1, c].astype(np.float64), np.zeros(n)])
        frames = np.lib.stride_tricks.sliding_window_view(seg, n)[::hop]
        spec = np.fft.rfft(frames * win, axis=1)
        # frame i covers segment samples i*hop - n .. i*hop, its centre at i*hop - n/2 (segment time)
        centre = (np.arange(len(spec)) * hop - n / 2 + s0) / rate
        # every frame whose window overlaps the box: a click 10 ms wide reaches every frame its 43 ms windows cover
        half = n / 2 / rate
        inside = np.nonzero((centre + half >= t0) & (centre - half <= t1))[0]
        if len(inside):
            f0, f1 = int(inside[0]), int(inside[-1])
            left = np.abs(spec[max(0, f0 - 4) : f0, b0:b1])
            right = np.abs(spec[f1 + 1 : f1 + 5, b0:b1])
            ref_l = np.log(left.mean(axis=0) + 1e-12) if len(left) else None
            ref_r = np.log(right.mean(axis=0) + 1e-12) if len(right) else None
            ref_l = ref_r if ref_l is None else ref_l
            ref_r = ref_l if ref_r is None else ref_r
            for k in range(f0, f1 + 1):
                w = (k - f0 + 1) / (f1 - f0 + 2)
                ref = np.exp((1 - w) * ref_l + w * ref_r)
                mag = np.abs(spec[k, b0:b1])
                spec[k, b0:b1] *= np.minimum(1.0, ref / (mag + 1e-12))
        back = np.fft.irfft(spec, n, axis=1) * win
        out = np.zeros(len(seg))
        for k in range(len(back)):
            out[k * hop : k * hop + n] += back[k]
        y[s0:s1, c] = (out[n : n + (s1 - s0)] / ola).astype(np.float32)
    return y


def _wow_flutter(x, rate: int, v: dict):
    """Wow and flutter removal (RX's Wow & Flutter): a steady component between Low and High Hz (a held note, a hum, a
    tape's bias or test tone) is tracked every 5 ms (the strongest STFT peak, refined by a parabola through its log
    magnitudes); its frequency over its median is the speed the recording drifted by, which shifts every component
    alike, so resampling the audio by the inverse of that speed curve (cubic interpolation) undoes it. Amount scales the
    correction. Positions are kept at frame resolution and the output is rendered a million samples at a time."""
    import numpy as np

    lo, hi = sorted((float(v["low"]), float(v["high"])))
    # the window spans about 20 periods of the lowest frequency tracked and no more: a long window averages flutter
    # away (8192 points at 48 kHz is one whole period of 6 Hz flutter), so a higher reference tracks faster drift
    n = int(min(16384, max(2048, 2 ** np.ceil(np.log2(20 * rate / max(lo, 1.0))))))
    hop = max(1, rate // 200)
    win = np.hanning(n)
    mono = x.mean(axis=1).astype(np.float64)
    padded = np.concatenate([np.zeros(n // 2), mono, np.zeros(n // 2)])
    frames = np.lib.stride_tricks.sliding_window_view(padded, n)[::hop][: len(mono) // hop + 1]
    b0, b1 = max(1, int(lo * n / rate)), min(n // 2 - 1, int(hi * n / rate) + 1)
    if b1 - b0 < 3 or len(frames) < 8:
        return x.astype(np.float32)
    freq = np.empty(len(frames))
    for s in range(0, len(frames), 512):
        mag = np.log(np.abs(np.fft.rfft(frames[s : s + 512] * win, axis=1))[:, b0 - 1 : b1 + 1] + 1e-12)
        k = np.argmax(mag[:, 1:-1], axis=1) + 1
        a, b, c = mag[np.arange(len(k)), k - 1], mag[np.arange(len(k)), k], mag[np.arange(len(k)), k + 1]
        den = a - 2 * b + c
        off = np.where(np.abs(den) > 1e-12, 0.5 * (a - c) / np.where(np.abs(den) > 1e-12, den, 1), 0.0)
        freq[s : s + len(k)] = (b0 - 1 + k + off) * rate / n
    ratio = freq / np.median(freq)
    ratio = np.where(np.abs(ratio - 1) > 0.08, 1.0, ratio)  # a jump to another component is not a speed change
    ratio = np.convolve(np.pad(ratio, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    ratio = 1 + (v["amount"] / 100.0) * (ratio - 1)
    centres = np.arange(len(ratio)) * float(hop)
    tau = np.concatenate([[0.0], np.cumsum(ratio[:-1] * hop)])  # source time at each frame centre, in samples
    last = len(mono) - 1
    if centres[-1] < last:  # the table runs to the last sample, so interpolation never extrapolates
        tau = np.append(tau, tau[-1] + ratio[-1] * (last - centres[-1]))
        centres = np.append(centres, float(last))
    total = int(tau[-1]) + 1
    y = np.zeros((total, x.shape[1]), dtype=np.float32)
    src = x.astype(np.float32)
    for s in range(0, total, 1 << 20):
        u = np.arange(s, min(total, s + (1 << 20)), dtype=np.float64)
        t = np.interp(u, tau, centres)
        i = np.floor(t).astype(np.int64)
        f = (t - i)[:, None]
        p0, p1, p2, p3 = (src[np.clip(i + d, 0, last)] for d in (-1, 0, 1, 2))
        y[s : s + len(u)] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
    return y


def _f0_track(mono, rate: int):
    """YIN (de Cheveigne and Kawahara) every 5 ms on a 16 kHz copy, 60 to 1000 Hz: the cumulative-mean-normalised
    difference's first dip under 0.15 (else its minimum, voiced only under 0.35), refined by a parabola. Returns the
    hop in seconds and per-frame frequencies, 0 where unvoiced."""
    import numpy as np

    factor = max(1, rate // 16000)
    fs = rate / factor
    if factor > 1:
        k = np.arange(-32, 33)
        lp = np.sinc(k / factor) * np.hamming(len(k)) / factor
        sig = np.convolve(mono, lp, mode="same")[::factor]
    else:
        sig = mono
    w, hop = int(0.032 * fs), int(0.005 * fs)
    lo, hi = max(2, int(fs / 1000)), int(fs / 60)
    sig = np.concatenate([sig, np.zeros(w + hi + 1)])
    count = max(0, (len(sig) - w - hi - 1) // hop)
    span = w + hi + 1
    size = 1 << int(np.ceil(np.log2(w + span)))
    out = np.zeros(count)
    for b in range(0, count, 256):
        idx = np.arange(b, min(count, b + 256))
        frames = np.stack([sig[i * hop : i * hop + span] for i in idx])
        r = np.fft.irfft(np.conj(np.fft.rfft(frames[:, :w], size)) * np.fft.rfft(frames, size), size)[:, : hi + 1]
        sq = np.concatenate([np.zeros((len(idx), 1)), np.cumsum(frames**2, axis=1)], axis=1)
        e0 = sq[:, w : w + 1]
        et = sq[:, w : w + hi + 1] - sq[:, : hi + 1]
        d = np.maximum(e0 + et - 2 * r, 0)
        d[:, 0] = 0
        cm = np.ones_like(d)
        cm[:, 1:] = d[:, 1:] * np.arange(1, hi + 1) / np.maximum(np.cumsum(d[:, 1:], axis=1), 1e-20)
        for j in range(len(idx)):
            row = cm[j]
            under = np.nonzero(row[lo:hi] < 0.15)[0]
            if len(under):
                t0 = lo + int(under[0])
                t = t0 + int(np.argmin(row[t0 : min(hi, t0 + max(2, t0 // 4))]))
            else:
                t = lo + int(np.argmin(row[lo:hi]))
                if row[t] > 0.35:
                    continue
            a, c0, c = row[t - 1], row[t], row[min(hi, t + 1)]
            den = a - 2 * c0 + c
            frac = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
            out[idx[j]] = fs / (t + max(-0.5, min(0.5, frac)))
    return hop / fs, out


def _pitch_correct(x, rate: int, v: dict):
    """Pitch correction (Pro Tools with Melodyne, Auto-Tune's correction): the pitch is tracked every 5 ms, each voiced
    frame's target is the nearest note of the key and scale (chromatic, major or minor), the correction glides to it
    with the Retune speed (0 ms snaps) and is scaled by Amount, and rubberband applies it over time from a command file
    every 10 ms; unvoiced frames glide back to no shift. The length is kept."""
    import numpy as np

    if v["amount"] <= 0:  # no correction asked: the input untouched (rubberband at a ratio of 1 still resynthesises)
        return x.astype(np.float32)
    step, f0 = _f0_track(x.mean(axis=1).astype(np.float64), rate)
    scales = {0: range(12), 1: (0, 2, 4, 5, 7, 9, 11), 2: (0, 2, 3, 5, 7, 8, 10)}
    allowed = sorted({(int(v["key"]) + d) % 12 for d in scales.get(int(v["scale"]), range(12))})
    target = np.zeros(len(f0))
    for i, f in enumerate(f0):
        if f > 0:
            midi = 69 + 12 * np.log2(f / 440.0)
            cands = [round(midi) + d for d in range(-2, 3) if (round(midi) + d) % 12 in allowed]
            target[i] = (min(cands, key=lambda m: abs(m - midi)) - midi) / 12  # octaves to shift
    alpha = 0.0 if v["speed"] <= 0 else float(np.exp(-step / (v["speed"] / 1000.0)))
    shift, acc = np.zeros(len(target)), 0.0
    for i, t in enumerate(target):
        acc = alpha * acc + (1 - alpha) * t
        shift[i] = acc
    return _rubberband_pitch(x, rate, 2 ** (shift * v["amount"] / 100.0), step, "Pitch correction")


def _rubberband_pitch(x, rate: int, ratio, step: float, label: str, formants: bool = False):
    """`x` shifted in pitch by `ratio` (one value every `step` seconds) through rubberband, the length kept. A command
    is written only when the ratio has moved by half a cent (100 commands a second throughout left notes uncorrected
    or overshot); consistency is rubberband's mode for pitch that changes over time, and smooth transients stop it
    resetting phase inside held notes (its defaults left notes wobbling over 40 to 100 cents); `formants` keeps the
    voice's formants where they were, for speech."""
    import os
    import tempfile as _tf

    import numpy as np

    from .audacity import _wav_bytes

    with _tf.TemporaryDirectory() as tmp:
        src, cmd, dst = (os.path.join(tmp, n) for n in ("in.wav", "pitch.cmd", "out.wav"))
        with open(src, "wb") as f:
            f.write(_wav_bytes([x[:, c] for c in range(x.shape[1])], rate))
        with open(cmd, "w") as f:
            last = None
            for i in range(0, len(ratio), 2):
                if last is None or abs(1200 * np.log2(ratio[i] / last)) >= 0.5:
                    f.write(f"{i * step:.4f} rubberband pitch {ratio[i]:.6f};\n")
                    last = ratio[i]
        chain = f"asendcmd=f={cmd},rubberband=tempo=1:pitch=1:pitchq=consistency:transients=smooth" + (":formant=preserved" if formants else "")
        done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", src, "-af", chain, "-c:a", "pcm_f32le", dst], capture_output=True, timeout=900)
        if done.returncode != 0:
            raise media.MediaError(f"{label} failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        raw = np.frombuffer(subprocess.run([media._tool("ffmpeg"), "-v", "error", "-i", dst, "-f", "f32le", "-"], capture_output=True).stdout, dtype="<f4")
    y = raw.reshape(-1, x.shape[1])[: len(x)]
    if len(y) < len(x):
        y = np.concatenate([y, np.zeros((len(x) - len(y), x.shape[1]), dtype=np.float32)])
    return y.astype(np.float32)


def _dialogue_contour(x, rate: int, v: dict):
    """RX's Dialogue Contour: a line's intonation reshaped. Between From and To (the whole clip when To is not after
    From), the pitch is tracked every 5 ms, its slow contour (the voiced pitch smoothed over Smoothing ms, in octaves)
    is scaled about its median by Range (0% flat, 100% as it was, 200% twice the movement), and a ramp from Shift at
    start to Shift at end (semitones) is added; the small fast movements of the voice are kept, unvoiced moments follow
    the ramp, and rubberband applies the difference with the formants kept where they were. Range 100% with no shift
    returns the input untouched."""
    import numpy as np

    if abs(v["range"] - 100) < 1e-9 and abs(v["start"]) < 1e-9 and abs(v["end"]) < 1e-9:
        return x.astype(np.float32)
    step, f0 = _f0_track(x.mean(axis=1).astype(np.float64), rate)
    t = np.arange(len(f0)) * step
    t0, t1 = float(v["from"]), float(v["to"])
    if t1 <= t0:
        t0, t1 = 0.0, len(x) / rate
    inside = (t >= t0) & (t < t1)
    voiced = (f0 > 0) & inside
    shift = np.zeros(len(f0))  # octaves
    ramp = (v["start"] + (v["end"] - v["start"]) * np.clip((t - t0) / max(t1 - t0, 1e-9), 0, 1)) / 12
    shift[inside] = ramp[inside]
    if voiced.sum() >= 4 and abs(v["range"] - 100) > 1e-9:
        p = np.log2(np.where(voiced, f0, 1.0))
        idx = np.nonzero(voiced)[0]
        filled = np.interp(np.arange(len(f0)), idx, p[idx])  # unvoiced gaps bridged for the smoothing
        k = max(1, int(round(v["smooth"] / 1000 / step)))
        slow = np.convolve(np.pad(filled, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k] if k > 1 else filled
        ref = float(np.median(p[voiced]))
        shift[voiced] += (v["range"] / 100.0 - 1.0) * (slow[voiced] - ref)
    # the shift eases in and out over 20 ms at the edges of the span, so the audio outside it is not jolted
    ease = max(1, int(0.02 / step))
    shift = np.convolve(np.pad(shift, ease, mode="edge"), np.ones(2 * ease + 1) / (2 * ease + 1), mode="same")[ease:-ease]
    return _rubberband_pitch(x, rate, 2**shift, step, "Dialogue contour", formants=True)


def _paulstretch(x, rate: int, v: dict):
    """Paulstretch (AU-B13), written from the published algorithm (Nasca's; no code taken): windows of the source,
    `resolution` seconds long, are read at 1/`factor` of the output's pace, each spectrum's magnitudes kept and its
    phases randomised (one set for all channels, so the stereo image holds), and the frames overlap-added at a quarter
    window with a Hann window; the output is normalised for the windows' overlap and to the source's level. A longer
    window smears more (smoother, less defined); the random phases are seeded, so the same input gives the same
    output. Output is limited to ten minutes."""
    import numpy as np

    factor, win = float(v["factor"]), max(64, int(v["resolution"] * rate) // 4 * 4)
    frames, channels = x.shape
    total = int(round(frames * factor))
    if total > 600 * rate:
        raise media.MediaError(f"stretched {factor:g} times this clip would run {total / rate / 60:.1f} minutes; Paulstretch keeps its output under 10")
    hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(win) / win)
    hop_out = win // 4
    hop_in = hop_out / factor
    source = np.vstack([x.astype(np.float64), np.zeros((win, channels))])
    out = np.zeros((total + win, channels), dtype=np.float64)
    overlap = np.zeros(total + win)
    rng = np.random.default_rng(1)
    pos, at = 0.0, 0
    while at < total:
        i = min(int(pos), frames)
        spectrum = np.fft.rfft(source[i : i + win] * hann[:, None], axis=0)
        phases = np.exp(2j * np.pi * rng.random(spectrum.shape[0]))[:, None]
        out[at : at + win] += np.fft.irfft(np.abs(spectrum) * phases, n=win, axis=0) * hann[:, None]
        overlap[at : at + win] += hann**2
        pos += hop_in
        at += hop_out
    y = out[:total] / np.sqrt(np.maximum(overlap[:total], 1e-3))[:, None]
    level_in = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    level_out = float(np.sqrt(np.mean(y**2)))
    if level_out > 1e-12:
        y *= level_in / level_out
    return y.astype(np.float32)


def _phase_rotate(x, rate: int, v: dict):
    """Phase rotation (RX-34): every frequency's phase turned by the same angle, x cos(a) - H(x) sin(a) with H the
    Hilbert transform computed exactly through the FFT, so the magnitude spectrum, and the sound, is unchanged while an
    asymmetric waveform's peaks even out. With Find the angle, the rotation from -90 to 90 degrees in 1-degree steps
    with the lowest peak is measured and used (a and a + 180 differ only in polarity), and it is reported in the
    result's name through the angle. The search looks only at samples whose analytic magnitude could hold the peak,
    and falls back to every sample when that bound does not hold."""
    import numpy as np

    x64 = x.astype(np.float64)
    n = x64.shape[0]
    h = np.zeros(n)
    h[0] = 1.0
    if n % 2 == 0:
        h[n // 2] = 1.0
        h[1 : n // 2] = 2.0
    else:
        h[1 : (n + 1) // 2] = 2.0
    analytic = np.fft.ifft(np.fft.fft(x64, axis=0) * h[:, None], axis=0)
    if v.get("auto", 0) >= 0.5:
        angles = np.radians(np.arange(-90, 91))
        mag = np.abs(analytic)
        bound = 0.5 * float(mag.max())
        cand = analytic[mag >= bound]

        def peaks(z):
            return np.array([np.abs((z * np.exp(1j * a)).real).max() for a in angles])

        p = peaks(cand)
        if p.min() < bound:
            p = peaks(analytic.reshape(-1))
        v["angle"] = float(np.degrees(angles[int(np.argmin(p))]))
    a = np.radians(v["angle"])
    return (analytic * np.exp(1j * a)).real.astype(np.float32)


def _downmix_mono(x, rate: int, v: dict):
    """Downmix to mono (RX-30): one channel, the mean of all the clip's channels, so a stereo clip becomes a mono one
    at the same level for content common to both."""
    import numpy as np

    return x.astype(np.float64).mean(axis=1, keepdims=True).astype(np.float32)


def _peak_normalize(x, rate: int, v: dict):
    """Audacity's Normalize: each channel's DC offset removed first when asked (its mean subtracted), then the peak
    brought to the target, the channels together (their balance kept) or each to the target on its own."""
    import numpy as np

    y = x.astype(np.float64)
    if v.get("dc", 0) >= 0.5:
        y = y - y.mean(axis=0, keepdims=True)
    peaks = np.abs(y).max(axis=0)
    if peaks.max() <= 1e-9:
        raise media.MediaError("the clip is silent; there is nothing to normalize")
    target = 10 ** (v["target"] / 20)
    if v.get("independent", 0) >= 0.5:
        gains = np.where(peaks > 1e-9, target / np.maximum(peaks, 1e-12), 1.0)
    else:
        gains = np.full(peaks.shape, target / peaks.max())
    return (y * gains).astype(np.float32)


NUMPY_EFFECTS = {"dereverb": _dereverb, "spot-heal": _spot_heal, "wow-flutter": _wow_flutter, "pitch-correct": _pitch_correct, "dialogue-contour": _dialogue_contour, "peak-normalize": _peak_normalize, "paulstretch": _paulstretch, "downmix-mono": _downmix_mono, "phase-rotate": _phase_rotate}


def debleed(media_id: str, reference_id: str, offset: int = 0, amount: float = 100.0) -> dict:
    """RX's De-bleed with a reference: what leaked into a recording from another source (headphone spill, a guitar
    amp in the vocal mic) is that source through a fixed path, so the path's transfer function per frequency bin is
    estimated from the cross-spectrum between the recording and the reference over the whole file (the wanted sound is
    unrelated to the reference and averages out), and the reference through that path is subtracted, `amount` of it.
    `offset` is the reference's frame at the recording's frame 0. A short-time spectrum of 2048 points at a quarter
    hop, accumulated then applied in blocks of 1024 frames; paths much longer than the frame (about 40 ms at 48 kHz)
    are only partly caught."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    info = media.media_info(media_id)
    ref_info = media.media_info(reference_id)
    rate = int(info["sampleRate"])
    if int(ref_info["sampleRate"]) != rate:
        raise media.MediaError("the reference must be at the recording's sample rate")
    view, _ = _wav_view(media_id)
    rview, _ = _wav_view(reference_id)
    frames_n = int(view.shape[0])
    ref = np.zeros(frames_n, dtype=np.float64)
    lo, hi = max(0, -int(offset)), min(frames_n, int(rview.shape[0]) - int(offset))
    if hi > lo:
        ref[lo:hi] = np.asarray(rview[lo + int(offset) : hi + int(offset)], dtype=np.float64).mean(axis=1)
    # The path is a delay and a short filter: the delay is found by cross-correlation and the filter (128 taps, from
    # 16 samples before the delay) by least squares, on at most the first minute; 128 numbers fitted to that much audio
    # stay clear of the wanted sound, where one estimate per frequency bin (the first version) drowned wherever the
    # wanted sound was louder, cutting only 5.7 dB. The subtraction is in the time domain, by blocks of FFT convolution.
    x = np.array(view, dtype=np.float32)
    y = np.zeros_like(x)
    k = float(amount) / 100.0
    taps, lead = 128, 16
    est_n = min(frames_n, 60 * rate)
    size = 1 << int(np.ceil(np.log2(2 * est_n + taps)))
    R = np.fft.rfft(ref[:est_n], size)
    auto = np.fft.irfft(np.abs(R) ** 2, size)[:taps]
    toeplitz = auto[np.abs(np.arange(taps)[:, None] - np.arange(taps)[None, :])]
    toeplitz[np.diag_indices(taps)] += 1e-9 * max(float(auto[0]), 1e-30)
    block = 1 << 16
    fsize = 1 << int(np.ceil(np.log2(block + taps)))

    def through(sig, h):  # sig filtered by h, overlap-add
        hf = np.fft.rfft(h, fsize)
        out = np.zeros(len(sig) + taps)
        for s in range(0, len(sig), block):
            part = np.fft.irfft(np.fft.rfft(sig[s : s + block], fsize) * hf, fsize)[: min(block, len(sig) - s) + taps - 1]
            out[s : s + len(part)] += part
        return out[: len(sig)]

    for c in range(x.shape[1]):
        xc = x[:, c].astype(np.float64)
        xcorr = np.fft.irfft(np.fft.rfft(xc[:est_n], size) * np.conj(R), size)  # xcorr[l] = sum x[t] ref[t - l]
        lags = np.concatenate([np.arange(0, min(est_n - 1, int(0.25 * rate)) + 1), -np.arange(1, min(est_n - 1, int(0.05 * rate)) + 1)])
        start = int(lags[np.argmax(np.abs(xcorr[lags % size]))]) - lead
        h = np.linalg.solve(toeplitz, xcorr[(start + np.arange(taps)) % size])

        def placed(h):  # the reference through h, delayed by `start`
            est = through(ref, h)
            out = np.zeros(frames_n)
            if start >= 0:
                out[start:] = est[: frames_n - start]
            else:
                out[: frames_n + start] = est[-start:]
            return out

        shifted = placed(h)
        # A second fit where the wanted sound is quietest: wherever it shares a pitch with the reference, the first fit
        # took some of it for leak (a line's harmonic on a pad's note held a fixture to 9.3 dB); the path is fitted
        # again from the 30% of 50 ms blocks left quietest by the first subtraction (pauses, breaths, gaps)
        blk = max(1, int(0.05 * rate))
        nb = est_n // blk
        if nb >= 20:
            energy = ((xc[: nb * blk] - shifted[: nb * blk]) ** 2).reshape(nb, blk).mean(axis=1)
            mask = np.zeros(est_n)
            # each block weighted by the inverse of what the first fit left in it: pauses dominate when there are
            # some, and without any the weights are near uniform (a cut at the quietest 30% still took in sung blocks)
            mask[: nb * blk] = np.repeat(1.0 / (energy + 1e-3 * float(np.median(energy)) + 1e-20), blk)
            ref_at = np.zeros(est_n)  # the reference delayed by `start`, over the fitted span
            if start >= 0:
                ref_at[start:] = ref[: est_n - start]
            else:
                ref_at[: est_n + start] = ref[-start : est_n - start]
            RA = np.fft.rfft(ref_at, size)
            p = np.fft.irfft(np.fft.rfft(mask * xc[:est_n], size) * np.conj(RA), size)[:taps]
            a = np.fft.irfft(np.fft.rfft(mask * ref_at, size) * np.conj(RA), size)[:taps]
            quiet = a[np.abs(np.arange(taps)[:, None] - np.arange(taps)[None, :])]
            quiet[np.diag_indices(taps)] += 1e-9 * max(float(a[0]), 1e-30)
            if a[0] > 0:
                shifted = placed(np.linalg.solve(quiet, p))
        y[:, c] = (xc - k * shifted).astype(np.float32)
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (De-bleed {k * 100:g}%).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


def apply(media_id: str, name: str, params: dict | None = None) -> dict:
    """Renders `name` (with `params` for an adjustable effect) over a stored media file into new media at the same rate;
    the source is kept."""
    if name.startswith("plugin:"):
        from . import plugins

        return plugins.apply(media_id, name, params)
    chain = ALL_CHAINS.get(name)
    if chain is None:
        raise media.MediaError(f"no effect named {name}")
    values = _values(name, params)
    builder = PARAMS.get(name, ({}, None))[1]
    if callable(builder):
        chain = builder(values)
    info = media.media_info(media_id)
    rate, channels = int(info["sampleRate"]), int(info["channels"])
    source = media_dir() / f"{media_id}.wav"
    if name in NUMPY_EFFECTS:
        import numpy as np

        from .audacity import _wav_bytes
        from .tools import _wav_view

        view, _ = _wav_view(media_id)
        y = NUMPY_EFFECTS[name](np.array(view, dtype=np.float32), rate, values)
        spec = PARAMS.get(name, ({}, None))[0]
        detail = "".join(f" {values[k]:g}{spec[k][4]}" for k in spec)
        stem = str(info["name"]).rsplit(".", 1)[0]
        return media.import_wav(f"{stem} ({LABELS.get(name, name).rstrip('.')}{detail}).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))
    if name in STEREO_ONLY and channels < 2:
        raise media.MediaError(f"{LABELS.get(name, name)} works between two channels and needs a stereo clip")
    if chain.startswith("loudnorm="):
        # Measured, then an exact linear gain (Audition's Match Loudness, as a reference). Single-pass loudnorm runs
        # dynamically and missed a -20 LUFS target by 0.9 LU on short clips; two-pass loudnorm still missed by 0.5 LU
        # against the ebur128 meter the app measures with. The gain is target minus ebur128's integrated loudness; a
        # limiter at -1 dBFS is added only when the gain would push the sample peak past it.
        import re as _re

        from .tools import _num, _run_text, stats

        target = float(_re.match(r"loudnorm=I=(-?[0-9.]+)", chain).group(1))
        measured = _num(r"I:\s+(-?[0-9.]+) LUFS", _run_text(["-i", str(media_dir() / f"{media_id}.wav"), "-af", "ebur128"]))
        peak_db = stats(media_id).get("peakDb")
        if measured is None or measured <= -70 or peak_db is None:
            raise media.MediaError("the clip is silent; there is nothing to bring to a loudness")
        gain = target - measured
        chain = f"volume={gain:.4f}dB"
        if peak_db + gain > -1:
            chain += f",alimiter=limit={10 ** (-1 / 20):.5f}:level=false"
    noise = _noise_range(params, int(info["frames"]) / rate)
    if name == "ramp":
        chain = _ramp_chain(values, int(info["frames"]) / rate)
    if noise and "afftdn" in chain:
        start, end = noise
        span = end - start
        chain = (
            f"asplit[fw_a][fw_b];[fw_a]atrim={start:.4f}:{end:.4f},asetpts=PTS-STARTPTS[fw_n];[fw_n][fw_b]concat=n=2:v=0:a=1,"
            f"asendcmd=c='0.0 afftdn sn start\\; {max(0.0, span - 0.05):.4f} afftdn sn stop',{chain},atrim=start={span:.4f},asetpts=PTS-STARTPTS"
        )
    elif noise:
        raise media.MediaError(f"{LABELS.get(name, name)} does not take a learned noise profile; Denoise, Deep denoise, Hiss cut, Guitar de-noise, De-wind and Enhance speech do")
    delay = (int(rate / 40) if "afftdn" in chain else 0) + (int(rate * 0.008) if "anlmdn=s=7:p=0.002:r=0.006" in chain else 0) + (int(rate * 0.005) - 1 if "alimiter" in chain else 0)
    if delay:
        chain += f",atrim=start_sample={delay},apad=pad_len={delay}"
    stereo = name in STEREO
    af = ("aformat=channel_layouts=stereo," if stereo else "") + chain + f",aresample={rate}"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "effect.wav"
        cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{media_id}.wav"),
               "-af", af, *([] if stereo else ["-ac", str(channels)]), "-c:a", "pcm_f32le", str(out)]
        done = subprocess.run(cmd, capture_output=True, timeout=900)
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"{LABELS.get(name, name)} failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        data = out.read_bytes()
    stem = str(info["name"]).rsplit(".", 1)[0]
    spec = PARAMS.get(name, ({}, None))[0]
    detail = "".join(f" {values[k]:g}{spec[k][4]}" for k in spec)
    return media.import_wav(f"{stem} ({LABELS.get(name, name).rstrip('.')}{detail}).wav", data)
