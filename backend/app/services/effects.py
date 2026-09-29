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

#: Menu groups for formwav's Inspector; every chain appears exactly once.
GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("Clean up", [("voice-clean", "Enhance speech"), ("denoise", "Denoise"), ("deep-denoise", "Deep denoise"), ("hiss-cut", "Hiss cut"), ("hum-remover", "Hum remover"), ("rumble-cut", "Rumble cut"), ("noise-gate", "Noise gate"), ("de-ess", "De-ess")]),
    ("Dynamics", [("compress", "Compress"), ("normalize", "Normalize to -16 LUFS"), ("level-rider", "Level rider"), ("peak-limiter", "Peak limiter")]),
    ("Tone", [("bass", "Bass boost"), ("treble", "Treble boost"), ("warm-lows", "Warm lows"), ("presence-lift", "Presence lift"), ("mid-scoop", "Mid scoop"), ("crisp-detail", "Crisp detail")]),
    ("Space", [("room", "Room"), ("hall", "Hall"), ("cathedral", "Cathedral"), ("plate", "Plate"), ("echo", "Echo"), ("slapback", "Slapback"), ("long-tail", "Long tail"), ("tunnel", "Tunnel"), ("small-booth", "Small booth"), ("far-away", "Far away"), ("wide-stage", "Wide stage"), ("stereo-bloom", "Stereo bloom")]),
    ("Character", [("radio", "Radio"), ("telephone", "Telephone"), ("bullhorn", "Bullhorn"), ("two-way-radio", "Two-way radio"), ("lofi-band", "Lo-fi band"), ("tape-warmth", "Tape warmth"), ("bit-crush", "Bit crush"), ("distortion", "Distortion"), ("robot", "Robot")]),
    ("Modulation", [("tremolo", "Tremolo"), ("vibrato", "Vibrato"), ("double-voice", "Double voice"), ("jet-flange", "Jet flange"), ("swirl-phase", "Swirl phase")]),
    ("Pitch", [("pitch_up", "Pitch up"), ("pitch_down", "Pitch down"), ("octave-up", "Octave up"), ("octave-down", "Octave down")]),
]
LABELS = {key: label for _, items in GROUPS for key, label in items}
#: Effects that make a stereo image, so their output is stereo even from mono.
STEREO = {"wide-stage", "stereo-bloom"}


def catalogue() -> list[dict]:
    return [{"group": group, "effects": [{"id": key, "label": label} for key, label in items]} for group, items in GROUPS]


def apply(media_id: str, name: str) -> dict:
    """Renders `name` over a stored media file into new media at the same rate; the source is kept."""
    chain = AUDIO_CHAINS.get(name)
    if chain is None:
        raise media.MediaError(f"no effect named {name}")
    info = media.media_info(media_id)
    rate, channels = int(info["sampleRate"]), int(info["channels"])
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
    return media.import_wav(f"{stem} ({LABELS.get(name, name)}).wav", data)
