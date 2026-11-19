import asyncio
import json
import os
import re

import httpx
import pytest

from app.services import terminals
from conftest import serve_engine

NOTE = re.compile(r"\r\n\[formwav: (\d+) characters of output were skipped because this window fell behind\]\r\n")


def _idle() -> terminals.Session:
    return terminals.Session("t", "t", "shell", [], "", {}, 80, 24)


def test_a_subscriber_that_falls_behind_is_told_how_much_was_skipped_and_still_gets_the_end():
    session = _idle()
    _, queue = session.attach()
    for _ in range(terminals.SUBSCRIBER_CHUNKS + 50):
        session.deliver("x" * 10)
    assert queue.qsize() == terminals.SUBSCRIBER_CHUNKS and queue.skipped == 500
    session.deliver(None)
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    assert items[-1] is None
    found = NOTE.search(items[-2])
    assert found and int(found.group(1)) == 500 and queue.skipped == 0
    assert sum(len(i) for i in items[:-2]) == terminals.SUBSCRIBER_CHUNKS * 10


def test_the_note_comes_before_the_next_output_once_there_is_room():
    session = _idle()
    _, queue = session.attach()
    for _ in range(terminals.SUBSCRIBER_CHUNKS + 3):
        session.deliver("ab")
    for _ in range(10):
        queue.get_nowait()
    session.deliver("after")
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    assert items[-1] == "after" and NOTE.fullmatch(items[-2]) and int(NOTE.fullmatch(items[-2]).group(1)) == 6


@pytest.mark.skipif(os.name != "posix", reason="a shell on a pseudo-terminal")
def test_a_flood_from_a_real_shell_to_a_subscriber_that_does_not_read_loses_nothing_unannounced():
    async def go():
        session = terminals.open_shell(120, 30)
        try:
            await asyncio.sleep(0.5)
            seen = [0]
            deliver = session.deliver

            def spy(item):
                seen[0] += len(item or "")
                deliver(item)

            session.deliver = spy
            _, queue = session.attach()
            session.write('yes abcdefghijklmnopqrstuvwxyz0123456789 | head -c 30000000; echo FLOOD""DONE\n')
            for _ in range(300):
                await asyncio.sleep(0.1)
                if "FLOODDONE" in "".join(list(session.chunks)[-8:]):
                    break
            await asyncio.sleep(0.2)
            items = []
            while not queue.empty():
                items.append(queue.get_nowait())
            if queue.skipped:
                items.append(queue.note())
            text = "".join(items)
            skipped = sum(int(n) for n in NOTE.findall(text))
            kept = len(NOTE.sub("", text))
            return seen[0], kept, skipped
        finally:
            session.close()
            terminals.SESSIONS.pop(session.id, None)

    seen, kept, skipped = asyncio.run(go())
    assert seen > 30000000 and skipped > 0
    assert kept + skipped == seen


@pytest.fixture(scope="module")
def keyed_engine():
    with serve_engine("engine-terminal.log") as url:
        yield url, httpx.post(url + "/api/window/key", headers={"x-formwav-local": "1"}, timeout=30).json()["key"]


def _frames_until_exit(url: str, key: str, query: str = "") -> list:
    from websockets.sync.client import connect

    http = httpx.Client(base_url=url, headers={"x-formwav-local": "1", "x-formwav-window-key": key}, timeout=30)
    tab = http.post("/api/terminal/open", json={"cols": 80, "rows": 20}).json()
    got: list = []
    with connect(f"ws://{url.removeprefix('http://')}/api/terminal/{tab['id']}{query}", origin=url) as ws:
        ws.send(json.dumps({"type": "key", "key": key}))
        ws.send(json.dumps({"type": "input", "data": "exit\n"}))
        while not got or got[-1] not in ('{"type": "exit"}', b'{"type": "exit"}'):
            got.append(ws.recv(timeout=20))
    http.post("/api/terminal/close", json={"id": tab["id"]})
    return got


@pytest.mark.skipif(os.name != "posix", reason="types exit into a POSIX shell")
def test_the_end_of_a_program_is_a_text_frame_for_a_page_that_asks_for_nothing_else(keyed_engine):
    got = _frames_until_exit(*keyed_engine)
    assert all(isinstance(frame, str) for frame in got) and got[-1] == '{"type": "exit"}'


@pytest.mark.skipif(os.name != "posix", reason="types exit into a POSIX shell")
def test_a_page_that_asks_gets_hello_and_exit_as_binary_frames_and_output_as_text(keyed_engine):
    got = _frames_until_exit(*keyed_engine, "?control=binary")
    assert got[0] == b'{"type": "hello"}' and got[-1] == b'{"type": "exit"}'
    assert len(got) > 2 and all(isinstance(frame, str) for frame in got[1:-1])
