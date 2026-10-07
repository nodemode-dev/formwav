import json
import re
import sys
from pathlib import Path

OPERATIONS = [
    ("get", "/v1/models"),
    ("get", "/v1/voices"),
    ("post", "/v1/voices/add"),
    ("post", "/v1/text-to-speech/{voice_id}"),
    ("post", "/v1/speech-to-speech/{voice_id}"),
    ("post", "/v1/sound-generation"),
    ("post", "/v1/music"),
    ("post", "/v1/music/stem-separation"),
    ("post", "/v1/audio-isolation"),
    ("post", "/v1/speech-to-text"),
    ("post", "/v1/text-to-voice/design"),
    ("post", "/v1/text-to-voice"),
    ("post", "/v1/text-to-dialogue"),
    ("post", "/v1/forced-alignment"),
    ("post", "/v1/dubbing"),
    ("get", "/v1/dubbing/{dubbing_id}"),
    ("get", "/v1/dubbing/{dubbing_id}/audio/{language_code}"),
    ("get", "/v1/dubbing/{dubbing_id}/transcript/{language_code}"),
]
KEEP = {"type", "enum", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "properties", "required", "items", "anyOf", "format"}
PROSE = [re.compile(r"at least ([0-9.]+) and at most ([0-9.]+)"), re.compile(r"between ([0-9.]+)\s*ms and ([0-9.]+)\s*ms")]


def extract(spec: dict) -> dict:
    schemas = spec["components"]["schemas"]

    def resolve(node, seen=()):
        if isinstance(node, list):
            return [resolve(n, seen) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            name = node["$ref"].split("/")[-1]
            if name in seen:
                return {}
            merged = {**schemas[name], **{k: v for k, v in node.items() if k != "$ref"}}
            return resolve(merged, seen + (name,))
        out = {}
        for key, value in node.items():
            if key == "properties":
                out[key] = {p: resolve(s, seen) for p, s in value.items()}
            elif key in KEEP:
                out[key] = resolve(value, seen)
        text = str(node.get("description") or "")
        for rx in PROSE:
            found = rx.search(text)
            if found and "minimum" not in out and "maximum" not in out:
                out["minimum"], out["maximum"] = float(found.group(1).rstrip(".")), float(found.group(2).rstrip("."))
                break
        return out

    paths: dict = {}
    for method, template in OPERATIONS:
        op = spec["paths"][template][method]
        kept: dict = {"parameters": [{"name": p["name"], "in": p["in"], "schema": resolve(p.get("schema", {}))} for p in op.get("parameters", []) if p.get("in") == "query"]}
        content = op.get("requestBody", {}).get("content", {})
        if content:
            kept["requestBody"] = {"content": {ctype: {"schema": resolve(body.get("schema", {}))} for ctype, body in content.items()}}
        paths.setdefault(template, {})[method] = kept
    return {"source": "https://api.elevenlabs.io/openapi.json", "info": spec.get("info", {}).get("version"), "paths": paths}


if __name__ == "__main__":
    full = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(__file__).resolve().parents[1] / "fixtures" / "elevenlabs_contract.json"
    out.write_text(json.dumps(extract(full), indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(OPERATIONS)} operations, {out.stat().st_size} bytes")
