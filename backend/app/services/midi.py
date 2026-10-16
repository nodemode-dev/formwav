"""Standard MIDI Files read into notes, for note tracks (AU-37, PT-14), written from the SMF format itself.

A file is a header chunk (format, track count, ticks per quarter note) and track chunks of delta-timed events.
Formats 0 and 1 are read; SMPTE time division is refused with its reason. Running status is honoured; channel
messages take their fixed lengths; meta and SysEx events are skipped by their declared lengths, except tempo (FF 51),
which builds the tempo map that turns ticks into seconds (a tempo change moves every later note). Notes pair a
note-on with the next note-off of the same channel and pitch (a note-on at velocity 0 is a note-off), overlapping
repeats of one pitch closing first in, first out; a note left open at the end of its track ends there.
"""

from __future__ import annotations

import struct


class MidiError(ValueError):
    pass


def _vlq(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise MidiError("the file ends inside a variable-length number")
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise MidiError("a variable-length number longer than four bytes")


def _chunks(data: bytes):
    pos = 0
    while pos + 8 <= len(data):
        kind, size = data[pos : pos + 4], struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        yield kind, data[pos + 8 : pos + 8 + size]
        pos += 8 + size


def _events(track: bytes):
    """(tick, status, payload) for channel events and tempo changes, in order."""
    pos, tick, running = 0, 0, 0
    while pos < len(track):
        delta, pos = _vlq(track, pos)
        tick += delta
        if pos >= len(track):
            break
        status = track[pos]
        if status == 0xFF:
            kind = track[pos + 1]
            size, pos = _vlq(track, pos + 2)
            body = track[pos : pos + size]
            pos += size
            if kind == 0x51 and size == 3:
                yield tick, 0xFF51, body
            elif kind in (0x03, 0x06, 0x58, 0x59):
                yield tick, 0xFF00 | kind, body
            elif kind == 0x2F:
                yield tick, 0xFF2F, b""
                return
            continue
        if status in (0xF0, 0xF7):
            size, pos = _vlq(track, pos + 1)
            pos += size
            continue
        if status & 0x80:
            running = status
            pos += 1
        elif not running:
            raise MidiError("data without a status byte")
        length = 1 if running & 0xF0 in (0xC0, 0xD0) else 2
        yield tick, running, track[pos : pos + length]
        pos += length


def read(data: bytes) -> dict:
    """{"format", "ticks", "tempo" (the first, in BPM), "duration" (s), "notes": [{start, length, pitch, velocity,
    channel, track}]} with times in seconds."""
    chunks = list(_chunks(data))
    if not chunks or chunks[0][0] != b"MThd" or len(chunks[0][1]) < 6:
        raise MidiError("not a Standard MIDI File (no MThd header)")
    fmt, _count, division = struct.unpack(">HHH", chunks[0][1][:6])
    if fmt not in (0, 1):
        raise MidiError(f"MIDI format {fmt} is not read (formats 0 and 1 are)")
    if division & 0x8000:
        raise MidiError("SMPTE time division is not read (ticks per quarter note is)")
    tracks = [list(_events(body)) for kind, body in chunks[1:] if kind == b"MTrk"]
    tempos = sorted((tick, 60_000_000 / struct.unpack(">I", b"\0" + body)[0]) for events in tracks for tick, status, body in events if status == 0xFF51)
    if not tempos or tempos[0][0] > 0:
        tempos.insert(0, (0, 120.0))

    def seconds(tick: int) -> float:
        total, last_tick, bpm = 0.0, 0, tempos[0][1]
        for at, next_bpm in tempos:
            if at >= tick:
                break
            total += (at - last_tick) * 60.0 / (bpm * division)
            last_tick, bpm = at, next_bpm
        return total + (tick - last_tick) * 60.0 / (bpm * division)

    notes = []
    for index, events in enumerate(tracks):
        held: dict[tuple[int, int], list[tuple[int, int]]] = {}
        end_tick = 0
        for tick, status, body in events:
            end_tick = max(end_tick, tick)
            kind, channel = status & 0xF0, status & 0x0F
            if status in (0xFF51, 0xFF2F) or len(body) < 2 or kind not in (0x80, 0x90):
                continue
            pitch, velocity = body[0] & 0x7F, body[1] & 0x7F
            if kind == 0x90 and velocity > 0:
                held.setdefault((channel, pitch), []).append((tick, velocity))
            elif held.get((channel, pitch)):
                on, vel = held[(channel, pitch)].pop(0)
                notes.append((on, tick, pitch, vel, channel, index))
        for (channel, pitch), opened in held.items():
            for on, vel in opened:
                notes.append((on, end_tick, pitch, vel, channel, index))
    notes.sort()
    out = [{"start": seconds(on), "length": max(0.0, seconds(off) - seconds(on)), "pitch": p, "velocity": v, "channel": c, "track": t} for on, off, p, v, c, t in notes]
    return {"format": fmt, "ticks": division, "tempo": tempos[0][1], "duration": max((n["start"] + n["length"] for n in out), default=0.0), "notes": out}


def _text(body: bytes) -> str:
    try:
        return body.decode("utf-8").strip("\0 ").strip()
    except UnicodeDecodeError:
        return body.decode("latin-1").strip("\0 ").strip()


def read_song(data: bytes) -> dict:
    """A whole file for the session (S8): every track with its name, notes and controllers, the tempo map, meters,
    markers and key signatures, times in seconds. Formats 0, 1 and 2 and SMPTE division are read; a format 0 file's
    channels become tracks of their own."""
    chunks = list(_chunks(data))
    if not chunks or chunks[0][0] != b"MThd" or len(chunks[0][1]) < 6:
        raise MidiError("not a Standard MIDI File (no MThd header)")
    fmt, _count, division = struct.unpack(">HHH", chunks[0][1][:6])
    if fmt not in (0, 1, 2):
        raise MidiError(f"MIDI format {fmt} is not a Standard MIDI File format")
    tracks = [list(_events(body)) for kind, body in chunks[1:] if kind == b"MTrk"]
    smpte = bool(division & 0x8000)
    if smpte:
        fps = {232: 24.0, 231: 25.0, 227: 29.97, 226: 30.0}.get((division >> 8) & 0xFF, 30.0)
        per_second = fps * (division & 0xFF)
    tempos = sorted((tick, 60_000_000 / struct.unpack(">I", b"\0" + body)[0]) for events in tracks[: 1 if fmt == 1 else None] for tick, status, body in events if status == 0xFF51)
    if not tempos or tempos[0][0] > 0:
        tempos.insert(0, (0, 120.0))

    def seconds(tick: int) -> float:
        if smpte:
            return tick / per_second
        total, last_tick, bpm = 0.0, 0, tempos[0][1]
        for at, next_bpm in tempos:
            if at >= tick:
                break
            total += (at - last_tick) * 60.0 / (bpm * division)
            last_tick, bpm = at, next_bpm
        return total + (tick - last_tick) * 60.0 / (bpm * division)

    meters, markers, keys, out_tracks = [], [], [], []
    names: dict[int, str] = {}
    for index, events in enumerate(tracks):
        held: dict[tuple[int, int], list[tuple[int, int]]] = {}
        notes: dict[int, list] = {}
        controls: dict[int, list] = {}
        end_tick = 0
        for tick, status, body in events:
            end_tick = max(end_tick, tick)
            if status == 0xFF03:
                names.setdefault(index, _text(body))
                continue
            if status == 0xFF06:
                markers.append({"time": seconds(tick), "label": _text(body) or "Marker"})
                continue
            if status == 0xFF58 and len(body) >= 2:
                meters.append({"time": seconds(tick), "tick": None if smpte else round(tick * 960 / division), "numerator": body[0], "denominator": 2 ** body[1]})
                continue
            if status == 0xFF59 and len(body) >= 2:
                keys.append({"time": seconds(tick), "tick": None if smpte else round(tick * 960 / division), "fifths": body[0] - 256 if body[0] > 127 else body[0], "minor": bool(body[1])})
                continue
            if status >= 0xFF00:
                continue
            kind, channel = status & 0xF0, status & 0x0F
            if kind in (0x80, 0x90) and len(body) >= 2:
                pitch, velocity = body[0] & 0x7F, body[1] & 0x7F
                if kind == 0x90 and velocity > 0:
                    held.setdefault((channel, pitch), []).append((tick, velocity))
                elif held.get((channel, pitch)):
                    on, vel = held[(channel, pitch)].pop(0)
                    notes.setdefault(channel, []).append((on, tick, pitch, vel))
            elif kind == 0xB0 and len(body) >= 2:
                controls.setdefault(channel, []).append({"time": seconds(tick), "kind": "cc", "number": body[0] & 0x7F, "value": body[1] & 0x7F})
            elif kind == 0xE0 and len(body) >= 2:
                controls.setdefault(channel, []).append({"time": seconds(tick), "kind": "bend", "number": 0, "value": ((body[1] & 0x7F) << 7 | (body[0] & 0x7F)) - 8192})
            elif kind == 0xC0 and body:
                controls.setdefault(channel, []).append({"time": seconds(tick), "kind": "program", "number": 0, "value": body[0] & 0x7F})
            elif kind == 0xD0 and body:
                controls.setdefault(channel, []).append({"time": seconds(tick), "kind": "pressure", "number": 0, "value": body[0] & 0x7F})
        for (channel, pitch), opened in held.items():
            for on, vel in opened:
                notes.setdefault(channel, []).append((on, end_tick, pitch, vel))
        channels = sorted(set(notes) | set(controls))
        for channel in channels:
            found = sorted(notes.get(channel, []))
            if not found:
                continue
            name = names.get(index) or ""
            if fmt == 0 or len(channels) > 1:
                name = f"{name} ch {channel + 1}".strip() if name else f"Channel {channel + 1}"
            out_tracks.append({
                "index": index,
                "name": name or f"Track {len(out_tracks) + 1}",
                "channel": channel,
                "drums": channel == 9,
                "notes": [{"start": seconds(on), "length": max(0.0, seconds(off) - seconds(on)), "pitch": p, "velocity": max(1, v)} for on, off, p, v in found],
                "controllers": controls.get(channel, []),
            })
    duration = max((n["start"] + n["length"] for t in out_tracks for n in t["notes"]), default=0.0)
    return {
        "format": fmt,
        "ticks": division if not smpte else None,
        "smpte": smpte,
        "tempo": tempos[0][1],
        "tempos": [{"time": seconds(at), "tick": None if smpte else round(at * 960 / division), "bpm": bpm} for at, bpm in tempos],
        "meters": sorted(meters, key=lambda m: m["time"]) or [{"time": 0.0, "numerator": 4, "denominator": 4}],
        "markers": sorted(markers, key=lambda m: m["time"]),
        "keys": sorted(keys, key=lambda k: k["time"]),
        "tracks": out_tracks,
        "duration": duration,
    }
