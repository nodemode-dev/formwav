import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REQUESTS: list[dict] = []


def _reply(body: dict) -> dict:
    messages = body.get("messages", [])
    turn = sum(1 for m in messages if m["role"] == "assistant") + 1
    if turn == 1:
        content = [{"type": "text", "text": "Let me look at the session first."}, {"type": "tool_use", "id": "tu_1", "name": "get_session", "input": {}}]
        return {"content": content, "stop_reason": "tool_use"}
    if turn == 2:
        result = next(b for b in messages[-1]["content"] if b.get("type") == "tool_result")
        track = json.loads(result["content"])["tracks"][0]
        clip = track["clips"][0]
        content = [
            {"type": "text", "text": f"I'll lower {track['name']} by 6 dB, fade its clip in and out, and mark one second."},
            {"type": "tool_use", "id": "tu_2", "name": "set_track_gain", "input": {"track_id": track["id"], "gain_db": -6}},
            {"type": "tool_use", "id": "tu_3", "name": "set_clip_fades", "input": {"track_id": track["id"], "clip_id": clip["id"], "fade_in_s": 0.5, "fade_out_s": 1.0}},
            {"type": "tool_use", "id": "tu_4", "name": "add_marker", "input": {"at_s": 1.0, "label": "agent"}},
        ]
        return {"content": content, "stop_reason": "tool_use"}
    return {"content": [{"type": "text", "text": "Done: the track is 6 dB lower, its clip fades in and out, and a marker named agent sits at 1 s."}], "stop_reason": "end_turn"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
        last = body.get("messages", [{}])[-1].get("content")
        REQUESTS.append({
            "path": self.path,
            "key": self.headers.get("x-api-key"),
            "version": self.headers.get("anthropic-version"),
            "model": body.get("model"),
            "tools": [t["name"] for t in body.get("tools", [])],
            "results": [b for b in last if b.get("type") == "tool_result"] if isinstance(last, list) else [],
        })
        out = json.dumps({"id": f"msg_{len(REQUESTS)}", "type": "message", "role": "assistant", "model": body.get("model"), **_reply(body)}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def serve() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
