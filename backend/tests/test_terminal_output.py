import asyncio
import os
import re

import pytest

from app.services import terminals

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
