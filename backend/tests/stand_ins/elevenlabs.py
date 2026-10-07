import base64
import io
import json
import math
import re
import struct
import threading
import wave
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

SPEC = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "elevenlabs_contract.json").read_text(encoding="utf-8"))
ROUTES = sorted(((re.compile("^" + re.sub(r"\{[^/]+\}", "[^/]+", p) + "$"), p) for p in SPEC["paths"]), key=lambda r: r[1].count("{"))
REPORT: list[dict] = []


def _outside(name, value, schema, out) -> bool:
    if "minimum" not in schema and "maximum" not in schema:
        return False
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    if "minimum" in schema and v < schema["minimum"]:
        out.append(f"{name}={value} below minimum {schema['minimum']:g}")
    elif "maximum" in schema and v > schema["maximum"]:
        out.append(f"{name}={value} above maximum {schema['maximum']:g}")
    return True


def _check_value(name, value, schema, out):
    ranged = value is not None and _outside(name, value, schema, out)
    options = schema["anyOf"] if "anyOf" in schema else ([schema] if schema else [])
    if any(o.get("type") == "null" for o in options) and value is None:
        return
    for opt in options:
        if "enum" in opt and isinstance(value, str):
            if value in opt["enum"]:
                return
            continue
        kind = opt.get("type")
        if kind in ("number", "integer"):
            try:
                float(value)
            except (TypeError, ValueError):
                continue
            if not ranged:
                _outside(name, value, opt, out)
            return
        if kind == "array" and isinstance(value, list):
            item = opt.get("items", {})
            for i, it in enumerate(value):
                if isinstance(it, dict) and "properties" in item:
                    _check_object(f"{name}[{i}]", it, item, out)
            return
        if kind in (None, "string", "boolean", "object") or "properties" in opt:
            return
    if any("enum" in o for o in options):
        out.append(f"{name}={value!r} is not one of {[e for o in options for e in o.get('enum', [])]}")


def _check_object(name, obj, schema, out):
    props, required = schema.get("properties", {}), set(schema.get("required", []))
    for r in required:
        if r not in obj:
            out.append(f"{name}: required field {r} missing")
    for k, v in obj.items():
        if k not in props:
            out.append(f"{name}: unknown field {k}")
        else:
            _check_value(f"{name}.{k}", v, props[k], out)


def _multipart(body: bytes, ctype: str) -> dict:
    boundary = re.search(r"boundary=([^;]+)", ctype).group(1).encode()
    fields: dict = {}
    for part in body.split(b"--" + boundary)[1:-1]:
        head, _, data = part.strip(b"\r\n").partition(b"\r\n\r\n")
        name = re.search(rb'name="([^"]+)"', head).group(1).decode()
        value = data if b"filename=" in head else data.decode(errors="replace")
        fields.setdefault(name, []).append(value)
    return {k: (v if len(v) > 1 else v[0]) for k, v in fields.items()}


def check(method: str, path: str, query: dict, headers, body: bytes) -> tuple[str | None, list[str], dict]:
    out: list[str] = []
    template = next((t for rx, t in ROUTES if rx.match(path)), None)
    if template is None:
        return None, [f"no such path {path} among the operations formwav is known to call"], {}
    op = SPEC["paths"][template].get(method.lower())
    if op is None:
        return template, [f"{method} is not an operation on {template}"], {}
    if not headers.get("xi-api-key"):
        out.append("no xi-api-key header")
    declared = {p["name"]: p for p in op.get("parameters", [])}
    for q, vals in query.items():
        if q not in declared:
            out.append(f"unknown query parameter {q}")
        else:
            _check_value(f"?{q}", vals[0], declared[q].get("schema", {}), out)
    parsed: dict = {}
    content = op.get("requestBody", {}).get("content", {})
    if content:
        ctype = headers.get("content-type", "")
        kind = next((k for k in content if ctype.startswith(k)), None)
        if kind is None:
            out.append(f"content type {ctype!r} is not one of {list(content)}")
        else:
            schema = content[kind]["schema"]
            if kind == "application/json":
                parsed = json.loads(body or b"{}")
                _check_object("body", parsed, schema, out)
            elif kind.startswith("multipart/form-data"):
                parsed = _multipart(body, ctype)
                props, required = schema.get("properties", {}), set(schema.get("required", []))
                for r in required:
                    if r not in parsed:
                        out.append(f"form: required field {r} missing")
                for k, v in parsed.items():
                    if k not in props:
                        out.append(f"form: unknown field {k}")
                    elif isinstance(v, str):
                        _check_value(f"form.{k}", v, props[k], out)
    return template, out, parsed


def wav(seconds=1.0, rate=44100, hz=440.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(int(seconds * rate))))
    return buf.getvalue()


def _json(payload) -> tuple[int, str, bytes]:
    return 200, "application/json", json.dumps(payload).encode()


def answer(template: str, method: str, parsed: dict) -> tuple[int, str, bytes]:
    if template == "/v1/models":
        return _json([{"model_id": "eleven_english_sts_v2", "name": "English v2 speech to speech", "can_do_voice_conversion": True, "can_do_text_to_speech": False},
                      {"model_id": "eleven_multilingual_sts_v2", "name": "Multilingual speech to speech", "can_do_voice_conversion": True, "can_do_text_to_speech": False},
                      {"model_id": "eleven_v3", "name": "Eleven v3", "can_do_voice_conversion": False, "can_do_text_to_speech": True}])
    if template == "/v1/voices":
        return _json({"voices": [{"voice_id": "v_rachel", "name": "Rachel"}, {"voice_id": "v_adam", "name": "Adam"}]})
    if template == "/v1/voices/add":
        return _json({"voice_id": "v_clone", "requires_verification": False})
    if template == "/v1/speech-to-text":
        words = [{"text": "Hello", "start": 0.1, "end": 0.4, "type": "word", "speaker_id": "speaker_0", "logprob": -0.1},
                 {"text": " ", "start": 0.4, "end": 0.45, "type": "spacing", "speaker_id": "speaker_0", "logprob": 0.0},
                 {"text": "(laughter)", "start": 0.5, "end": 0.9, "type": "audio_event", "speaker_id": "speaker_1", "logprob": 0.0},
                 {"text": "there", "start": 1.0, "end": 1.3, "type": "word", "speaker_id": "speaker_1", "logprob": -0.2}]
        return _json({"language_code": "en", "language_probability": 0.98, "text": "Hello (laughter) there", "words": words})
    if template == "/v1/text-to-voice/design":
        b64 = base64.b64encode(wav(0.5)).decode()
        return _json({"previews": [{"audio_base_64": b64, "generated_voice_id": f"gen{i}", "media_type": "audio/mpeg", "duration_secs": 0.5, "language": "en"} for i in range(3)], "text": "A preview line."})
    if template == "/v1/text-to-voice":
        return _json({"voice_id": "v_designed", "name": parsed.get("voice_name", ""), "category": "generated", "labels": {}, "available_for_tiers": [], "high_quality_base_model_ids": []})
    if template == "/v1/forced-alignment":
        return _json({"characters": [], "words": [{"text": "Hello", "start": 0.1, "end": 0.4, "loss": 0.1}, {"text": "there", "start": 1.0, "end": 1.3, "loss": 0.2}], "loss": 0.15})
    if template == "/v1/music/stem-separation":
        names = ["vocals", "drums", "bass", "other", "piano", "guitar"] if parsed.get("stem_variation_id", "six_stems_v1") == "six_stems_v1" else ["vocals", "accompaniment"]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for k, n in enumerate(names):
                z.writestr(f"{n}.wav", wav(1.0, hz=200 + 100 * k))
        return 200, "application/zip", buf.getvalue()
    if template == "/v1/dubbing" and method == "POST":
        return _json({"dubbing_id": "dub1", "expected_duration_sec": 1.0})
    if template == "/v1/dubbing/{dubbing_id}":
        return _json({"dubbing_id": "dub1", "name": "dub", "status": "dubbed", "target_languages": ["es"]})
    if template == "/v1/dubbing/{dubbing_id}/transcript/{language_code}":
        return 200, "text/plain", b"1\n00:00:00,000 --> 00:00:01,000\nHola\n"
    return 200, "audio/mpeg", wav()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status: int, ctype: str, data: bytes):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _go(self, method):
        u = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        headers = {k.lower(): v for k, v in self.headers.items()}
        template, problems, parsed = check(method, u.path, parse_qs(u.query), headers, body)
        REPORT.append({"method": method, "path": u.path, "template": template, "problems": problems})
        if problems:
            self._send(422, "application/json", json.dumps({"detail": {"status": "invalid_request", "message": "; ".join(problems)}}).encode())
            return
        self._send(*answer(template, method, parsed))

    def do_GET(self):
        self._go("GET")

    def do_POST(self):
        self._go("POST")


def serve() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
