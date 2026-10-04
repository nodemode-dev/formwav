import math
import struct

from ..core.paths import media_dir
from . import media


class RenderError(ValueError):
    pass


#: Track effect kinds, as the core's stage codes (formwav-dsp fx.rs).
FX_KINDS = {"highpass": 1, "lowpass": 2, "peak": 3, "lowshelf": 4, "highshelf": 5, "compressor": 6, "denoise": 7}


def _stage(f: dict) -> tuple | None:
    """An effect entry as a core stage (kind, a, b, c, d, e); None when bypassed or unknown. Filters carry frequency,
    gain and Q; the compressor carries threshold, ratio, attack and release (ms) and makeup gain."""
    kind = FX_KINDS.get(f.get("kind")) if isinstance(f, dict) else None
    if not kind or f.get("bypass"):
        return None
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


def _clip_envelope(own: list[tuple[int, float]], track: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """A clip's envelope multiplied with the track's volume automation, sampled at both sets of breakpoints and eight
    times inside each span; points before the session start fold into one at 0 (the browser planner does the same)."""
    times = {t for t, _ in own} | {t for t, _ in track}
    ordered = sorted(times)
    if track:
        for a, b in zip(ordered, ordered[1:]):
            times.update(round(a + (b - a) * k / 8) for k in range(1, 8))
    at = sorted({t for t in times if t >= 0} | ({0} if ordered[0] < 0 else set()))
    return [(t, 20 * math.log10(max(_env_gain(own, t) * (_env_gain(track, t) if track else 1.0), 1e-6))) for t in at]


def plan(doc: object) -> tuple[int, dict[str, int], list[tuple], int, int]:
    if not isinstance(doc, dict) or not isinstance(doc.get("tracks"), list) or not isinstance(doc.get("media"), dict):
        raise RenderError("not a session document")
    rate = doc.get("sampleRate")
    if not isinstance(rate, int) or rate <= 0:
        raise RenderError("the session has no valid sample rate")
    tracks = [t for t in doc["tracks"] if isinstance(t, dict)]
    soloed = any(t.get("solo") for t in tracks)
    buses: dict[str, tuple[int, float, float]] = {}
    muted_buses: set[str] = set()
    bus_chains: list[tuple] = []
    for bus in doc.get("buses") or []:
        if not isinstance(bus, dict) or not isinstance(bus.get("id"), str):
            continue
        if bus.get("mute"):
            muted_buses.add(bus["id"])
            continue
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
    chains: list[tuple] = list(bus_chains)
    end = 0
    skipped = 0
    vcas = {v["id"]: v for v in (doc.get("vcas") or []) if isinstance(v, dict) and isinstance(v.get("id"), str)}
    for track in tracks:
        # A VCA (Pro Tools' VCA masters) scales and mutes its members without carrying their audio.
        vca = vcas.get(track.get("vcaId"))
        if track.get("mute") or (vca and vca.get("mute")) or (soloed and not track.get("solo")) or track.get("busId") in muted_buses:
            continue
        bus_index = buses[track["busId"]][0] if track.get("busId") in buses else 0
        automation = track.get("automation") or {}
        gain_env = pan_env = 0
        if automation.get("volume"):
            envelopes.append(([(int(p["time"]), float(p["value"])) for p in automation["volume"]], True))
            gain_env = len(envelopes)
        if automation.get("pan"):
            envelopes.append(([(int(p["time"]), float(p["value"])) for p in automation["pan"]], False))
            pan_env = len(envelopes)
        track_db = (0.0 if gain_env else float(track.get("gainDb", 0))) + (float(vca.get("gainDb", 0)) if vca else 0.0)
        track_pan = 0.0 if pan_env else float(track.get("pan") or 0)

        stages = [s for s in (_stage(f) for f in (track.get("fx") or [])) if s]
        if bus_index == 0 and any(s[0] == 6 for s in stages):
            # A compressor is nonlinear, so it must see the track's sum: the track plays through a bus of its own
            # (unity gain, centre) whose chain is the track's whole chain, in order.
            buses[f"__track:{track.get('id')}"] = (len(buses) + 1, 1.0, 0.0)
            bus_index = len(buses)
            chains.extend((1, bus_index - 1, *s) for s in stages)
            stages = []
        else:
            # Filters are linear and run per clip; a compressor on a track routed to a user bus is not placed yet.
            stages = [s[:4] for s in stages if s[0] != 6]
        # The filters' parameter automation (PT-19), numbered by the clip stages above (bypassed, unknown and compressor
        # entries skipped, as the browser's flatFxAuto does); each becomes one envelope (natural units) for the track.
        auto_envs: list[tuple[int, int, int]] = []
        if stages:
            filters = [f for f in (track.get("fx") or []) if (_stage(f) or (6,))[0] != 6]
            for si, f in enumerate(filters):
                for param, key in enumerate(("freq", "gain", "q")):
                    pts = (f.get("automation") or {}).get(key)
                    if pts:
                        envelopes.append(([(int(p["time"]), float(p["value"])) for p in pts], False))
                        auto_envs.append((si, param, len(envelopes)))
        for clip in track.get("clips", []):
            # A pitched clip plays its derived render (non-destructive pitch; same length as the original).
            play_id = clip.get("pitchMediaId") if clip.get("pitchMediaId") in doc["media"] else clip.get("mediaId")
            info = doc["media"].get(play_id)
            if not isinstance(info, dict):
                continue
            if info.get("sampleRate") != rate:
                skipped += 1
                continue
            source = sources.setdefault(play_id, len(sources) + 1)
            gain = math.pow(10, (track_db + float(clip.get("gainDb", 0))) / 20)
            start, length = int(clip["start"]), int(clip["length"])
            fade_shape = {"linear": 0, "equal-power": 1, "s-curve": 2, "exponential": 3}.get(clip.get("fadeShape") or "linear", 0)
            clip_env = gain_env
            if clip.get("envelope"):
                own = [(start + int(p["at"]) - int(clip.get("sourceIn", 0)), float(p["db"])) for p in clip["envelope"]]
                track_pts = [(int(p["time"]), float(p["value"])) for p in automation["volume"]] if automation.get("volume") else []
                envelopes.append((_clip_envelope(own, track_pts), True))
                clip_env = len(envelopes)
            clips.append((source, start, int(clip.get("sourceIn", 0)), length, gain, track_pan, int(clip.get("fadeIn") or 0), int(clip.get("fadeOut") or 0), fade_shape, bus_index, clip_env, pan_env))
            owners.append(tracks.index(track))
            # PT-33, as the player's clipChain: the clip's own filters, then its own compressor (its threshold lowered by
            # the clip gain, which the core applies after the chain), then the track's filters, whose automation moves
            # past the clip's stages
            own = [s for s in (_stage(f) for f in (clip.get("fx") or [])) if s]
            own_filters = [s[:4] for s in own if s[0] != 6]
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
                if send.get("busId") not in buses or send.get("busId") in muted_buses:
                    continue
                level = 10 ** (float(send.get("gainDb", 0.0)) / 20)
                clips.append((*main[:4], main[4] * level, *main[5:9], buses[send["busId"]][0], *main[10:]))
                owners.append(tracks.index(track))
                add_chain(len(clips) - 1)
            end = max(end, start + length)
    return rate, sources, clips, end, skipped, list(buses.values()), envelopes, fx, chains, fx_auto, comps, owners


def wav_float32_stereo(interleaved: bytes, rate: int) -> bytes:
    data_bytes = len(interleaved)
    header = b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, rate, rate * 8, 8, 32)
    header += b"data" + struct.pack("<I", data_bytes)
    return header + interleaved


def dbfs(peak: float) -> str:
    return f"{20 * math.log10(peak):.2f}" if peak > 0 else "-inf"


def render(doc: object) -> dict:
    native = media._require_core()
    rate, sources, clips, end, skipped, buses, envelopes, fx, chains, fx_auto, comps, owners = plan(doc)
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

    places = places_for(doc, owners) if isinstance(doc, dict) and doc.get("surroundFold") else []
    interleaved, peak_left, peak_right = native.render(loaded, clips, max(1, end), buses, envelopes, float(doc.get("masterGainDb") or 0), float(rate), fx, [], chains, fx_auto, comps, places, bool(places))
    frames = max(1, end)
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
    loudness = native.loudness(interleaved, 2, rate)
    return {
        "wav": wav_float32_stereo(interleaved, rate),
        "frames": frames,
        "peakLeft": dbfs(peak_left),
        "peakRight": dbfs(peak_right),
        "loudness": f"{loudness:.2f}" if loudness is not None else "-inf",
        "skipped": skipped,
    }
