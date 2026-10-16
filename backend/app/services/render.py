import math
import struct

from ..core.paths import media_dir
from . import media


class RenderError(ValueError):
    pass


#: Track effect kinds, as the core's stage codes (formwav-dsp fx.rs).
FX_KINDS = {"highpass": 1, "lowpass": 2, "peak": 3, "lowshelf": 4, "highshelf": 5, "compressor": 6, "denoise": 7, "reverb": 8, "echo": 9, "chorus": 10, "limiter": 11, "tremolo": 12, "gate": 13, "phaser": 14, "flanger": 15, "voice": 16, "dehum": 17, "declick": 18, "dereverb": 19, "processor": 20}
#: The stages that must see a track's sum, so a track carrying one plays through a bus of its own: every kind but the
#: five filters, which are linear and run per clip.
ON_THE_SUM = (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)
#: A track with a 5.1 or ambisonic place goes to a bus of its own only for these, the others staying per clip where its
#: place still reaches them (a track on its own bus plays on L and R in 5.1 until PLAN_v13 S16).
PLACED_ON_THE_SUM = (6, 8, 16, 18, 19, 20)
#: The session's pan law for a mono source (the core's codes; absent is the balance every session had).
PAN_LAWS = {"-3": 1, "-4.5": 2, "-6": 3}


def _number(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def processor_spec(f: dict) -> str:
    """A processor entry as the core's spec, "id;param=value;...", numbers written as the browser writes them."""
    values = f.get("values") if isinstance(f.get("values"), dict) else {}
    parts = [str(f.get("id", ""))]
    parts += [f"{k}={_number(v)}" for k, v in values.items() if isinstance(k, str) and not set(k) & {";", "="} and isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)]
    return ";".join(parts)


def native_chains(chains: list[tuple]) -> tuple[list[tuple], list[str]]:
    """Chains as the core takes them: each processor stage's spec moved to a list the stage names by its place."""
    processors: list[str] = []
    out = []
    for ch in chains:
        if ch[2] == 20:
            processors.append(ch[3])
            ch = (*ch[:3], float(len(processors) - 1), *ch[4:])
        out.append(ch)
    return out, processors


def _stage(f: dict) -> tuple | None:
    """An effect entry as a core stage (kind, a, b, c, d, e); None when bypassed or unknown. Filters carry frequency,
    gain and Q; the compressor carries threshold, ratio, attack and release (ms) and makeup gain."""
    kind = FX_KINDS.get(f.get("kind")) if isinstance(f, dict) else None
    if not kind or f.get("bypass"):
        return None
    if kind == 20:
        return (20, processor_spec(f), 0.0, 0.0, 0.0, 0.0)
    if kind == 17:  # L6: de-hum, a = the hum in Hz, b = harmonics, c = Q
        return (17, float(f.get("baseHz", 60)), float(f.get("harmonics", 8)), float(f.get("q", 30)), 0.0, 0.0)
    if kind == 19:  # L6: de-reverb, a = reverb time T60 in s, b = the most taken down in dB
        return (19, float(f.get("t60", 0.8)), float(f.get("reductionDb", 6)), 0.0, 0.0, 0.0)
    if kind == 18:  # L6: de-click, a = threshold (times the residual's level), b = the longest click in ms
        return (18, float(f.get("sensitivity", 8)), float(f.get("maxMs", 1)), 0.0, 0.0, 0.0)
    if kind == 9:
        return (9, float(f.get("delayMs", 300)), float(f.get("feedback", 0.35)), float(f.get("mix", 0.4)), 0.0, 0.0)
    if kind == 10:
        return (10, float(f.get("rateHz", 0.8)), float(f.get("depthMs", 3)), float(f.get("mix", 0.5)), 0.0, 0.0)
    if kind == 11:
        return (11, float(f.get("ceilingDb", -1)), float(f.get("releaseMs", 80)), 0.0, 0.0, 0.0)
    if kind == 12:
        return (12, float(f.get("rateHz", 4)), float(f.get("depth", 0.5)), float(f.get("spread", 0)), 0.0, 0.0)
    if kind == 13:
        return (13, float(f.get("thresholdDb", -40)), float(f.get("releaseMs", 100)), float(f.get("rangeDb", -60)), 0.0, 0.0)
    if kind == 14:
        return (14, float(f.get("rateHz", 0.5)), float(f.get("depth", 1)), float(f.get("feedback", 0.5)), 0.0, 0.0)
    if kind == 15:
        return (15, float(f.get("rateHz", 0.25)), float(f.get("depthMs", 3)), float(f.get("feedback", 0.5)), 0.0, 0.0)
    if kind == 16:  # RX-16: the live dialogue isolate, its strength (0 to 1)
        return (16, float(f.get("strength", 1)), 0.0, 0.0, 0.0, 0.0)
    if kind == 8:  # PT-22: the realtime reverb, room size, damping, mix and width (each 0 to 1)
        return (8, float(f.get("room", 0.6)), float(f.get("damping", 0.5)), float(f.get("mix", 0.25)), float(f.get("width", 1.0)), 0.0)
    if kind == 7:  # RX-24, RX-40, RX-49: the denoiser, its reduction and sensitivity where filters carry frequency and gain
        return (7, float(f.get("reductionDb", 12)), float(f.get("sensitivityDb", 3)), 0.0, 0.0, 0.0)
    if kind == 6:
        return (6, float(f.get("thresholdDb", -20)), float(f.get("ratio", 4)), float(f.get("attackMs", 10)), float(f.get("releaseMs", 150)), float(f.get("makeupDb", 0)))
    return (kind, float(f.get("freq") or 1000), float(f.get("gainDb") or 0), float(f.get("q") or 0.707), 0.0, 0.0)


def _env_gain(points: list[tuple[int, float]], t: float) -> float:
    """A dB envelope's value at t, linear in gain between points and held outside them, as the core interpolates."""
    if t <= points[0][0]:
        return 10 ** (points[0][1] / 20)
    for (t0, d0), (t1, d1) in zip(points, points[1:]):
        if t <= t1:
            g0, g1 = 10 ** (d0 / 20), 10 ** (d1 / 20)
            return g1 if t1 == t0 else g0 + (g1 - g0) * (t - t0) / (t1 - t0)
    return 10 ** (points[-1][1] / 20)


def _clip_env_gain(points: list[tuple[int, float]], t: float) -> float:
    """AU-34: a clip envelope's gain at t, interpolated in dB between points (Audacity 2's clip envelopes are exponential:
    halfway between gains of 1 and 0.25 its own render measures 0.5004) and held outside them."""
    if t <= points[0][0]:
        return 10 ** (points[0][1] / 20)
    for (t0, d0), (t1, d1) in zip(points, points[1:]):
        if t <= t1:
            return 10 ** ((d1 if t1 == t0 else d0 + (d1 - d0) * (t - t0) / (t1 - t0)) / 20)
    return 10 ** (points[-1][1] / 20)


def _clip_envelope(own: list[tuple[int, float]], track: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """A clip's envelope multiplied with the track's volume automation. The core interpolates in gain, so the clip's dB
    curve is sampled in steps of at most 0.1 dB, and with automation the product also at both sets of breakpoints and
    eight times inside each span; points before the session start fold into one at 0. The browser planner does the
    same, rounding halves up as JavaScript's Math.round does (floor(x + 0.5), not Python's round)."""
    times = {t for t, _ in own} | {t for t, _ in track}
    ordered = sorted(times)
    for a, b in zip(ordered, ordered[1:]):
        rise = abs(20 * math.log10(_clip_env_gain(own, b) / _clip_env_gain(own, a)))
        steps = max(8 if track else 1, math.ceil(rise / 0.1))
        times.update(math.floor(a + (b - a) * k / steps + 0.5) for k in range(1, steps))
    at = sorted({t for t in times if t >= 0} | ({0} if ordered[0] < 0 else set()))
    return [(t, 20 * math.log10(max(_clip_env_gain(own, t) * (_env_gain(track, t) if track else 1.0), 1e-6))) for t in at]


def track_volume(track: dict, vca: dict | None) -> list[tuple[int, float]] | None:
    """S9, as the browser's trackVolume: the track's fader or volume lane times its VCA's fader or lane times its trim
    lane, -300 dB where its mute lane is on; the volume lane alone (or nothing) when there is no VCA, trim or mute lane.
    Sampled at every breakpoint and eight times inside each span, a mute step two points at its time."""
    lanes = {} if track.get("autoOff") else (track.get("automation") or {})

    def pts(lane):
        return [(int(p["time"]), float(p["value"])) for p in lane] if lane else None

    volume, vca_lane, trim = pts(lanes.get("volume")), pts((vca or {}).get("automation")), pts(lanes.get("trim"))
    mute = lanes.get("mute") or None
    if not vca_lane and not trim and not mute:
        return volume
    base = sorted({t for lane in (volume, vca_lane, trim) if lane for t, _ in lane})
    times = set(base)
    for a, b in zip(base, base[1:]):
        times.update(math.floor(a + (b - a) * k / 8 + 0.5) for k in range(1, 8))
    if not times:
        times.add(0)
    steps: dict[int, tuple[bool, bool]] = {}
    for prev, cur in zip(mute or [], (mute or [])[1:]):
        if cur["value"] != prev["value"]:
            steps[int(cur["time"])] = (prev["value"] >= 0.5, cur["value"] >= 0.5)
    times.update(steps)

    def muted(t: int) -> bool:
        if not mute:
            return False
        on = mute[0]["value"] >= 0.5
        for p in mute:
            if p["time"] <= t:
                on = p["value"] >= 0.5
        return on

    track_gain = 10 ** (float(track.get("gainDb", 0)) / 20)
    vca_gain = 10 ** (float((vca or {}).get("gainDb", 0)) / 20)

    def gain(t: int) -> float:
        return (_env_gain(volume, t) if volume else track_gain) * (_env_gain(vca_lane, t) if vca_lane else vca_gain) * (_env_gain(trim, t) if trim else 1)

    def db(g: float, off: bool) -> float:
        return -300.0 if off else 20 * math.log10(max(g, 1e-15))

    out: list[tuple[int, float]] = []
    for t in sorted(times):
        g = gain(t)
        if t in steps:
            out += [(t, db(g, steps[t][0])), (t, db(g, steps[t][1]))]
        else:
            out.append((t, db(g, muted(t))))
    return out


def bus_order(doc: dict) -> list[dict]:
    """S10, as the browser plans it: the buses that sound (neither muted nor playing into a muted bus), each after
    every bus that plays into it (the longest way to the master first, the document's order kept among equals)."""
    buses = [b for b in doc.get("buses") or [] if isinstance(b, dict) and isinstance(b.get("id"), str)]
    by = {b["id"]: b for b in buses}

    def path(b: dict) -> list[dict]:
        out, at = [], b
        while at is not None and all(at["id"] != x["id"] for x in out):
            out.append(at)
            at = by.get(at.get("out"))
        return out

    live = [b for b in buses if not any(x.get("mute") for x in path(b))]
    return sorted(live, key=lambda b: -len(path(b)))


def bus_outs(doc: dict) -> list[tuple[int, int]]:
    """Each routed bus's core id and the core id of the bus it plays into, ids as plan gives them (1, 2, ...)."""
    order = bus_order(doc)
    ids = {b["id"]: i + 1 for i, b in enumerate(order)}
    return [(ids[b["id"]], ids[b["out"]]) for b in order if b.get("out") in ids]


def master_lane(doc: dict) -> tuple[float, list[tuple[int, float]] | None]:
    """S9: the master fader in dB and its volume lane, which replaces it (the fader then 0 dB) while present."""
    pts = doc.get("masterAutomation") or []
    if pts:
        return 0.0, [(int(p["time"]), float(p["value"])) for p in pts]
    return float(doc.get("masterGainDb") or 0), None


FADE_SHAPES = {"linear": 0, "equal-power": 1, "s-curve": 2, "exponential": 3, "logarithmic": 4}


def _fade_code(clip: dict) -> int:
    """The core's fade code for a clip's two edges, as the browser's fadeCode: the fade-in's shape, and the fade-out's
    (plus one) in the high four bits when it has one of its own that differs (render.rs fade_shapes)."""
    a = FADE_SHAPES.get(clip.get("fadeShape") or "linear", 0)
    b = FADE_SHAPES.get(clip.get("fadeOutShape") or "", a)
    return a if b == a else a + 16 * (b + 1)


def plan(doc: object) -> tuple[int, dict[str, int], list[tuple], int, int]:
    if not isinstance(doc, dict) or not isinstance(doc.get("tracks"), list) or not isinstance(doc.get("media"), dict):
        raise RenderError("not a session document")
    rate = doc.get("sampleRate")
    if not isinstance(rate, int) or rate <= 0:
        raise RenderError("the session has no valid sample rate")
    tracks = [t for t in doc["tracks"] if isinstance(t, dict)]
    soloed = any(t.get("solo") and not t.get("inactive") for t in tracks)
    buses: dict[str, tuple[int, float, float]] = {}
    muted_buses: set[str] = set()
    bus_chains: list[tuple] = []
    live = bus_order(doc)
    muted_buses.update(b["id"] for b in doc.get("buses") or [] if isinstance(b, dict) and isinstance(b.get("id"), str) and b not in live)
    for bus in live:
        buses[bus["id"]] = (len(buses) + 1, math.pow(10, float(bus.get("gainDb", 0)) / 20), float(bus.get("pan") or 0))
        # A bus's own effects (Pro Tools' routing folders process the summed stem) run on its sum, in order.
        bus_chains.extend((1, len(buses) - 1, *s) for s in (_stage(f) for f in (bus.get("fx") or [])) if s)
    sources: dict[str, int] = {}
    clips: list[tuple] = []
    owners: list[int] = []  # PT-38, AA-11: each clip's track (its index in tracks), for the 5.1 bus's placements
    envelopes: list[tuple] = []
    fx: list[tuple] = []
    fx_auto: list[tuple] = []
    comps: list[tuple] = []  # PT-33: (clip index, filters ahead of it, threshold dB, ratio, attack ms, release ms, makeup dB)
    bus_auto: list[tuple] = []  # (bus index, stage, param, envelope): a track's filter automation on its own bus
    chains: list[tuple] = list(bus_chains)
    end = 0
    skipped = 0
    vcas = {v["id"]: v for v in (doc.get("vcas") or []) if isinstance(v, dict) and isinstance(v.get("id"), str)}
    for track in tracks:
        # A VCA (Pro Tools' VCA masters) scales and mutes its members without carrying their audio.
        vca = vcas.get(track.get("vcaId"))
        if track.get("inactive") or track.get("mute") or (vca and vca.get("mute")) or (soloed and not track.get("solo") and not track.get("soloSafe")) or track.get("busId") in muted_buses:
            continue
        bus_index = buses[track["busId"]][0] if track.get("busId") in buses else 0
        # automation Off plays the static fader and pan and the filters as set, the lanes kept
        off = bool(track.get("autoOff"))
        automation = {} if off else (track.get("automation") or {})
        # input trim and polarity come before the inserts: in the clip's gain, which reaches a track's own bus first
        trim_db = float(track.get("trimDb") or 0)
        polarity = -1.0 if track.get("invert") else 1.0
        gain_env = pan_env = 0
        volume_pts = track_volume(track, vca)
        folded = bool(vca and vca.get("automation")) or bool(automation.get("trim") or automation.get("mute"))
        if volume_pts:
            envelopes.append((volume_pts, True))
            gain_env = len(envelopes)
        if automation.get("pan"):
            envelopes.append(([(int(p["time"]), float(p["value"])) for p in automation["pan"]], False))
            pan_env = len(envelopes)
        track_db = (0.0 if gain_env else float(track.get("gainDb", 0))) + (float(vca.get("gainDb", 0)) if vca and not folded else 0.0)
        track_pan = 0.0 if pan_env else float(track.get("pan") or 0)

        stages = [s for s in (_stage(f) for f in (track.get("fx") or [])) if s]
        on_sum = PLACED_ON_THE_SUM if isinstance(track.get("surround"), dict) else ON_THE_SUM
        if bus_index == 0 and any(s[0] in on_sum for s in stages):  # a compressor, a reverb's tail (PT-22), the stages that delay their signal (RX-16: buses are where the core cancels latency), a processor
            # A compressor is nonlinear, so it must see the track's sum: the track plays through a bus of its own
            # (unity gain, centre) whose chain is the track's whole chain, in order.
            buses[f"__track:{track.get('id')}"] = (len(buses) + 1, 1.0, 0.0)
            bus_index = len(buses)
            chains.extend((1, bus_index - 1, *s) for s in stages)
            # the filters' automation (PT-19) goes with them onto the bus, numbered by the bus chain's stages
            live = [f for f in (track.get("fx") or []) if _stage(f)]
            for si, f in enumerate([] if off else live):
                if FX_KINDS.get(f.get("kind")) not in (1, 2, 3, 4, 5):
                    continue
                for param, key in enumerate(("freq", "gain", "q")):
                    pts = (f.get("automation") or {}).get(key)
                    if pts:
                        envelopes.append(([(int(p["time"]), float(p["value"])) for p in pts], False))
                        bus_auto.append((bus_index - 1, si, param, len(envelopes)))
            stages = []
        else:
            # Filters are linear and run per clip; a compressor, a reverb or a dialogue isolate on a track routed to a
            # user bus is not placed yet, as the browser's flatFx leaves them out.
            stages = [s[:4] for s in stages if s[0] not in (6, 8, 16, 20)]
        # The filters' parameter automation (PT-19), numbered by the clip stages above (bypassed, unknown, compressor,
        # reverb and dialogue isolate entries skipped, as the browser's flatFxAuto does); each becomes one envelope
        # (natural units) for the track.
        auto_envs: list[tuple[int, int, int]] = []
        if stages and not off:
            filters = [f for f in (track.get("fx") or []) if (_stage(f) or (6,))[0] not in (6, 8, 16, 20)]
            for si, f in enumerate(filters):
                for param, key in enumerate(("freq", "gain", "q")):
                    pts = (f.get("automation") or {}).get(key)
                    if pts:
                        envelopes.append(([(int(p["time"]), float(p["value"])) for p in pts], False))
                        auto_envs.append((si, param, len(envelopes)))
        for clip in track.get("clips", []):
            if clip.get("mute"):
                continue
            if clip.get("gainBypass"):
                clip = {**clip, "gainDb": 0, "envelope": []}
            # A pitched clip plays its derived render (non-destructive pitch; same length as the original).
            play_id = clip.get("pitchMediaId") if clip.get("pitchMediaId") in doc["media"] else clip.get("mediaId")
            info = doc["media"].get(play_id)
            if not isinstance(info, dict):
                continue
            if info.get("sampleRate") != rate:
                skipped += 1
                continue
            source = sources.setdefault(play_id, len(sources) + 1)
            gain = polarity * math.pow(10, (track_db + trim_db + float(clip.get("gainDb", 0))) / 20)
            start, length = int(clip["start"]), int(clip["length"])
            fade_shape = _fade_code(clip)
            clip_env = gain_env
            main_pts = volume_pts or []
            own_line: list[tuple[int, float]] = []
            if clip.get("envelope"):
                own = [(start + int(p["at"]) - int(clip.get("sourceIn", 0)), float(p["db"])) for p in clip["envelope"]]
                own_line = own
                main_pts = _clip_envelope(own, volume_pts or [])
                envelopes.append((main_pts, True))
                clip_env = len(envelopes)
            clips.append((source, start, int(clip.get("sourceIn", 0)), length, gain, track_pan, int(clip.get("fadeIn") or 0), int(clip.get("fadeOut") or 0), fade_shape, bus_index, clip_env, pan_env))
            owners.append(tracks.index(track))
            # PT-33, as the player's clipChain: the clip's own filters, then its own compressor (its threshold lowered by
            # the clip gain, which the core applies after the chain), then the track's filters, whose automation moves
            # past the clip's stages
            own = [s for s in (_stage(f) for f in (clip.get("fx") or [])) if s]
            own_filters = [s[:4] for s in own if s[0] not in (6, 8, 16, 20)]
            own_comp = next((s for s in own if s[0] == 6), None)
            ahead = len(own_filters) + (1 if own_comp else 0)
            chain = own_filters + stages
            comp = (len(own_filters), own_comp[1] - float(clip.get("gainDb") or 0), *own_comp[2:6]) if own_comp else None

            def add_chain(index: int) -> None:
                fx.extend((index, *stage) for stage in chain)
                fx_auto.extend((index, si + ahead, param, env) for si, param, env in auto_envs)
                if comp:
                    comps.append((index, *comp))

            add_chain(len(clips) - 1)
            # PT-18, post-fader sends (as the player plans them): the clip again into the send's bus at the send level,
            # with its own copy of the inserts and their automation
            main = clips[-1]
            for send in track.get("sends") or []:
                if send.get("busId") not in buses or send.get("busId") in muted_buses or send.get("mute"):
                    continue
                # S10: a pre-fader send takes the clip before the track's fader, volume lane and VCA (after trim,
                # polarity and the clip's own gain and line); a send's own pan replaces the track's
                pre = bool(send.get("pre"))
                base_gain = polarity * math.pow(10, (trim_db + float(clip.get("gainDb", 0))) / 20) if pre else main[4]
                base_pts = (_clip_envelope(own_line, []) if own_line else []) if pre else main_pts
                lane = [] if off else [(int(p["time"]), float(p["value"])) for p in (send.get("automation") or [])]
                level = 1.0 if lane else 10 ** (float(send.get("gainDb", 0.0)) / 20)
                send_env = main[10]
                if pre:
                    send_env = 0
                    if base_pts:
                        envelopes.append((base_pts, True))
                        send_env = len(envelopes)
                if lane:
                    envelopes.append((_clip_envelope(lane, base_pts), True))
                    send_env = len(envelopes)
                has_pan = isinstance(send.get("pan"), (int, float))
                send_pan = float(send["pan"]) if has_pan else main[5]
                clips.append((*main[:4], base_gain * level, send_pan, *main[6:9], buses[send["busId"]][0], send_env, 0 if has_pan else main[11]))
                owners.append(tracks.index(track))
                add_chain(len(clips) - 1)
            end = max(end, start + length)
    return rate, sources, clips, end, skipped, list(buses.values()), envelopes, fx, chains, fx_auto, comps, owners, bus_auto


#: Sample data past this many bytes cannot be sized in a RIFF header's 32 bits, so the file is written as RF64.
RF64_ABOVE = 0xFFFFFFFF - 36


def wav_float32_stereo(interleaved: bytes, rate: int, channels: int = 2) -> bytes:
    data_bytes = len(interleaved)
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 3, channels, rate, rate * 4 * channels, 4 * channels, 32)
    if data_bytes > RF64_ABOVE:
        # EBU Tech 3306: both sizes read 0xFFFFFFFF and a ds64 chunk holds them, with the frame count, in 64 bits
        ds64 = b"ds64" + struct.pack("<IQQQI", 28, 4 + 36 + len(fmt) + 8 + data_bytes, data_bytes, data_bytes // (4 * channels), 0)
        return b"RF64" + struct.pack("<I", 0xFFFFFFFF) + b"WAVE" + ds64 + fmt + b"data" + struct.pack("<I", 0xFFFFFFFF) + interleaved
    header = b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
    header += fmt
    header += b"data" + struct.pack("<I", data_bytes)
    return header + interleaved


def dbfs(peak: float) -> str:
    return f"{20 * math.log10(peak):.2f}" if peak > 0 else "-inf"


def render(doc: object, start: int = 0, stop: int | None = None) -> dict:
    """The session's stereo mix, or the frames from `start` to `stop` of it: a stop past the last clip renders on into
    the buses' tails, then silence."""
    native = media._require_core()
    rate, sources, clips, end, skipped, buses, envelopes, fx, chains, fx_auto, comps, owners, bus_auto = plan(doc)
    if start < 0 or (stop is not None and stop <= start):
        raise RenderError("the range must start at 0 or later and end after it starts")
    length = max(1, end) if stop is None or len(doc.get("timeTrack") or []) >= 2 else max(1, end, int(stop))
    loaded = []
    for media_id, source in sources.items():
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        loaded.append((source, path.read_bytes()))
    chains = chains + [(2, 0, *s) for s in (_stage(f) for f in (doc.get("masterFx") or [])) if s]
    # PT-38, AA-11: a session hearing its 5.1 as a fold-down plays the core's six-channel bus folded to stereo, here as
    # in playback, so the stereo mix and the 5.1 export's fold-down are the same computation
    from .surround import places_for

    # PT-42: in the session's format, the 5.1 bus or first-order ambisonics (folded through two cardioids)
    spatial = 1 if isinstance(doc, dict) and doc.get("spatialFormat") == "foa" else 0
    places = places_for(doc, owners, spatial) if isinstance(doc, dict) and doc.get("surroundFold") else []
    chains, processors = native_chains(chains)
    master_db, master_pts = master_lane(doc)
    if master_pts:
        envelopes.append((master_pts, True))
    interleaved, peak_left, peak_right = native.render(loaded, clips, length, buses, envelopes, master_db, float(rate), fx, [], chains, fx_auto, comps, places, bool(places), spatial, processors, bus_auto, PAN_LAWS.get(doc.get("panLaw"), 0), len(envelopes) if master_pts else 0, bus_outs(doc))
    frames = length
    curve = [(float(p.get("at", 0)), float(p.get("speed", 1))) for p in (doc.get("timeTrack") or [])]
    if len(curve) >= 2:
        # AU-36: the time track in exports, as playback plays it: the session read at speed(position) samples per output
        # sample (linear, or a steady ratio with timeTrackLog, held outside the points), pitch following; output time to
        # position p is the integral of 1 / speed, inverted by interpolation
        import numpy as np

        # the core returns the mix as interleaved float32 bytes
        mix = np.frombuffer(bytes(interleaved), dtype="<f4").astype(np.float64).reshape(-1, 2)
        pos = np.arange(mix.shape[0], dtype=np.float64)
        at = np.array([a for a, _ in curve])
        sp = np.clip(np.array([s for _, s in curve]), 0.25, 4.0)
        speed = np.exp(np.interp(pos, at, np.log(sp))) if doc.get("timeTrackLog") else np.interp(pos, at, sp)
        out_time = np.concatenate([[0.0], np.cumsum(1.0 / speed)])[:-1]
        n_out = int(out_time[-1]) + 1
        src = np.interp(np.arange(n_out, dtype=np.float64), out_time, pos)
        warped = np.stack([np.interp(src, pos, mix[:, c]) for c in range(2)], axis=1).astype(np.float32)
        interleaved = warped.reshape(-1).astype("<f4").tobytes()
        peak_left, peak_right = float(np.abs(warped[:, 0]).max()), float(np.abs(warped[:, 1]).max())
        frames = n_out
    if start or stop is not None:
        import numpy as np

        mix = np.frombuffer(bytes(interleaved), dtype="<f4").reshape(-1, 2)
        a = min(int(start), len(mix))
        b = len(mix) if stop is None else int(stop)
        if b <= a:
            raise RenderError("the range starts after the session ends")
        part = np.zeros((b - a, 2), dtype=np.float32)
        part[: min(b, len(mix)) - a] = mix[a : min(b, len(mix))]
        interleaved = part.reshape(-1).tobytes()
        peak_left, peak_right = float(np.abs(part[:, 0]).max()), float(np.abs(part[:, 1]).max())
        frames = b - a
    loudness = native.loudness(interleaved, 2, rate)
    return {
        "wav": wav_float32_stereo(interleaved, rate),
        "frames": frames,
        "peakLeft": dbfs(peak_left),
        "peakRight": dbfs(peak_right),
        "loudness": f"{loudness:.2f}" if loudness is not None else "-inf",
        "skipped": skipped,
    }
