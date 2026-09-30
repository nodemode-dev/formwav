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
    "phase-rotate": "aphaseshift=shift=0.25",
    "azimuth": "adelay=delays=0|1",
    "center-extract": "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
    "center-remove": "pan=stereo|c0=c0-c1|c1=c1-c0",
    "swap-channels": "pan=stereo|c0=c1|c1=c0",
    "mid-side-encode": "stereotools=mode=lr>ms",
    "mid-side-decode": "stereotools=mode=ms>lr",
    "peak-normalize": "",
    "loudness-streaming": "loudnorm=I=-14:TP=-1:LRA=11",
    "loudness-broadcast": "loudnorm=I=-23:TP=-2:LRA=15",
    "exciter": "aexciter=amount=2",
    "eq-3band": "lowshelf=g=0:f=120,equalizer=f=1000:t=q:w=1:g=0,highshelf=g=0:f=8000",
    "graphic-eq-5": "firequalizer=gain_entry='entry(60,0);entry(250,0);entry(1000,0);entry(4000,0);entry(12000,0)'",
    "band-gain": "firequalizer=gain_entry='entry(0,0);entry(1940,0);entry(2000,-30);entry(4000,-30);entry(4120,0);entry(24000,0)'",
    "dialogue-isolate": "",
    "reverb": "asplit=3[d][s][m];[s]atrim=0:1.5,aeval=(random(0)*2-1)*exp(-t/0.8):c=same[ir];[m][ir]afir=dry=1:wet=1:gtype=rms[w];[d][w]amix=inputs=2:weights=0.7 0.3:normalize=0",
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
    ("Audacity effects", [("amplify-up", "Amplify..."), ("amplify-down", "Amplify -6 dB"), ("invert", "Invert"), ("reverse", "Reverse"), ("dc-offset", "Remove DC offset"), ("click-removal", "Click removal"), ("gap-repair", "Repair short gaps"), ("truncate-silence", "Truncate silence"), ("graphic-eq-voice", "Graphic EQ: voice"), ("filter-curve-lowcut", "Filter curve: low cut"), ("tempo-faster", "Change tempo..."), ("stretch-rhythmic", "Change tempo, rhythmic..."), ("tempo-slower", "Change tempo -10%"), ("pitch-up-semitone", "Change pitch..."), ("pitch-down-semitone", "Change pitch -1 semitone"), ("speed-faster", "Change speed..."), ("extreme-stretch", "Extreme stretch...")]),
    ("Repair", [("de-clip", "De-clip"), ("de-crackle", "De-crackle"), ("mouth-declick", "Mouth de-click"), ("de-plosive", "De-plosive"), ("de-wind", "De-wind"), ("voice-denoise", "Voice de-noise"), ("guitar-denoise", "Guitar de-noise"), ("de-ess-strong", "De-ess, strong"), ("leveler", "Leveler"), ("dither", "Dither to 16-bit (noise shaped)"), ("phase-rotate", "Phase rotation"), ("azimuth", "Azimuth: right 1 ms"), ("band-gain", "Band gain (spectral)...")]),
    ("Channels", [("center-extract", "Center extract"), ("center-remove", "Center remove"), ("swap-channels", "Swap channels"), ("mid-side-encode", "Mid-side encode"), ("mid-side-decode", "Mid-side decode")]),
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
    "peak-normalize": ({"target": ("Peak", -24, 0, -1, "dBFS")}, None),
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
    "truncate-silence": ({"threshold": ("Below", -80, -20, -45, "dB"), "seconds": ("Longer than", 0.1, 5, 0.5, "s")}, lambda v: f"silenceremove=stop_periods=-1:stop_duration={v['seconds']:.2f}:stop_threshold={v['threshold']:.1f}dB"),
    "denoise": ({"floor": ("Noise floor", -80, -20, -25, "dB")}, lambda v: f"afftdn=nf={v['floor']:.1f}"),
    "de-ess-strong": ({"intensity": ("Intensity", 0, 100, 80, "%")}, lambda v: f"deesser=i={v['intensity'] / 100:.2f}:m=0.5:f=0.5"),
    "bass": ({"gain": ("Gain", -20, 20, 8, "dB")}, lambda v: f"bass=g={v['gain']:.1f}:f=120"),
    "treble": ({"gain": ("Gain", -20, 20, 6, "dB")}, lambda v: f"treble=g={v['gain']:.1f}:f=3500"),
    "presence-lift": ({"freq": ("Frequency", 200, 12000, 3000, "Hz"), "gain": ("Gain", -15, 15, 5, "dB")}, lambda v: f"equalizer=f={v['freq']:.0f}:t=q:w=1.2:g={v['gain']:.1f}"),
    "echo": ({"delay": ("Delay", 20, 2000, 100, "ms"), "decay": ("Decay", 5, 90, 40, "%")}, lambda v: f"aecho=0.8:0.7:{v['delay']:.0f}:{v['decay'] / 100:.2f}"),
    "click-removal": ({"threshold": ("Threshold", 1, 20, 2, ""), "window": ("Window", 10, 100, 55, "ms")}, lambda v: f"adeclick=w={v['window']:.0f}:t={v['threshold']:.1f}"),
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
    for key, (_, lo, hi, default, _) in spec.items():
        try:
            value = float((given or {}).get(key, default))
        except (TypeError, ValueError):
            value = default
        out[key] = min(max(value, lo), hi)
    return out


def _controls(key: str) -> list[dict]:
    spec = PARAMS.get(key, ({}, None))[0]
    return [{"id": p, "label": label, "min": lo, "max": hi, "default": default, "unit": unit} for p, (label, lo, hi, default, unit) in spec.items()]


#: Effects whose output does not line up sample for sample with the source (length or order changes), so they apply to a
#: whole clip only, never to a range inside one.
RETIMING = {"tempo-faster", "tempo-slower", "stretch-rhythmic", "speed-faster", "extreme-stretch", "truncate-silence", "reverse"}


def catalogue() -> list[dict]:
    return [{"group": group, "effects": [{"id": key, "label": label, "params": _controls(key), "retimes": key in RETIMING} for key, label in items]} for group, items in GROUPS]


def apply(media_id: str, name: str, params: dict | None = None) -> dict:
    """Renders `name` (with `params` for an adjustable effect) over a stored media file into new media at the same rate;
    the source is kept."""
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
    if name in STEREO_ONLY and channels < 2:
        raise media.MediaError(f"{LABELS.get(name, name)} works between two channels and needs a stereo clip")
    if name == "peak-normalize":
        from .tools import stats

        peak_db = stats(media_id).get("peakDb")
        if peak_db is None or peak_db <= -90:
            raise media.MediaError("the clip is silent; there is nothing to normalize")
        chain = f"volume={values['target'] - peak_db:.6f}dB"
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
