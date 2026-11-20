import json
import os
import socket
import subprocess
import sys
import time

import pytest

from conftest import BACKEND

pytestmark = pytest.mark.skipif(os.name != "posix", reason="the stand-in programs are POSIX ones")

FROZEN = "import sys\nsys.frozen = True\nsys.executable = {engine!r}\nsys.argv = ['formwav-engine']\nimport desktop_entry as e\nsys.exit(e.main())\n"


def stand_in():
    return subprocess.Popen(["sleep", "120"])


def stop(*procs):
    for proc in procs:
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=10)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def engine_env(data, **more):
    env = {k: v for k, v in os.environ.items() if not k.startswith("FORMWAV_")}
    env.update(FORMWAV_DATA_DIR=str(data), FORMWAV_PORT=str(free_port()), PYTHONUNBUFFERED="1", **more)
    return env


def wait_for(check, seconds=60.0):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if check():
            return True
        time.sleep(0.1)
    return False


def logged(data, words):
    log = data / "Logs" / "formwav-engine.log"
    return log.is_file() and words in log.read_text(encoding="utf-8", errors="replace")


def record(startup, engine, shell):
    return {"pid": engine.pid, "started": int(time.time()), "born": startup.created(engine.pid), "shell": shell.pid, "shellBorn": startup.created(shell.pid)}


def test_a_holder_whose_shell_is_alive_is_respected(tmp_path):
    from app.core import startup

    engine, shell, mine = stand_in(), stand_in(), stand_in()
    try:
        (tmp_path / startup.LOCK_NAME).write_text(json.dumps(record(startup, engine, shell)))
        with pytest.raises(startup.Busy) as refused:
            startup.claim(tmp_path, mine.pid)
        assert f"formwav is already running on {tmp_path} (engine process {engine.pid})" in str(refused.value)
        assert engine.poll() is None
    finally:
        stop(engine, shell, mine)


def test_a_holder_whose_shell_is_gone_is_ended_and_replaced(tmp_path):
    from app.core import startup

    engine, shell, mine = stand_in(), stand_in(), stand_in()
    try:
        (tmp_path / startup.LOCK_NAME).write_text(json.dumps(record(startup, engine, shell)))
        stop(shell)
        path, replaced = startup.claim(tmp_path, mine.pid)
        assert replaced == engine.pid
        assert engine.wait(timeout=10) is not None
        now = json.loads(path.read_text())
        assert now["pid"] == os.getpid() and now["shell"] == mine.pid and now["born"] > 0 and now["shellBorn"] > 0
    finally:
        stop(engine, shell, mine)


def test_a_holder_from_an_engine_that_recorded_no_shell_is_replaced_only_by_an_engine_with_a_shell(tmp_path):
    from app.core import startup

    engine, mine = stand_in(), stand_in()
    try:
        (tmp_path / startup.LOCK_NAME).write_text(json.dumps({"pid": engine.pid, "started": int(time.time())}))
        with pytest.raises(startup.Busy):
            startup.claim(tmp_path, 0)
        assert engine.poll() is None
        assert startup.claim(tmp_path, mine.pid)[1] == engine.pid
        assert engine.wait(timeout=10) is not None
    finally:
        stop(engine, mine)


@pytest.mark.parametrize("text", ["not json at all", "[1, 2]", '{"pid": "x"}', ""])
def test_a_damaged_lock_is_replaced(tmp_path, text):
    from app.core import startup

    (tmp_path / startup.LOCK_NAME).write_text(text)
    path, replaced = startup.claim(tmp_path, 0)
    assert replaced == 0
    assert json.loads(path.read_text())["pid"] == os.getpid()


def test_a_lock_that_names_a_process_which_is_not_the_engine_is_replaced_and_the_process_is_left_alone(tmp_path):
    from app.core import startup

    other, mine = stand_in(), stand_in()
    try:
        for held in ({"pid": other.pid, "started": int(time.time()) - 86400}, {"pid": other.pid, "started": 5, "born": 12345.5, "shell": 999999, "shellBorn": 5.0}):
            (tmp_path / startup.LOCK_NAME).write_text(json.dumps(held))
            assert startup.claim(tmp_path, mine.pid)[1] == 0
            assert other.poll() is None
        (tmp_path / startup.LOCK_NAME).write_text(json.dumps({"pid": other.pid}))
        with pytest.raises(startup.Busy):
            startup.claim(tmp_path, mine.pid)
        assert other.poll() is None
    finally:
        stop(other, mine)


def test_the_two_ways_of_reading_a_start_time_agree(monkeypatch):
    from app.core import startup

    first = startup.created(os.getpid())
    monkeypatch.setattr(startup, "PROC", "/nonexistent")
    second = startup.created(os.getpid())
    assert first > 0 and abs(first - second) <= startup.SLACK
    assert startup.created(4_000_000) == 0.0


def test_a_holder_that_ended_and_was_not_yet_collected_counts_as_gone_where_there_is_no_proc(tmp_path, monkeypatch):
    from app.core import startup

    monkeypatch.setattr(startup, "PROC", str(tmp_path / "no-proc"))
    engine, shell, mine = stand_in(), stand_in(), stand_in()
    try:
        assert startup.finished(engine.pid) is False
        (tmp_path / startup.LOCK_NAME).write_text(json.dumps(record(startup, engine, shell)))
        stop(shell)
        path, replaced = startup.claim(tmp_path, mine.pid)
        assert replaced == engine.pid
        assert json.loads(path.read_text())["pid"] == os.getpid()
        assert startup.finished(engine.pid) is True
        assert engine.wait(timeout=10) is not None
        assert startup.finished(engine.pid) is False
    finally:
        stop(engine, shell, mine)


def test_the_engine_serves_and_logs_with_its_three_streams_closed(tmp_path):
    proc = subprocess.Popen(["sh", "-c", 'exec "$0" desktop_entry.py <&- >&- 2>&-', sys.executable], cwd=BACKEND, env=engine_env(tmp_path))
    log = tmp_path / "Logs" / "formwav-engine.log"
    try:
        assert wait_for(lambda: logged(tmp_path, "Uvicorn running on http://127.0.0.1:"))
        assert log.read_text().splitlines()[0].endswith(f"engine started, pid {proc.pid}, data folder {tmp_path}")
        assert (tmp_path / "Logs" / "formwav-engine-errors.log").is_file()
        assert json.loads((tmp_path / "engine.lock").read_text())["pid"] == proc.pid
    finally:
        proc.terminate()
        proc.wait(timeout=20)


def test_a_second_engine_is_refused_while_the_first_ones_shell_lives(tmp_path):
    first_shell, second_shell = stand_in(), stand_in()
    first = subprocess.Popen([sys.executable, "desktop_entry.py"], cwd=BACKEND, env=engine_env(tmp_path, FORMWAV_SHELL_PID=str(first_shell.pid)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_for(lambda: logged(tmp_path, "Uvicorn running on"))
        second = subprocess.run([sys.executable, "desktop_entry.py"], cwd=BACKEND, env=engine_env(tmp_path, FORMWAV_SHELL_PID=str(second_shell.pid)), capture_output=True, text=True, timeout=60)
        assert second.returncode == 2
        assert f"formwav is already running on {tmp_path} (engine process {first.pid})." in second.stderr
        assert first.poll() is None
        assert json.loads((tmp_path / "engine.lock").read_text())["pid"] == first.pid
        assert logged(tmp_path, "is already running on")
    finally:
        stop(first_shell, second_shell)
        first.terminate()
        first.wait(timeout=20)


def test_the_engine_stops_when_the_shell_it_was_given_ends(tmp_path):
    shell = stand_in()
    proc = subprocess.Popen([sys.executable, "desktop_entry.py"], cwd=BACKEND, env=engine_env(tmp_path, FORMWAV_SHELL_PID=str(shell.pid)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_for(lambda: logged(tmp_path, "Uvicorn running on"))
        assert json.loads((tmp_path / "engine.lock").read_text())["shell"] == shell.pid
        stop(shell)
        assert proc.wait(timeout=10) == 0
        assert not (tmp_path / "engine.lock").exists()
        assert logged(tmp_path, f"the app that started this engine is gone (process {shell.pid}), stopping")
    finally:
        stop(shell, proc)


def test_a_frozen_engine_started_alone_opens_the_app_beside_it_and_serves_nothing(tmp_path):
    install, data, mark = tmp_path / "install", tmp_path / "data", tmp_path / "opened"
    (install / "engine").mkdir(parents=True)
    data.mkdir()
    app = install / "formwav"
    app.write_text(f'#!/bin/sh\nprintf "%s" "$(pwd)" > "{mark}"\n')
    app.chmod(0o755)
    code = FROZEN.format(engine=str(install / "engine" / "formwav-engine"))
    done = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=engine_env(data), capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    assert wait_for(mark.is_file, 10)
    assert mark.read_text() == str(install.resolve())
    assert not (data / "engine.lock").exists() and not (data / "engine-port").exists()
    assert logged(data, "started without its app")


def test_a_frozen_engine_started_alone_with_no_app_near_it_says_so_and_serves_nothing(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    code = FROZEN.format(engine=str(tmp_path / "engine" / "formwav-engine"))
    done = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=engine_env(data), capture_output=True, text=True, timeout=60)
    assert done.returncode == 4
    assert "serves nothing on its own" in done.stderr
    assert not (data / "engine.lock").exists()
