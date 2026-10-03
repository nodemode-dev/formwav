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
    "azimuth-measured": "",
    "dc-measured": "",
    "breath-control": "",
    "de-hum-adaptive": "",
    "de-ess-spectral": "",
    "spectral-recovery": "",
    "spectral-repair": "",
    "dialogue-leveler": "",
    "graphic-eq": "firequalizer=gain_entry='entry(31,0);entry(16000,0)'",
    "filter-curve": "firequalizer=gain_entry='entry(50,0);entry(15000,0)'",
    "dynamics-curve": "",
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
    ("Dynamics", [("compress", "Compress"), ("normalize", "Normalize to -16 LUFS"), ("level-rider", "Level rider"), ("peak-limiter", "Peak limiter"), ("dynamics-curve", "Dynamics curve...")]),
    ("Tone", [("bass", "Bass boost"), ("treble", "Treble boost"), ("warm-lows", "Warm lows"), ("presence-lift", "Presence lift"), ("mid-scoop", "Mid scoop"), ("crisp-detail", "Crisp detail"), ("eq-3band", "Parametric EQ, 3 bands..."), ("graphic-eq-5", "Graphic EQ, 5 bands..."), ("graphic-eq", "Graphic EQ, 10 bands..."), ("filter-curve", "Filter curve EQ...")]),
    ("Space", [("reverb", "Reverb..."), ("room", "Room echo"), ("hall", "Hall echo"), ("cathedral", "Cathedral echo"), ("plate", "Plate echo"), ("echo", "Echo"), ("slapback", "Slapback"), ("long-tail", "Long tail"), ("tunnel", "Tunnel"), ("small-booth", "Small booth"), ("far-away", "Far away"), ("wide-stage", "Wide stage"), ("stereo-bloom", "Stereo bloom")]),
    ("Character", [("radio", "Radio"), ("telephone", "Telephone"), ("bullhorn", "Bullhorn"), ("two-way-radio", "Two-way radio"), ("lofi-band", "Lo-fi band"), ("tape-warmth", "Tape warmth"), ("bit-crush", "Bit crush"), ("distortion", "Distortion"), ("robot", "Robot")]),
    ("Modulation", [("tremolo", "Tremolo"), ("vibrato", "Vibrato"), ("double-voice", "Double voice"), ("jet-flange", "Jet flange"), ("swirl-phase", "Swirl phase")]),
    ("Pitch", [("pitch_up", "Pitch up"), ("pitch_down", "Pitch down"), ("octave-up", "Octave up"), ("octave-down", "Octave down")]),
    ("Audacity effects", [("amplify-up", "Amplify..."), ("amplify-down", "Amplify -6 dB"), ("invert", "Invert"), ("reverse", "Reverse"), ("dc-offset", "Remove DC offset"), ("click-removal", "Click removal"), ("gap-repair", "Repair short gaps"), ("truncate-silence", "Truncate silence"), ("graphic-eq-voice", "Graphic EQ: voice"), ("filter-curve-lowcut", "Filter curve: low cut"), ("tempo-faster", "Change tempo..."), ("stretch-rhythmic", "Change tempo, rhythmic..."), ("tempo-slower", "Change tempo -10%"), ("pitch-up-semitone", "Change pitch..."), ("pitch-down-semitone", "Change pitch -1 semitone"), ("speed-faster", "Change speed..."), ("extreme-stretch", "Extreme stretch..."), ("paulstretch", "Paulstretch..."), ("ramp", "Ramp tempo and pitch...")]),
    ("Repair", [("de-clip", "De-clip"), ("de-crackle", "De-crackle"), ("mouth-declick", "Mouth de-click"), ("de-plosive", "De-plosive"), ("de-wind", "De-wind"), ("voice-denoise", "Voice de-noise"), ("guitar-denoise", "Guitar de-noise"), ("de-ess-strong", "De-ess, strong"), ("leveler", "Leveler"), ("dither", "Dither to 16-bit (noise shaped)"), ("phase-rotate", "Phase rotation"), ("azimuth", "Azimuth: right 1 ms"), ("band-gain", "Band gain (spectral)..."), ("dereverb", "De-reverb..."), ("spot-heal", "Spot heal (spectral)..."), ("wow-flutter", "Wow and flutter..."), ("pitch-correct", "Pitch correction..."), ("dialogue-contour", "Dialogue contour..."), ("azimuth-measured", "Azimuth (measured)"), ("dc-measured", "DC offset (measured)"), ("breath-control", "Breath control..."), ("de-hum-adaptive", "De-hum (adaptive)..."), ("de-ess-spectral", "De-ess (spectral)..."), ("spectral-recovery", "Spectral recovery..."), ("spectral-repair", "Spectral repair..."), ("dialogue-leveler", "Leveler (dialogue)...")]),
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


GRAPHIC_BANDS = (31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)


def _graphic_eq_chain(v: dict) -> str:
    """Graphic EQ (AU-B07's band sliders): ten octave bands from 31 Hz to 16 kHz, each -12 to +12 dB, joined smoothly
    by ffmpeg's FIR equalizer, each band's gain exact at its own frequency. Defined above PARAMS, which calls its builders
    when loaded. (scale=loglog, tried first for log-frequency joins, made the equalizer apply no gain at all.)"""
    entries = ";".join(f"entry({f},{v[f'b{f}']:.2f})" for f in GRAPHIC_BANDS)
    return f"firequalizer=gain_entry='{entries}'"


def _filter_curve_chain(v: dict) -> str:
    """Filter curve EQ (AU-B07's drawn curve): six points of frequency and gain, drawn in the Inspector's curve editor or
    typed, joined on a log-frequency scale (flat beyond the outermost points) by ffmpeg's FIR equalizer."""
    points = sorted((max(10.0, v[f"f{k}"]), v[f"g{k}"]) for k in range(1, 7))
    entries = ";".join(f"entry({f:.1f},{g:.2f})" for f, g in points)
    return f"firequalizer=gain_entry='{entries}'"


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
    "breath-control": ({"reduce": ("Reduction", 0, 40, 20, "dB")}, None),
    "dialogue-leveler": ({"target": ("Target RMS", -40, -6, -20, "dB"), "max_gain": ("Max gain", 1, 24, 12, "dB")}, None),
    "graphic-eq": (
        {f"b{f}": (name, -12, 12, 0, "dB") for f, name in ((31, "31 Hz"), (63, "63 Hz"), (125, "125 Hz"), (250, "250 Hz"), (500, "500 Hz"), (1000, "1 kHz"), (2000, "2 kHz"), (4000, "4 kHz"), (8000, "8 kHz"), (16000, "16 kHz"))},
        lambda v: _graphic_eq_chain(v),
    ),
    "filter-curve": (
        {**{f"f{k}": (f"Point {k} frequency", 20, 20000, d, "Hz") for k, d in zip(range(1, 7), (50, 200, 800, 2500, 6000, 15000))},
         **{f"g{k}": (f"Point {k} gain", -24, 24, 0, "dB") for k in range(1, 7)}},
        lambda v: _filter_curve_chain(v),
    ),
    "dynamics-curve": (
        {**{f"i{k}": (f"Point {k} in", -80, 0, d, "dB") for k, d in zip(range(1, 6), (-60, -40, -20, -10, 0))},
         **{f"o{k}": (f"Point {k} out", -80, 0, d, "dB") for k, d in zip(range(1, 6), (-60, -40, -20, -10, 0))}},
        None,
    ),
    "spectral-repair": (
        {
            "from": ("From", 0, 3600, 0, "s"),
            "to": ("To", 0, 3600, 0.1, "s"),
            "low": ("Low", 0, 24000, 0, "Hz"),
            "high": ("High", 0, 24000, 24000, "Hz"),
            "mode": ("Mode (0 attenuate, 1 replace, 2 fill gaps)", 0, 2, 1, "", 1),
            "resolution": ("Resolution (0 multi, 1 time, 2 balanced, 3 frequency)", 0, 3, 0, "", 1),
        },
        None,
    ),
    "de-hum-adaptive": ({"mains": ("Mains", 50, 60, 50, " Hz", 10), "harmonics": ("Harmonics", 1, 8, 4, "", 1)}, None),
    "de-ess-spectral": ({"threshold": ("Threshold", -50, 0, -30, "dB"), "reduce": ("Max reduction", 0, 30, 12, "dB")}, None),
    "spectral-recovery": ({"cutoff": ("Lost above", 2000, 16000, 8000, "Hz"), "amount": ("Amount", 0, 100, 70, "%")}, None),
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
    "de-plosive": ({"cutoff": ("Cutoff", 40, 300, 100, "Hz"), "detect": ("Only on bursts (1 = on)", 0, 1, 0, "", 1)}, lambda v: f"highpass=f={v['cutoff']:.0f}:poles=2"),
    "de-wind": ({"cutoff": ("Cutoff", 60, 400, 150, "Hz"), "floor": ("Noise floor", -80, -20, -30, "dB"), "detect": ("Only on gusts (1 = on)", 0, 1, 0, "", 1)}, lambda v: f"highpass=f={v['cutoff']:.0f}:poles=2,afftdn=nf={v['floor']:.1f}"),
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
        {"low": ("Track from", 30, 12000, 500, "Hz"), "high": ("Track to", 30, 12000, 4000, "Hz"), "amount": ("Amount", 0, 100, 100, "%"),
         "mode": ("Track (0 a steady tone in the band, 1 the whole spectrum)", 0, 1, 0, "", 1), "per_channel": ("Per channel (0 off, 1 on)", 0, 1, 0, "", 1)},
        lambda v: "anull",
    ),
    "dialogue-contour": (
        {"range": ("Intonation range", 0, 200, 100, "%"), "start": ("Shift at start", -6, 6, 0, "st"), "end": ("Shift at end", -6, 6, 0, "st"), "smooth": ("Smoothing", 0, 500, 80, "ms"), "from": ("From", 0, 86400, 0, "s"), "to": ("To", 0, 86400, 0, "s"),
         **{f"x{k}": (f"Curve point {k} at", 0, 100, (k - 1) * 25, "%") for k in range(1, 6)},
         **{f"c{k}": (f"Curve point {k}", -12, 12, 0, "st") for k in range(1, 6)}},
        lambda v: "anull",
    ),
    "pitch-correct": (
        {"key": ("Key (0 C to 11 B)", 0, 11, 0, ""), "scale": ("Scale (0 chromatic, 1 major, 2 minor)", 0, 2, 0, ""), "speed": ("Retune speed", 0, 400, 20, "ms"), "amount": ("Amount", 0, 100, 100, "%"),
         "formants": ("Keep formants (0 off, 1 on)", 0, 1, 0, "", 1)},
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


def _spot_heal_mask(x, rate: int, boxes: list):
    """AA-06, a painted heal: Spot heal over the union of `boxes` (each `from` and `to` seconds, `low` and `high` Hz) in
    one pass. The boxes become one mask over the STFT's frames and bins; in each bin every run of masked frames is
    capped at the level the four unmasked frames before and after that run predict (interpolated in dB across it), the
    phase kept, so a stroke painted over a whistle is predicted from the frames outside the stroke. (Healing the boxes
    one at a time let each predict from neighbours that still held the whistle: it came down 18 dB, not to the
    surroundings.) Frames outside the mask reconstruct exactly, as in Spot heal."""
    import numpy as np

    n = 2048 if rate > 32000 else 1024
    hop = n // 4
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
    ola = float((win**2).sum()) / hop
    bins = n // 2 + 1
    spans = []
    for box in boxes:
        lo, hi = sorted((float(box["low"]), float(box["high"])))
        t0, t1 = sorted((float(box["from"]), float(box["to"])))
        b0, b1 = max(0, int(lo * n / rate)), min(bins, int(np.ceil(hi * n / rate)) + 1)
        if b1 > b0 and t1 > t0:
            spans.append((t0, t1, b0, b1))
    if not spans:
        return x.astype(np.float32)
    s0 = max(0, int(min(s[0] for s in spans) * rate) - 6 * n)
    s1 = min(len(x), int(max(s[1] for s in spans) * rate) + 6 * n)
    if s1 - s0 < 2 * n:
        return x.astype(np.float32)
    y = x.astype(np.float32).copy()
    half = n / 2 / rate
    for c in range(x.shape[1]):
        seg = np.concatenate([np.zeros(n), x[s0:s1, c].astype(np.float64), np.zeros(n)])
        frames = np.lib.stride_tricks.sliding_window_view(seg, n)[::hop]
        spec = np.fft.rfft(frames * win, axis=1)
        centre = (np.arange(len(spec)) * hop - n / 2 + s0) / rate
        mask = np.zeros(spec.shape, dtype=bool)
        for t0, t1, b0, b1 in spans:
            mask[(centre + half >= t0) & (centre - half <= t1), b0:b1] = True
        mag = np.abs(spec)
        for b in np.nonzero(mask.any(axis=0))[0]:
            col = mask[:, b]
            edges = np.diff(np.concatenate([[0], col.astype(np.int8), [0]]))
            for f0, f1 in zip(np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0] - 1):
                left = [k for k in range(max(0, f0 - 4), f0) if not col[k]]
                right = [k for k in range(f1 + 1, min(len(col), f1 + 5)) if not col[k]]
                if not left and not right:
                    continue
                ref_l = np.log(mag[left, b].mean() + 1e-12) if left else None
                ref_r = np.log(mag[right, b].mean() + 1e-12) if right else None
                ref_l = ref_r if ref_l is None else ref_l
                ref_r = ref_l if ref_r is None else ref_r
                w = (np.arange(f0, f1 + 1) - f0 + 1) / (f1 - f0 + 2)
                ref = np.exp((1 - w) * ref_l + w * ref_r)
                spec[f0 : f1 + 1, b] *= np.minimum(1.0, ref / (mag[f0 : f1 + 1, b] + 1e-12))
        back = np.fft.irfft(spec, n, axis=1) * win
        out = np.zeros(len(seg))
        for k in range(len(back)):
            out[k * hop : k * hop + n] += back[k]
        y[s0:s1, c] = (out[n : n + (s1 - s0)] / ola).astype(np.float32)
    return y


def heal_painted(media_id: str, boxes: list) -> dict:
    """AA-06: the heal brush's stroke (its boxes in the media's seconds and Hz) healed in one pass, as new media."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    if not isinstance(boxes, list) or not 1 <= len(boxes) <= 2000 or not all(isinstance(b, dict) and {"from", "to", "low", "high"} <= set(b) for b in boxes):
        raise media.MediaError("a painted heal needs 1 to 2000 boxes, each with from, to, low and high")
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    view, _ = _wav_view(media_id)
    x = np.array(view, dtype=np.float32)
    # A stroke over a dropout fills it: when any 5 ms inside the stroke sits 30 dB below the 200 ms around it, the
    # stroke's box is rebuilt by spectral repair's Replace (magnitudes interpolated from both sides, each bin's phase
    # carried at its own frequency); otherwise the painted mask is attenuated to its surroundings.
    t0, t1 = min(float(b["from"]) for b in boxes), max(float(b["to"]) for b in boxes)
    lo, hi = min(float(b["low"]) for b in boxes), max(float(b["high"]) for b in boxes)
    mono = x.mean(axis=1).astype(np.float64)
    i0, i1 = max(0, int(t0 * rate)), min(len(mono), int(t1 * rate))
    block = max(1, int(0.005 * rate))
    inner = mono[i0:i1][: (i1 - i0) // block * block].reshape(-1, block) if i1 - i0 >= block else np.zeros((0, block))
    around = np.concatenate([mono[max(0, i0 - int(0.2 * rate)) : i0], mono[i1 : i1 + int(0.2 * rate)]])
    level = float(np.sqrt(np.mean(around**2))) if len(around) else 0.0
    filled = len(inner) > 0 and level > 1e-6 and float(np.sqrt((inner**2).mean(axis=1)).min()) < level * 10 ** (-30 / 20)
    if filled:
        y = _spectral_repair(x, rate, {"from": t0, "to": t1, "low": max(0.0, lo), "high": hi, "mode": 1, "resolution": 0})
    else:
        y = _spot_heal_mask(x, rate, boxes)
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (Heal brush{', filled' if filled else ''}).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


def _speed_from_peak(mono, rate: int, lo: float, hi: float, hop: int):
    """RX-51, a steady component (a held note, a hum, a tape's bias or test tone) between lo and hi Hz: the strongest
    peak each 5 ms, its frequency from the phase advance at that bin between frames (precise even in a short window),
    over its median. The window is 4 periods of lo, at least 1024 points: short enough to follow flutter well past 6 Hz
    (2048 points and more, as before, averaged a 15 Hz flutter away). None when the band holds too little."""
    import numpy as np

    n = int(min(16384, max(512, 2 ** np.ceil(np.log2(4 * rate / max(lo, 1.0))))))
    win = np.hanning(n)
    padded = np.concatenate([np.zeros(n // 2), mono, np.zeros(n // 2)])
    frames = np.lib.stride_tricks.sliding_window_view(padded, n)[::hop][: len(mono) // hop + 1]
    b0, b1 = max(1, int(lo * n / rate)), min(n // 2 - 1, int(hi * n / rate) + 1)
    if b1 - b0 < 3 or len(frames) < 8:
        return None
    # the component followed is the most persistent in the band over the whole recording, then its peak within 3% of
    # it each frame (each frame's strongest flipped between two equal tones, and the jumps left holes in the curve)
    power = np.zeros(b1 - b0)
    for s in range(0, len(frames), 512):
        power += (np.abs(np.fft.rfft(frames[s : s + 512] * win, axis=1)[:, b0:b1]) ** 2).sum(axis=0)
    kc = b0 + int(np.argmax(power))
    w0, w1 = max(b0, int(kc * 0.97) - 1), min(b1, int(np.ceil(kc * 1.03)) + 2)
    freq = np.empty(len(frames))
    prev = None
    for s in range(0, len(frames), 512):
        spec = np.fft.rfft(frames[s : s + 512] * win, axis=1)
        before = np.vstack([prev[None, :] if prev is not None else spec[:1], spec[:-1]])
        k = np.argmax(np.abs(spec[:, w0:w1]), axis=1) + w0
        rows = np.arange(len(k))
        dphi = np.angle(spec[rows, k]) - np.angle(before[rows, k]) - 2 * np.pi * k * hop / n
        dphi = (dphi + np.pi) % (2 * np.pi) - np.pi
        freq[s : s + len(k)] = (k + dphi * n / (2 * np.pi * hop)) * rate / n
        prev = spec[-1]
    freq[0] = freq[1]
    # a phase advance measures the stretch between two frames: moved half a hop, onto the frames' centres
    freq = np.concatenate([0.5 * (freq[1:] + freq[:-1]), freq[-1:]])
    ratio = freq / np.median(freq)
    return np.where(np.abs(ratio - 1) > 0.05, 1.0, ratio)  # a jump to another component is not a speed change


def _speed_from_spectrum(mono, rate: int, hop: int):
    """RX-51, no steady component needed: a change of speed scales every frequency alike, a shift along a log-frequency
    axis, so each 5 ms frame's log spectrum (80 Hz to 8 kHz, 300 bins an octave, levelled) is aligned against the
    average of the frames within a second either side, the best shift up to 3% found by correlation and a parabola.
    A second pass aligns against an average of the first pass's corrected spectra, which is sharper. Quiet frames keep
    speed 1. Notes, chords and harmonics all take part, so music or speech without a held tone can be corrected."""
    import numpy as np

    # 8192 points: 6 Hz bins, against 23 Hz at 2048, which at 220 Hz were 10% wide and could not see a 0.4% shift; the
    # upper harmonics then resolve about 0.2%; its 171 ms is short beside wow's periods
    n, bpo = (8192 if rate > 32000 else 4096), 300
    top = min(8000.0, 0.4 * rate)
    grid = 80.0 * 2 ** (np.arange(int(bpo * np.log2(top / 80.0))) / bpo)
    padded = np.concatenate([np.zeros(n // 2), mono, np.zeros(n // 2)])
    frames = np.lib.stride_tricks.sliding_window_view(padded, n)[::hop][: len(mono) // hop + 1]
    if len(frames) < 16:
        return None
    win = np.hanning(n)
    bins = np.fft.rfftfreq(n, 1 / rate)
    logs = np.empty((len(frames), len(grid)))
    energy = np.empty(len(frames))
    for s in range(0, len(frames), 256):
        mag = np.abs(np.fft.rfft(frames[s : s + 256] * win, axis=1))
        energy[s : s + len(mag)] = (mag**2).sum(axis=1)
        logs[s : s + len(mag)] = np.sqrt(np.stack([np.interp(grid, bins, m) for m in mag]))
    logs -= logs.mean(axis=1, keepdims=True)
    logs /= logs.std(axis=1, keepdims=True) + 1e-9
    reach = int(np.ceil(bpo * np.log2(1.03)))
    span = max(1, int(round(1.0 * rate / hop)))
    kernel = np.ones(2 * span + 1) / (2 * span + 1)

    def align(reference):
        corr = np.empty((len(frames), 2 * reach + 1))
        core = logs[:, reach:-reach]
        for j, shift in enumerate(range(-reach, reach + 1)):
            corr[:, j] = (core * reference[:, reach - shift : reference.shape[1] - reach - shift]).mean(axis=1)
        k = np.clip(np.argmax(corr, axis=1), 1, 2 * reach - 1)
        rows = np.arange(len(k))
        a, b, c = corr[rows, k - 1], corr[rows, k], corr[rows, k + 1]
        den = a - 2 * b + c
        off = np.where(np.abs(den) > 1e-12, 0.5 * (a - c) / np.where(np.abs(den) > 1e-12, den, 1), 0.0)
        # a parabola's peak lies within a bin of the best shift; a nearly flat correlation (a quiet frame) can put it
        # anywhere, and once put a ratio at 1e24
        return k - reach + np.clip(off, -1.0, 1.0)

    def smear(values):
        return np.stack([np.convolve(np.pad(values[:, i], span, mode="edge"), kernel, mode="valid") for i in range(values.shape[1])], axis=1)

    # each pass aligns against a reference straightened by the last estimate: the first reference still carries the
    # wow and pulls the estimate short (measured 26% short after two passes), so the passes converge on the full speed
    shift = align(smear(logs))
    for _ in range(3):
        straight = np.stack([np.interp(np.arange(logs.shape[1]) + s, np.arange(logs.shape[1]), row) for row, s in zip(logs, shift)])
        shift = align(smear(straight))
    ratio = 2 ** (shift / bpo)
    ratio = np.where(energy < 1e-4 * energy.max(), 1.0, ratio)
    return np.clip(ratio / np.median(ratio), 0.97, 1.03)


def _wow_flutter(x, rate: int, v: dict):
    """Wow and flutter removal (RX's Wow & Flutter): the recording's speed is tracked every 5 ms, from a steady
    component between Low and High Hz (mode 0, _speed_from_peak) or from the whole spectrum with no steady tone needed
    (mode 1, _speed_from_spectrum), for the mix or, with Per channel, for each channel apart (tracks of a tape can
    drift differently); resampling by the inverse of that speed curve (cubic interpolation) undoes it. Amount scales
    the correction. Positions are kept at frame resolution and the output is rendered a million samples at a time."""
    import numpy as np

    lo, hi = sorted((float(v["low"]), float(v["high"])))
    hop = max(1, rate // 200)
    mode, per_channel = int(round(float(v.get("mode", 0)))), int(round(float(v.get("per_channel", 0))))
    sources = [x[:, c].astype(np.float64) for c in range(x.shape[1])] if per_channel and x.shape[1] > 1 else [x.mean(axis=1).astype(np.float64)]
    outs = []
    for c, mono in enumerate(sources):
        ratio = _speed_from_spectrum(mono, rate, hop) if mode == 1 else _speed_from_peak(mono, rate, lo, hi, hop)
        part = x[:, c : c + 1] if len(sources) > 1 else x
        if ratio is None:
            outs.append(part.astype(np.float32))
            continue
        ratio = np.convolve(np.pad(ratio, 1, mode="edge"), np.ones(3) / 3, mode="valid")
        ratio = 1 + (v["amount"] / 100.0) * (ratio - 1)
        outs.append(_resample_by_speed(part, ratio, hop))
    if len(outs) == 1:
        return outs[0]
    shortest = min(len(o) for o in outs)
    return np.hstack([o[:shortest] for o in outs])


def _resample_by_speed(x, ratio, hop: int):
    """The audio read at the speed curve `ratio` (one value a hop), cubic interpolation, a million samples at a time."""
    import numpy as np

    mono_len = len(x)
    centres = np.arange(len(ratio)) * float(hop)
    tau = np.concatenate([[0.0], np.cumsum(ratio[:-1] * hop)])  # source time at each frame centre, in samples
    last = mono_len - 1
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
    return _rubberband_pitch(x, rate, 2 ** (shift * v["amount"] / 100.0), step, "Pitch correction", formants=bool(round(float(v.get("formants", 0)))))


def detect_notes(media_id: str) -> dict:
    """PT-10: the media's notes for the note editor: the pitch tracked every 5 ms (YIN), voiced frames grouped into a
    note while they stay within half a semitone of its running median (a frame or two of break bridged), notes of 60 ms
    or more kept, each with its start and end (the media's seconds) and median pitch (MIDI, fractional); with the pitch
    curve every 20 ms for drawing."""
    import numpy as np

    from .tools import _wav_view

    view, rate = _wav_view(media_id)
    mono = np.asarray(view, dtype=np.float64).mean(axis=1)
    step, f0 = _f0_track(mono, rate)
    # frames 50 dB under the loudest are not notes: YIN reads digital silence as a pitch near its 1 kHz ceiling
    hop = max(1, int(round(step * rate)))
    level = np.array([np.sqrt(np.mean(mono[i * hop : i * hop + hop] ** 2)) if i * hop < len(mono) else 0.0 for i in range(len(f0))])
    f0 = np.where(level > level.max() * 10 ** (-50 / 20), f0, 0.0)
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1e-9) / 440.0), np.nan)
    notes: list[dict] = []
    run: list[int] = []
    gap = 0

    def close() -> None:
        if len(run) * step >= 0.06:
            notes.append({"start": round(run[0] * step, 4), "end": round((run[-1] + 1) * step, 4), "midi": round(float(np.median(midi[run])), 3)})

    for i, m in enumerate(midi):
        if np.isnan(m):
            gap += 1
            if gap > 2 and run:
                close()
                run = []
            continue
        if run and abs(m - np.median(midi[run[-20:]])) > 0.5:
            close()
            run = []
        run.append(i)
        gap = 0
    if run:
        close()
    every = max(1, int(round(0.02 / step)))
    curve = [[round(i * step, 3), round(float(midi[i]), 2)] for i in range(0, len(midi), every) if not np.isnan(midi[i])]
    return {"notes": notes, "curve": curve}


def retune_notes(media_id: str, notes: list, formants: bool = True, glide_ms: float = 30.0) -> dict:
    """PT-10: each listed note ({"start", "end" in the media's seconds, "shift" in semitones}) moved by its shift, gliding
    in and out over `glide_ms`, everything else left where it was, through rubberband with the formants kept or not;
    the length is kept. A new media."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    if not isinstance(notes, list) or not 1 <= len(notes) <= 2000:
        raise media.MediaError("send 1 to 2000 notes, each with start, end and shift")
    info = media.media_info(media_id)
    view, rate = _wav_view(media_id)
    x = np.asarray(view, dtype=np.float32)
    step = 0.005
    frames = int(len(x) / rate / step) + 1
    target = np.zeros(frames)
    for n in notes:
        a, b, s = float(n["start"]), float(n["end"]), float(n["shift"])
        if not (b > a) or abs(s) > 24:
            raise media.MediaError("each note needs start before end and a shift within two octaves")
        target[int(a / step) : int(np.ceil(b / step))] = s / 12.0  # octaves
    alpha = 0.0 if glide_ms <= 0 else float(np.exp(-step / (glide_ms / 1000.0)))
    shift, acc = np.zeros(frames), 0.0
    for i, t in enumerate(target):
        acc = alpha * acc + (1 - alpha) * t
        shift[i] = acc
    y = _rubberband_pitch(x, rate, 2**shift, step, "Note edit", formants=bool(formants))
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (notes edited).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


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
            # RX-17: a command takes effect at the output about 3120 samples (65 ms at 48 kHz) before the moment it is
            # sent for, rubberband's latency (a 7-semitone step asked for at 1.000 s crossed at 0.935 s), so each is
            # sent that much later; the first is sent at once, so the opening pitch is right too
            lead = 3120 / rate
            for i in range(0, len(ratio), 2):
                if last is None or abs(1200 * np.log2(ratio[i] / last)) >= 0.5:
                    f.write(f"{0.0 if last is None else i * step + lead:.4f} rubberband pitch {ratio[i]:.6f};\n")
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

    # RX-17: a drawn contour, five points of (place in the span %, semitones), joined linearly and added to the ramp
    curve_pts = sorted((float(v.get(f"x{k}", (k - 1) * 25)), float(v.get(f"c{k}", 0.0))) for k in range(1, 6))
    curve_on = any(abs(c) > 1e-9 for _, c in curve_pts)
    if abs(v["range"] - 100) < 1e-9 and abs(v["start"]) < 1e-9 and abs(v["end"]) < 1e-9 and not curve_on:
        return x.astype(np.float32)
    step, f0 = _f0_track(x.mean(axis=1).astype(np.float64), rate)
    t = np.arange(len(f0)) * step
    t0, t1 = float(v["from"]), float(v["to"])
    if t1 <= t0:
        t0, t1 = 0.0, len(x) / rate
    inside = (t >= t0) & (t < t1)
    voiced = (f0 > 0) & inside
    shift = np.zeros(len(f0))  # octaves
    frac = np.clip((t - t0) / max(t1 - t0, 1e-9), 0, 1)
    ramp = (v["start"] + (v["end"] - v["start"]) * frac) / 12
    if curve_on:
        ramp = ramp + np.interp(frac * 100, [p for p, _ in curve_pts], [c for _, c in curve_pts]) / 12
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


def warp(media_id: str, segments: list) -> dict:
    """PT-09, warp markers: the media re-timed piecewise, each segment {"from", "to", "length"} (the source span in its
    own seconds and the seconds it should last) stretched by rubberband as Stretch does (tempo = span / length, 0.5x to
    2x), the pieces joined in order. Each piece but the last is rendered 5 ms longer from the source and crossfaded into
    the next (equal gain over those 5 ms), so the joins do not click and the total is exactly the sum of the lengths."""
    import numpy as np

    from . import tools
    from .audacity import _wav_bytes

    if not isinstance(segments, list) or not 1 <= len(segments) <= 256:
        raise media.MediaError("warp needs 1 to 256 segments")
    info = media.media_info(media_id)
    rate, frames = int(info["sampleRate"]), int(info["frames"])
    fade = int(0.005 * rate)
    out, pieces = [], []
    for k, seg in enumerate(segments):
        start, end, length = float(seg["from"]), float(seg["to"]), float(seg["length"])
        if not (0 <= start < end <= frames / rate + 1e-6) or length <= 0:
            raise media.MediaError("each warp segment needs 0 <= from < to within the file and a positive length")
        tempo = (end - start) / length
        if not 0.5 - 1e-6 <= tempo <= 2.0 + 1e-6:
            raise media.MediaError("a warp segment can stretch from half to twice its speed")
        last = k == len(segments) - 1
        extra = 0 if last else fade
        piece = tools.excerpt(media_id, start, min(frames / rate, end + extra * tempo / rate))
        if abs(tempo - 1) > 1e-4:
            piece = apply(piece["id"], "stretch-rhythmic", {"percent": (tempo - 1) * 100})
        view, _ = tools._wav_view(piece["id"])
        x = np.asarray(view, dtype=np.float64)
        if x.dtype == np.int16:
            x = x / 32768.0
        want = int(round(length * rate)) + extra
        x = x[:want] if len(x) >= want else np.vstack([x, np.zeros((want - len(x), x.shape[1]))])
        pieces.append(x)
    for k, x in enumerate(pieces):
        if out and fade and k > 0:
            tail = out[-1][-fade:]
            ramp = np.linspace(0, 1, fade)[:, None]
            x = x.copy()
            x[:fade] = tail * (1 - ramp) + x[:fade] * ramp
            out[-1] = out[-1][:-fade]
        out.append(x)
    y = np.vstack(out).astype(np.float32)
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (warped).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


def _match_channels(dry, out):
    """RX-35: a plugin commonly returns stereo for a mono clip (the CLAP test plugin does); when only the channel count
    differs and one side is mono, that side is copied to the other's channels, so the result can still be limited to a
    band or a drawn selection. Other mismatches are left for the caller to refuse."""
    import numpy as np

    if dry.shape[0] == out.shape[0] and dry.shape[1] != out.shape[1]:
        if dry.shape[1] == 1:
            dry = np.repeat(dry, out.shape[1], axis=1)
        elif out.shape[1] == 1:
            out = np.repeat(out, dry.shape[1], axis=1)
    return dry, out


def limit_to_band(dry_id: str, wet: dict, low: float, high: float) -> dict:
    """AU-31: an effect's result kept only inside a frequency band: out = dry + band(wet - dry), the band taken
    through the FFT with 20 Hz cosine edges, so below and above it the audio is the dry clip's exactly. An effect that
    changes timing cannot be limited to a band (its output no longer lines up)."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    lo, hi = sorted((max(0.0, low), max(0.0, high)))
    dv, rate = _wav_view(dry_id)
    wv, wrate = _wav_view(wet["id"])
    dry, out = np.asarray(dv, dtype=np.float64), np.asarray(wv, dtype=np.float64)
    dry, out = _match_channels(dry, out)
    if dry.shape != out.shape or rate != wrate:
        raise media.MediaError("this effect changes timing or channels, so it cannot be limited to a band")
    f = np.fft.rfftfreq(dry.shape[0], 1 / rate)
    edge = 20.0
    rise = np.clip((f - (lo - edge)) / edge, 0, 1)
    fall = np.clip(((hi + edge) - f) / edge, 0, 1)
    mask = (0.5 - 0.5 * np.cos(np.pi * rise)) * (0.5 - 0.5 * np.cos(np.pi * fall))
    diff = np.fft.irfft(np.fft.rfft(out - dry, axis=0) * mask[:, None], n=dry.shape[0], axis=0)
    y = (dry + diff).astype(np.float32)
    stem = wet.get("name", "audio").rsplit(".", 1)[0]
    return media.import_wav(f"{stem} ({lo:g} to {hi:g} Hz).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


def limit_to_boxes(dry_id: str, wet: dict, boxes: list) -> dict:
    """AA-05: an effect's result kept only inside a drawn time-frequency selection (a lasso's columns or a paint stroke's
    patches, each `from` and `to` in the media's seconds, `low` and `high` in Hz): out = dry + mask(wet - dry) through
    the STFT, the mask 1 on the frames whose centres and the bins whose frequencies fall in a box, so away from the
    selection the audio is the dry clip's exactly (at its edges the windows overlap by up to half a window)."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    if not isinstance(boxes, list) or not 1 <= len(boxes) <= 4000 or not all(isinstance(b, dict) and {"from", "to", "low", "high"} <= set(b) for b in boxes):
        raise media.MediaError("a drawn selection needs 1 to 4000 boxes, each with from, to, low and high")
    dv, rate = _wav_view(dry_id)
    wv, wrate = _wav_view(wet["id"])
    dry, out = np.asarray(dv, dtype=np.float64), np.asarray(wv, dtype=np.float64)
    dry, out = _match_channels(dry, out)
    if dry.shape != out.shape or rate != wrate:
        raise media.MediaError("this effect changes timing or channels, so it cannot be limited to a drawn selection")
    n = 2048 if rate > 32000 else 1024
    hop = n // 4
    spans = [(*sorted((float(b["from"]), float(b["to"]))), *sorted((float(b["low"]), float(b["high"])))) for b in boxes]

    def keep(spec, freqs, _channel):
        centre = (np.arange(spec.shape[0]) * hop - n / 2) / rate
        mask = np.zeros(spec.shape, dtype=bool)
        for t0, t1, lo, hi in spans:
            mask[np.ix_((centre >= t0) & (centre <= t1), (freqs >= lo) & (freqs <= hi))] = True
        return spec * mask

    y = (dry + _stft_map((out - dry).astype(np.float32), rate, n, keep)).astype(np.float32)
    stem = wet.get("name", "audio").rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (drawn selection).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))


def _stft_map(x, rate: int, n: int, fn):
    """Each channel through a short-time spectrum (periodic Hann windows at a quarter-frame hop, which overlap-add to
    exactly 1.5), fn(spec, freqs, channel) returning the spectrum to resynthesise; an unchanged spectrum gives the
    input back, so an effect built on it touches only the bins it changes."""
    import numpy as np

    hop = n // 4
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
    out = np.zeros(x.shape, dtype=np.float64)
    freqs = np.fft.rfftfreq(n, 1 / rate)
    for c in range(x.shape[1]):
        s = np.concatenate([np.zeros(n), x[:, c].astype(np.float64), np.zeros(n)])
        frames = 1 + (len(s) - n) // hop
        idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
        spec = fn(np.fft.rfft(s[idx] * w, axis=1), freqs, c)
        y = np.fft.irfft(spec, n=n, axis=1) * w
        acc = np.zeros(len(s))
        for i in range(frames):
            acc[i * hop : i * hop + n] += y[i]
        out[:, c] = (acc / 1.5)[n : n + len(x)]
    return out.astype(np.float32)


def _dynamics_curve(x, rate: int, v: dict):
    """Dynamics with a drawn transfer curve (AU-B06): five points mapping input level to output level (RMS dBFS, in 5 ms
    blocks, linked across channels), drawn in the Inspector's curve editor or typed; each block's gain is its output
    level less its input level, smoothed over 20 ms. Below the first point the curve continues at unity slope and above
    the last at the last segment's slope, so it never jumps at its ends."""
    import numpy as np

    pts = sorted((v[f"i{k}"], v[f"o{k}"]) for k in range(1, 6))
    ins = np.array([p[0] for p in pts], dtype=np.float64)
    outs = np.array([p[1] for p in pts], dtype=np.float64)
    xs = x.astype(np.float64)
    power = np.mean(xs**2, axis=1)
    hop = max(1, int(rate * 0.005))
    frames = int(np.ceil(len(power) / hop))
    padded = np.pad(power, (0, frames * hop - len(power)))
    level = 10 * np.log10(np.mean(padded.reshape(frames, hop), axis=1) + 1e-12)
    out = np.interp(level, ins, outs)
    below = level < ins[0]
    out[below] = outs[0] + (level[below] - ins[0])
    if len(ins) > 1 and ins[-1] > ins[-2]:
        slope = (outs[-1] - outs[-2]) / (ins[-1] - ins[-2])
        above = level > ins[-1]
        out[above] = outs[-1] + (level[above] - ins[-1]) * slope
    gain = np.convolve(out - level, np.ones(4) / 4, "same")
    lin = np.repeat(10 ** (gain / 20), hop)[: len(power)]
    ramp = max(1, hop)
    lin = np.convolve(lin, np.ones(ramp) / ramp, "same")
    return (xs * lin[:, None]).astype(np.float32)


def _dialogue_leveler(x, rate: int, v: dict):
    """Leveler for dialogue (RX-26): each 50 ms of speech brought toward the Target RMS (by up to Max gain either way,
    smoothed over about 200 ms), while breaths (noise-like frames 10 to 45 dB under the speech) and sibilance (frames
    whose energy sits mostly above 4 kHz) are held: they take the gain of the speech around them only when that gain
    lowers them, never when it would raise them, so leveling does not lift the breaths and esses with the quiet words."""
    import numpy as np

    mono = x.astype(np.float64).mean(axis=1)
    hop = max(1, int(rate * 0.05))
    frames = len(mono) // hop
    if frames < 3:
        return x
    blocks = mono[: frames * hop].reshape(frames, hop)
    level = 10 * np.log10(np.mean(blocks**2, axis=1) + 1e-12)
    power = np.abs(np.fft.rfft(blocks * np.hanning(hop), axis=1)) ** 2 + 1e-20
    freqs = np.fft.rfftfreq(hop, 1 / rate)
    flatness = np.exp(np.mean(np.log(power), axis=1)) / np.mean(power, axis=1)
    high = power[:, freqs >= 4000].sum(axis=1) / power.sum(axis=1)
    speech_level = np.percentile(level[level > -70], 90) if np.any(level > -70) else 0.0
    sibilant = high > 0.6
    breath = (~sibilant) & (flatness > 0.35) & (level < speech_level - 10) & (level > speech_level - 45)
    voiced = (~sibilant) & (~breath) & (level > speech_level - 30)
    want = np.clip(v["target"] - level, -v["max_gain"], v["max_gain"])
    idx = np.nonzero(voiced)[0]
    gain = np.interp(np.arange(frames), idx, want[idx]) if idx.size else np.zeros(frames)
    gain = np.convolve(gain, np.ones(5) / 5, "same")
    held = breath | sibilant | (level <= speech_level - 30)
    gain = np.where(held, np.minimum(gain, 0.0), gain)
    lin = np.repeat(10 ** (gain / 20), hop)
    lin = np.concatenate([lin, np.full(len(mono) - len(lin), lin[-1])])
    ramp = max(1, int(rate * 0.01))
    lin = np.convolve(lin, np.ones(ramp) / ramp, "same")
    return (x.astype(np.float64) * lin[:, None]).astype(np.float32)


def _spectral_repair(x, rate: int, v: dict):
    """Spectral repair (RX-42) of a time and frequency region (from, to in the clip's seconds; low, high in Hz):
    Attenuate lowers it 60 dB; Replace and Fill gaps rebuild it, the region's magnitudes interpolated between the
    frames just before and after it and the phases advanced at each bin's own frequency, so a steady tone carries
    through a click or a dropout (Fill gaps is Replace over the whole band, for silence where audio should be). The
    resolution is one FFT size (512, 2048 or 8192), or all three averaged (multi-resolution) for regions holding both
    short events and steady tones."""
    import numpy as np

    mode = int(round(v["mode"]))
    lo, hi = (0.0, rate / 2) if mode == 2 else sorted((v["low"], v["high"]))
    t0, t1 = sorted((v["from"], v["to"]))
    sizes = {0: (512, 2048, 8192), 1: (512,), 2: (2048,), 3: (8192,)}[int(round(v["resolution"]))]

    def at(n: int):
        hop = n // 4

        def fn(spec, f, c):
            out = spec.copy()
            frames = spec.shape[0]
            # frame i covers the input's samples i*hop - n to i*hop (the helper pads n in front): the clean
            # references are the last frame ending before the region and the first starting after it, and every frame
            # between them, all touching the region, is rebuilt (references that overlapped the region carried the
            # click into the repair)
            b = int(np.floor(t0 * rate / hop))
            a = int(np.ceil((t1 * rate + n) / hop))
            band = (f >= lo) & (f <= hi)
            if b < 1 or a > frames - 1 or a - b < 2 or not band.any():
                return out
            if mode == 0:
                out[b + 1 : a][:, band] *= 10 ** (-60 / 20)
                return out
            before, after = np.abs(spec[b, band]), np.abs(spec[a, band])
            # each bin's own phase advance per hop, measured on the two frames before the region (a tone between bins
            # advances at its frequency, not the bin's), as a phase vocoder does
            expected = 2 * np.pi * f[band] * hop / rate
            measured = np.angle(spec[b, band]) - np.angle(spec[b - 1, band]) - expected
            step = expected + (measured + np.pi) % (2 * np.pi) - np.pi
            phase = np.angle(spec[b, band])
            span = a - b
            for k in range(1, span):
                phase = phase + step
                w = k / span
                out[b + k, band] = ((1 - w) * before + w * after) * np.exp(1j * phase)
            return out

        return _stft_map(x, rate, n, fn)

    return (sum(at(n).astype(np.float64) for n in sizes) / len(sizes)).astype(np.float32)


def _azimuth_measured(x, rate: int, v: dict):
    """Azimuth, measured (RX-02): the right channel's delay against the left found by cross-correlation (within
    5 ms) and its level by RMS, then shifted and scaled to match, so a misaligned stereo pair lines up."""
    import numpy as np

    if x.shape[1] != 2:
        raise media.MediaError("azimuth alignment needs a stereo clip")
    left, right = x[:, 0].astype(np.float64), x[:, 1].astype(np.float64)
    size = 1 << int(np.ceil(np.log2(2 * len(left))))
    corr = np.fft.irfft(np.conj(np.fft.rfft(left, size)) * np.fft.rfft(right, size), size)
    reach = int(rate * 0.005)
    lags = np.concatenate([np.arange(0, reach + 1), np.arange(-reach, 0)])
    lag = int(lags[np.argmax(np.concatenate([corr[: reach + 1], corr[-reach:]]))])
    shifted = np.zeros_like(right)
    if lag >= 0:
        shifted[: len(right) - lag] = right[lag:]
    else:
        shifted[-lag:] = right[: len(right) + lag]
    rl, rr = np.sqrt(np.mean(left**2)), np.sqrt(np.mean(shifted**2))
    if rr > 0:
        shifted *= rl / rr
    v["measured"] = lag
    return np.stack([left, shifted], axis=1).astype(np.float32)


def _dc_measured(x, rate: int, v: dict):
    """DC offset, measured (AU-B14): each channel's mean subtracted exactly, so the offset goes and nothing else in
    the signal changes, low frequencies included (a high-pass would take some of them)."""
    import numpy as np

    y = x.astype(np.float64)
    return (y - y.mean(axis=0, keepdims=True)).astype(np.float32)


def _breath_control(x, rate: int, v: dict):
    """Breath control (RX-03): breaths found as noise-like frames (spectral flatness above 0.35) between 10 and 45 dB
    under the phrases' level (their 95th percentile), and lowered by the Reduction amount with 10 ms ramps; the
    phrases and quiet room tone below the window are left as they are."""
    import numpy as np

    mono = x.astype(np.float64).mean(axis=1)
    hop = max(1, int(rate * 0.02))
    frames = len(mono) // hop
    if frames < 3:
        return x
    blocks = mono[: frames * hop].reshape(frames, hop)
    level = 10 * np.log10(np.mean(blocks**2, axis=1) + 1e-12)
    power = np.abs(np.fft.rfft(blocks * np.hanning(hop), axis=1)) ** 2 + 1e-20
    flatness = np.exp(np.mean(np.log(power), axis=1)) / np.mean(power, axis=1)
    phrase = np.percentile(level[level > -70], 95) if np.any(level > -70) else 0.0
    breath = (level < phrase - 10) & (level > phrase - 45) & (flatness > 0.35)
    gain = np.repeat(np.where(breath, 10 ** (-v["reduce"] / 20), 1.0), hop)
    gain = np.concatenate([gain, np.full(len(mono) - len(gain), gain[-1])])
    ramp = max(1, int(rate * 0.01))
    gain = np.convolve(gain, np.ones(ramp) / ramp, "same")
    return (x.astype(np.float64) * gain[:, None]).astype(np.float32)


def _de_hum_adaptive(x, rate: int, v: dict):
    """De-hum, adaptive (RX-10): in each third of a second the hum's fundamental is found within 3 Hz of the mains
    frequency (the harmonics' summed magnitude at each candidate, 0.02 Hz apart), and narrow notches follow it and its
    harmonics, so drifting hum is taken out where fixed notches miss it."""
    import numpy as np

    mains = 60.0 if v["mains"] >= 55 else 50.0
    count = int(round(v["harmonics"]))

    def fn(spec, f, c):
        mag = np.abs(spec)
        df = f[1]
        cands = np.arange(mains - 3, mains + 3.0001, 0.02)
        score = np.zeros((spec.shape[0], len(cands)))
        for k in range(1, count + 1):
            pos = k * cands / df
            lo = np.floor(pos).astype(int)
            frac = pos - lo
            score += mag[:, lo] * (1 - frac) + mag[:, np.minimum(lo + 1, mag.shape[1] - 1)] * frac
        best = cands[np.argmax(score, axis=1)]
        gain = np.ones(spec.shape)
        for k in range(1, count + 1):
            # wide enough for the Hann window's leakage (about two bins either side), still far from any tone a few
            # hertz away; narrower notches (0.8 bin) left the skirts and took only 14 dB
            gain *= 1 - 0.9999 * np.exp(-0.5 * ((f[None, :] - k * best[:, None]) / (1.6 * df)) ** 2)
        return spec * gain

    return _stft_map(x, rate, 16384, fn)


def _de_ess_spectral(x, rate: int, v: dict):
    """De-ess, spectral (RX-09): in each short frame the sibilant band (4 to 10 kHz) is measured, and only those
    frequencies, only in frames where they pass the Threshold, are lowered by the excess up to the Max reduction;
    everything below 4 kHz, and the band whenever it is under the threshold, is untouched."""
    import numpy as np

    n = 1024
    w2 = np.sum((0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)) ** 2)

    def fn(spec, f, c):
        band = (f >= 4000) & (f <= 10000)
        level = 10 * np.log10(2 * np.sum(np.abs(spec[:, band]) ** 2, axis=1) / (n * w2) + 1e-12)
        cut = np.clip(level - v["threshold"], 0, v["reduce"])
        cut = np.convolve(cut, np.ones(3) / 3, "same")
        out = spec.copy()
        out[:, band] *= (10 ** (-cut / 20))[:, None]
        return out

    return _stft_map(x, rate, n, fn)


def _spectral_recovery(x, rate: int, v: dict):
    """Spectral recovery (RX-41): where the band above the cutoff is lost (30 dB under the octave below it), it is
    resynthesised from that octave, its magnitudes moved up an octave's width, lowered 6 dB and by the Amount, with
    fresh phases; below the cutoff nothing changes, and a band that is present is left alone."""
    import numpy as np

    rng = np.random.default_rng(5)

    def fn(spec, f, c):
        cut = v["cutoff"]
        nyq = f[-1]
        src = (f >= cut / 2) & (f < cut)
        dst = (f >= cut) & (f < min(2 * cut, nyq))
        shift = int(np.argmax(f >= cut)) - int(np.argmax(f >= cut / 2))
        out = spec.copy()
        dst_idx = np.nonzero(dst)[0]
        src_idx = dst_idx - shift
        keep = src_idx >= 0
        dst_idx, src_idx = dst_idx[keep], src_idx[keep]
        e_src = np.sum(np.abs(spec[:, src]) ** 2, axis=1) + 1e-20
        e_dst = np.sum(np.abs(spec[:, dst]) ** 2, axis=1)
        lost = e_dst < e_src * 1e-3
        mags = np.abs(spec[:, src_idx]) * 0.5 * (v["amount"] / 100)
        phases = np.exp(2j * np.pi * rng.random(mags.shape))
        fill = mags * phases
        out[np.ix_(lost, dst_idx)] = fill[lost]
        return out

    return _stft_map(x, rate, 2048, fn)


def _chain_array(x, rate: int, chain: str, label: str):
    """An ffmpeg filter chain run over an array (32-bit float WAV in and out), the result exactly the input's length."""
    import os
    import tempfile as _tf

    import numpy as np

    from .audacity import _wav_bytes

    with _tf.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.wav"), os.path.join(tmp, "out.wav")
        with open(src, "wb") as f:
            f.write(_wav_bytes([x[:, c] for c in range(x.shape[1])], rate))
        done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", src, "-af", chain, "-c:a", "pcm_f32le", dst], capture_output=True, timeout=900)
        if done.returncode != 0:
            raise media.MediaError(f"{label} failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        raw = np.frombuffer(subprocess.run([media._tool("ffmpeg"), "-v", "error", "-i", dst, "-f", "f32le", "-"], capture_output=True).stdout, dtype="<f4")
    y = raw.reshape(-1, x.shape[1])[: len(x)]
    if len(y) < len(x):
        y = np.concatenate([y, np.zeros((len(x) - len(y), x.shape[1]), dtype=np.float32)])
    return y.astype(np.float32)


def _low_burst_gate(x, rate: int, band: float, rise_db: float, hold_s: float):
    """Where the low band (below `band` Hz) bursts: its energy in 10 ms frames against its running one-second median,
    open where it rises `rise_db` above it (and above -60 dBFS), held `hold_s` either side, with 10 ms ramps; a gain
    from 0 to 1 per sample. The band is taken through the FFT, so no filter library is needed."""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view

    mono = x.astype(np.float64).mean(axis=1)
    f = np.fft.rfftfreq(len(mono), 1 / rate)
    low = np.fft.irfft(np.fft.rfft(mono) * (f < band), n=len(mono))
    hop = max(1, int(rate * 0.01))
    frames = len(low) // hop
    if frames < 3:
        return np.zeros(len(mono))
    energy = 10 * np.log10(np.mean(low[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    half = 50
    median = np.median(sliding_window_view(np.pad(energy, half, mode="edge"), 2 * half + 1), axis=1)[:frames]
    hot = (energy > median + rise_db) & (energy > -60)
    hold = max(0, int(round(hold_s / 0.01)))
    open_ = np.convolve(hot.astype(np.float64), np.ones(2 * hold + 1), "same") > 0
    gate = np.repeat(open_.astype(np.float64), hop)
    gate = np.concatenate([gate, np.full(len(mono) - len(gate), gate[-1] if len(gate) else 0.0)])
    return np.clip(np.convolve(gate, np.ones(hop) / hop, "same"), 0.0, 1.0)


def _de_plosive(x, rate: int, v: dict):
    """De-plosive (RX-11): its low cut, over the whole clip as before, or with Only on bursts where the band below
    the cutoff bursts 15 dB over its running level (held 30 ms), the clean audio around them untouched."""
    wet = _chain_array(x, rate, PARAMS["de-plosive"][1](v), "De-plosive")
    if v.get("detect", 0) < 0.5:
        return wet
    gate = _low_burst_gate(x, rate, max(150.0, v["cutoff"] * 1.5), 15.0, 0.03)[:, None]
    return (x + gate * (wet - x)).astype("float32")


def _de_wind(x, rate: int, v: dict):
    """De-wind (RX-14): its low cut and noise floor, over the whole clip as before, or with Only on gusts where the
    band below the cutoff rises 10 dB over its running level (held 150 ms), the audio between gusts untouched."""
    wet = _chain_array(x, rate, PARAMS["de-wind"][1](v), "De-wind")
    if v.get("detect", 0) < 0.5:
        return wet
    gate = _low_burst_gate(x, rate, max(200.0, v["cutoff"] * 1.5), 10.0, 0.15)[:, None]
    return (x + gate * (wet - x)).astype("float32")


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


NUMPY_EFFECTS = {"dereverb": _dereverb, "spot-heal": _spot_heal, "wow-flutter": _wow_flutter, "pitch-correct": _pitch_correct, "dialogue-contour": _dialogue_contour, "peak-normalize": _peak_normalize, "paulstretch": _paulstretch, "downmix-mono": _downmix_mono, "phase-rotate": _phase_rotate, "de-plosive": _de_plosive, "de-wind": _de_wind,
                 "azimuth-measured": _azimuth_measured, "dc-measured": _dc_measured, "breath-control": _breath_control,
                 "de-hum-adaptive": _de_hum_adaptive, "de-ess-spectral": _de_ess_spectral, "spectral-recovery": _spectral_recovery,
                 "spectral-repair": _spectral_repair, "dialogue-leveler": _dialogue_leveler, "dynamics-curve": _dynamics_curve}


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
