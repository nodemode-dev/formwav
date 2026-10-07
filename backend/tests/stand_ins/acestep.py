import io
import json
import math
import re
import struct
import threading
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

FIELDS = {"prompt", "caption", "lyrics", "thinking", "vocal_language", "audio_format", "sample_mode", "sample_query", "description", "desc", "use_format", "format",
          "model", "bpm", "key_scale", "keyscale", "keyScale", "time_signature", "timesignature", "timeSignature", "audio_duration", "duration", "target_duration",
          "audio_code_string", "audioCodeString", "inference_steps", "guidance_scale", "use_random_seed", "seed", "batch_size", "shift", "infer_method", "timesteps",
          "use_adg", "cfg_interval_start", "cfg_interval_end", "lm_model_path", "lm_backend", "lm_temperature", "lm_cfg_scale", "lm_negative_prompt", "lm_top_k",
          "lm_top_p", "lm_repetition_penalty", "use_cot_caption", "cot_caption", "cot-caption", "use_cot_language", "cot_language", "cot-language",
          "constrained_decoding", "constrainedDecoding", "constrained", "constrained_decoding_debug", "allow_lm_batch", "reference_audio_path", "src_audio_path",
          "task_type", "instruction", "repainting_start", "repainting_end", "chunk_mask_mode", "audio_cover_strength", "ai_token"}
FILES = {"reference_audio", "ref_audio", "src_audio", "ctx_audio"}
TASKS = {"text2music", "cover", "repaint", "lego", "extract", "complete"}
FORMATS = {"flac", "mp3", "opus", "aac", "wav", "wav32"}
KEY = "local-key"
REPORT: list[dict] = []
_tasks: dict[str, dict] = {}


def wav(seconds=2.0, rate=48000, hz=330.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<hh", s, s) for s in (int(9000 * math.sin(2 * math.pi * hz * i / rate)) for i in range(int(seconds * rate)))))
    return buf.getvalue()


def _multipart(body: bytes, ctype: str) -> tuple[dict, set]:
    boundary = re.search(r"boundary=([^;]+)", ctype).group(1).encode()
    fields, files = {}, set()
    for part in body.split(b"--" + boundary)[1:-1]:
        head, _, data = part.strip(b"\r\n").partition(b"\r\n\r\n")
        name = re.search(rb'name="([^"]+)"', head).group(1).decode()
        if b"filename=" in head:
            files.add(name)
        else:
            fields[name] = data.decode(errors="replace")
    return fields, files


def check_release(headers: dict, body: bytes) -> tuple[list[str], dict]:
    out, ctype = [], headers.get("content-type", "")
    if ctype.startswith("application/json"):
        fields, files = json.loads(body or b"{}"), set()
    elif ctype.startswith("multipart/form-data"):
        fields, files = _multipart(body, ctype)
    else:
        return [f"content type {ctype!r}: API.md takes JSON or multipart"], {}
    if headers.get("authorization") != f"Bearer {KEY}" and fields.get("ai_token") != KEY:
        out.append("no key (Authorization: Bearer, or ai_token)")
    out += [f"unknown field {k}" for k in fields if k not in FIELDS]
    out += [f"unknown file field {f}" for f in files if f not in FILES]
    task = str(fields.get("task_type", "text2music"))
    if task not in TASKS:
        out.append(f"task_type {task!r} is not one of {sorted(TASKS)}")
    for name, lo, hi in (("audio_duration", 10, 600), ("duration", 10, 600), ("bpm", 30, 300), ("batch_size", 1, 8), ("audio_cover_strength", 0, 1)):
        value = fields.get(name)
        if value is None or value == "":
            continue
        try:
            x = float(value)
        except (TypeError, ValueError):
            out.append(f"{name}={value!r} is not a number")
            continue
        if not lo <= x <= hi:
            out.append(f"{name}={x:g} outside {lo:g} to {hi:g}")
    if fields.get("audio_format") not in (None, "") and fields["audio_format"] not in FORMATS:
        out.append(f"audio_format {fields['audio_format']!r} is not one of {sorted(FORMATS)}")
    if task != "text2music" and not (files & {"src_audio", "ctx_audio"}) and not fields.get("src_audio_path"):
        out.append(f"task {task} needs source audio (src_audio upload or src_audio_path)")
    if fields.get("repainting_end") not in (None, ""):
        end, start = float(fields["repainting_end"]), float(fields.get("repainting_start") or 0)
        if end != -1 and end <= start:
            out.append(f"repainting_end {end:g} is not after repainting_start {start:g}")
    return out, fields


def _wrap(data) -> bytes:
    return json.dumps({"data": data, "code": 200, "error": None, "timestamp": int(time.time() * 1000), "extra": None}).encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, ctype, data):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlsplit(self.path)
        if u.path == "/v1/models":
            REPORT.append({"path": u.path, "problems": []})
            return self._send(200, "application/json", _wrap({"models": [{"name": "acestep-v15-turbo", "is_default": True}, {"name": "acestep-v15-xl-turbo", "is_default": False}]}))
        if u.path == "/v1/audio":
            path = parse_qs(u.query).get("path", [""])[0]
            problems = [] if path.startswith("/outputs/") else [f"unknown audio path {path!r}"]
            REPORT.append({"path": u.path, "problems": problems})
            return self._send(200 if not problems else 404, "audio/wav", wav() if not problems else b"")
        self._send(404, "application/json", b"{}")

    def do_POST(self):
        u = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        headers = {k.lower(): v for k, v in self.headers.items()}
        if u.path == "/release_task":
            problems, fields = check_release(headers, body)
            REPORT.append({"path": u.path, "task_type": fields.get("task_type", "text2music"), "fields": dict(fields), "problems": problems})
            if problems:
                return self._send(422, "application/json", json.dumps({"data": None, "code": 422, "error": "; ".join(problems), "timestamp": 0, "extra": None}).encode())
            tid = str(uuid.uuid4())
            _tasks[tid] = {"polls": 0, "fields": fields}
            return self._send(200, "application/json", _wrap({"task_id": tid, "status": "queued", "queue_position": 1}))
        if u.path == "/query_result":
            req = json.loads(body or b"{}")
            ids = req.get("task_id_list")
            ids = json.loads(ids) if isinstance(ids, str) else ids
            REPORT.append({"path": u.path, "problems": [] if isinstance(ids, list) and ids else ["task_id_list missing or empty"]})
            out = []
            for tid in ids or []:
                task = _tasks.get(tid)
                if task is None:
                    out.append({"task_id": tid, "status": 2, "result": "[]"})
                    continue
                task["polls"] += 1
                if task["polls"] < 2:
                    out.append({"task_id": tid, "status": 0, "result": "[]"})
                    continue
                result = [{"file": f"/v1/audio?path=/outputs/{tid}.wav", "wave": "", "status": 1, "create_time": int(time.time()), "env": "development",
                           "prompt": task["fields"].get("prompt", ""), "lyrics": task["fields"].get("lyrics", ""), "metas": {"bpm": 120, "duration": 2.0}, "dit_model": "acestep-v15-turbo"}]
                out.append({"task_id": tid, "status": 1, "result": json.dumps(result)})
            return self._send(200, "application/json", _wrap(out))
        self._send(404, "application/json", b"{}")


def serve() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
