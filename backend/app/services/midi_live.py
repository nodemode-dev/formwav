"""AU-37: MIDI devices read by the engine itself (formwav_dsp.MidiInput: midir; CoreMIDI on macOS), for the desktop
app, whose WebKit WebView has no Web MIDI. The page lists the devices here and listens to each as server-sent events,
handing every message to the same handler Web MIDI feeds, so live playing, MIDI effects and recording behave alike.

Each stream opens its own connection (a shared one, drained by two listeners, would split their messages; CoreMIDI and
ALSA give every connection its own copy) and closes it when the page goes. FORMWAV_MIDI_TEST=1 adds a test keyboard
fed by POST /api/midi/test, for tests without hardware; the app never sets it.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections import deque
from typing import Callable

TEST_DEVICE = "formwav test keyboard"
_test_queue: deque = deque(maxlen=4096)


def testing() -> bool:
    return os.environ.get("FORMWAV_MIDI_TEST") == "1"


def devices() -> dict:
    """The MIDI inputs, and the reason when there are none to be had (no MIDI system, a core built without it)."""
    names: list[str] = []
    error = None
    try:
        import formwav_dsp

        names = list(formwav_dsp.MidiInput.inputs())
    except Exception as err:  # no MIDI system here, or a core built without native support
        error = str(err)
    if testing():
        names.append(TEST_DEVICE)
    return {"devices": names, "error": error}


def open_reader(name: str) -> tuple[Callable[[], list], Callable[[], None]]:
    """The device's poll and close; raises LookupError for a device not found and RuntimeError when MIDI fails."""
    if name == TEST_DEVICE and testing():

        def poll_test() -> list:
            out = []
            while _test_queue:
                out.append(_test_queue.popleft())
            return out

        return poll_test, lambda: None
    try:
        import formwav_dsp
    except ImportError as err:
        raise RuntimeError("the audio core is not installed") from err
    try:
        reader = formwav_dsp.MidiInput(name)
    except RuntimeError as err:
        if "no MIDI input named" in str(err):
            raise LookupError(str(err)) from err
        raise
    return reader.poll, reader.close


def send_test(data: list[int]) -> None:
    """A message for the test keyboard (FORMWAV_MIDI_TEST only)."""
    _test_queue.append((0, [int(b) & 0xFF for b in data][:3]))


async def events(poll: Callable[[], list], close: Callable[[], None], disconnected: Callable) -> object:
    """Server-sent events: one per MIDI message, {"t": midir's microseconds, "data": [bytes]}; a comment every 15 s
    keeps the connection open; polled every 4 ms (a played note reaches the page within a few milliseconds)."""
    try:
        yield "retry: 2000\n\n"
        idle = 0.0
        while not await disconnected():
            got = poll()
            for stamp, data in got:
                yield f"data: {json.dumps({'t': stamp, 'data': list(data)})}\n\n"
            if got:
                idle = 0.0
                continue
            await asyncio.sleep(0.004)
            idle += 0.004
            if idle >= 15:
                idle = 0.0
                yield ": keep-alive\n\n"
    finally:
        close()
