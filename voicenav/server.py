"""VoiceNav local server: Home, Studio (website builder), Navigator (browser agent), Projects.

Loopback only. Every API call carries a per-run token. Generated sites are served with a sandbox CSP so their
code cannot reach the API. Long jobs stream newline-delimited JSON events.
"""

import atexit
import json
import mimetypes
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import llm, router
from .model import TEXT_MODEL
from .navigator import Session
from .projects import Store
from .studio import Studio, clean_text, make_plan, understand
from .voice import MAX_AUDIO_BYTES, speak, transcribe

ROOT = Path(__file__).parent
STATIC = ROOT / "static"
PORT = int(os.environ.get("TYPESAFE_DEMO_PORT", "8766"))
ORIGIN = f"http://127.0.0.1:{PORT}"
# Generated sites open on a different origin (localhost vs 127.0.0.1): they run as normal pages, microphone
# included, yet cannot read the app page, its token, or the API.
SITES = f"http://localhost:{PORT}"
TOKEN = secrets.token_urlsafe(32)
SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals"
STORE = Store()
STUDIO = Studio(STORE)
NAV = {"session": None}
NAV_LOCK = threading.Lock()


def load_environment():
    path = Path.cwd() / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def health():
    return {
        "openrouter": bool(os.environ.get("OPENROUTER_API_KEY")),
        "fish": bool(os.environ.get("FISH_AUDIO_API_KEY")),
        "builder_model": llm.builder_model(),
        "jev_model": os.environ.get("TYPESAFE_MODEL", "jev-latest"),
        "text_model": os.environ.get("TEXT_MODEL", TEXT_MODEL),
        "chrome": os.environ.get("BU_CDP_URL") or "your Chrome (remote debugging)",
        "origin": ORIGIN,
        "sites": SITES,
    }


def with_voice_nav(html):
    """Exported and opened sites carry standalone voice navigation (the browser's own speech recognition)."""
    script = (STATIC / "voice-nav.js").read_text(encoding="utf-8")
    tag = f"<script>\n{script}\n</script>\n"
    index = html.rfind("</body>")
    return html[:index] + tag + html[index:] if index >= 0 else html + tag


def summary(project):
    return {k: project.get(k) for k in ("id", "name", "brief", "summary", "stage", "created", "updated", "current",
                                       "theme_id")} | {
        "versions": len(project.get("versions", [])),
        "theme": next((t for t in project.get("themes", []) if t["id"] == project.get("theme_id")), None),
        "sections": len((project.get("plan") or {}).get("sections", [])),
    }


def answers_text(questions, answers):
    names = {q["id"]: q["question"].rstrip("?") for q in questions}
    parts = [f"{names.get(k, k)}: {', '.join(v) if isinstance(v, list) else v}" for k, v in answers.items() if v]
    return " · ".join(parts)


# ------------------------------------------------------------------ API handlers

def api_studio(name, body):
    if name == "list":
        return {"projects": [summary(p) for p in STORE.list()]}
    if name == "new":
        brief = clean_text(body.get("brief"), 2000)
        if not brief:
            raise ValueError("Describe the website you want")
        project = STORE.create(brief)
        project["messages"].append({"role": "user", "kind": "text", "text": brief, "t": time.time()})
        try:
            understood, meta = understand(brief)
        except Exception:
            STORE.delete(project["id"])
            raise
        project.update(name=understood["name"], summary=understood["summary"], kind=understood["kind"],
                       questions=understood["questions"], stage="asking")
        project["messages"].append({"role": "assistant", "kind": "questions", "summary": understood["summary"],
                                    "questions": understood["questions"], "ms": meta["latency_ms"], "t": time.time()})
        return {"project": STORE.save(project)}
    project_id = body.get("id")
    if name == "get":
        project = STORE.get(project_id)
        return {"project": project, "busy": STUDIO.busy(project_id)}
    if name == "delete":
        STUDIO.cancel(project_id)
        STORE.delete(project_id)
        return {"ok": True}
    if name == "rename":
        project = STORE.get(project_id)
        project["name"] = clean_text(body.get("name"), 60) or project["name"]
        return {"project": STORE.save(project)}
    if name == "plan":
        project = STORE.get(project_id)
        answers = {} if body.get("skip") else {
            clean_text(k, 40): ([clean_text(x, 80) for x in v][:6] if isinstance(v, list) else clean_text(v, 300))
            for k, v in (body.get("answers") or {}).items()}
        note = clean_text(body.get("note"), 600)
        said = "Decide for me." if body.get("skip") else (answers_text(project["questions"], answers) or note)
        if note and not body.get("skip") and note not in said:
            said += f" · {note}"
        project["messages"].append({"role": "user", "kind": "answers", "text": said, "t": time.time()})
        project["stage"] = "planning"
        STORE.save(project)
        plan, meta = make_plan(project["brief"], answers, note)
        project = STORE.get(project_id)
        project.update(answers=answers, plan=plan, themes=plan.pop("themes"), stage="planned",
                       theme_id=plan["recommended_theme"])
        project["messages"].append({"role": "assistant", "kind": "plan", "ms": meta["latency_ms"], "t": time.time()})
        return {"project": STORE.save(project)}
    if name == "build":
        STUDIO.build(project_id, body.get("sections"), body.get("theme_id"))
        return {"project": STORE.get(project_id)}
    if name == "edit":
        STUDIO.edit(project_id, body.get("instruction"))
        return {"project": STORE.get(project_id)}
    if name == "cancel":
        STUDIO.cancel(project_id)
        return {"ok": True}
    if name == "version":
        project = STORE.get(project_id)
        number = int(body.get("n", 0))
        if not any(v["n"] == number for v in project["versions"]):
            raise ValueError("Unknown version")
        project["current"] = number
        return {"project": STORE.save(project)}
    if name == "html":
        return {"html": STORE.html(project_id, body.get("n"))}
    raise ValueError("Unknown Studio request")


def api_nav(name, body):
    if name == "start":
        with NAV_LOCK:
            previous = NAV["session"]
            if previous:
                threading.Thread(target=previous.close, daemon=True).start()
            url = body.get("url") or None
            if url and not re.match(r"^https?://", url):
                raise ValueError("Start URLs must be http(s)")
            NAV["session"] = Session(body.get("goal"), url=url, mode=body.get("mode", "watch"))
            return {"ok": True, "goal": NAV["session"].goal}
    session = NAV["session"]
    if name == "state":
        return {"active": bool(session), "status": session.status if session else "idle",
                "goal": session.goal if session else None}
    if not session:
        raise ValueError("Start a task first")
    if name == "control":
        session.control(body.get("action"), body.get("value"))
        return {"ok": True, "status": session.status}
    raise ValueError("Unknown Navigator request")


# ------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    def send(self, status, content, mime="application/json", headers=None):
        content = content if isinstance(content, bytes) else content.encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(content)

    def stream(self, events):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            for event in events:
                self.wfile.write((json.dumps(event if event else {"type": "heartbeat"}) + "\n").encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_GET(self):
        host = self.headers.get("Host")
        url = urlparse(self.path)
        path = url.path
        if host == f"localhost:{PORT}" and path.startswith("/sites/"):
            return self.site(path, url)
        if host != f"127.0.0.1:{PORT}":
            return self.send(403, "Forbidden", "text/plain")
        if path in {"/", "/studio", "/navigator", "/projects"} or path.startswith("/studio/"):
            page = (STATIC / "index.html").read_text(encoding="utf-8").replace("__TOKEN__", TOKEN)
            return self.send(200, page, "text/html; charset=utf-8")
        if path == "/api/health":
            return self.send(200, json.dumps(health()))
        if path == "/fixture.html":
            return self.send(200, (STATIC / "fixture.html").read_text(encoding="utf-8"), "text/html; charset=utf-8")
        if path.startswith("/sites/"):
            return self.site(path, url, sandbox=True)
        if path.startswith("/static/"):
            file = (STATIC / path.removeprefix("/static/")).resolve()
            if STATIC.resolve() in file.parents and file.is_file():
                mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                if mime.startswith("text/") or mime in {"application/javascript", "text/javascript"}:
                    mime += "; charset=utf-8"
                return self.send(200, file.read_bytes(), mime)
        return self.send(404, "Not found", "text/plain")

    def site(self, path, url, sandbox=False):
        match = re.match(r"^/sites/([a-z0-9]+)/(?:v(\d+))?$", path)
        if not match:
            return self.send(404, "Not found", "text/plain")
        try:
            html = with_voice_nav(STORE.html(match.group(1), int(match.group(2)) if match.group(2) else None))
        except ValueError:
            return self.send(404, "Not found", "text/plain")
        headers = {"Content-Security-Policy": SANDBOX} if sandbox else {}
        if "download" in parse_qs(url.query):
            name = re.sub(r"[^a-z0-9]+", "-", STORE.get(match.group(1))["name"].lower()).strip("-") or "site"
            headers["Content-Disposition"] = f'attachment; filename="{name}.html"'
        return self.send(200, html, "text/html; charset=utf-8", headers)

    def do_POST(self):
        if (
            self.headers.get("Host") != f"127.0.0.1:{PORT}"
            or self.headers.get("X-Demo-Token") != TOKEN
            or self.headers.get("Origin") not in (None, ORIGIN)
        ):
            return self.send(403, json.dumps({"error": "Local requests only"}))
        path = self.path.removeprefix("/api/")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if path == "transcribe":
                if not 0 < length <= MAX_AUDIO_BYTES:
                    raise ValueError("Record a short spoken message (at most 10 MB of audio).")
                mime = self.headers.get("Content-Type", "").split(";")[0].strip()
                if not mime.startswith("audio/"):
                    raise ValueError("Send recorded audio")
                return self.send(200, json.dumps({"text": transcribe(self.rfile.read(length), mime)}))
            if not 0 <= length < 512_000:
                raise ValueError("Request too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            if path == "speak":
                return self.send(200, speak(body.get("text")), "audio/mpeg")
            if path == "route":
                return self.send(200, json.dumps(router.route(body.get("utterance"), body.get("context"))))
            if path == "studio/events":
                channel = STUDIO.channel(body.get("id"))
                if not channel:
                    return self.send(200, json.dumps({"type": "idle"}) + "\n", "application/x-ndjson")
                return self.stream(channel.follow(int(body.get("since", 0))))
            if path == "nav/events":
                session = NAV["session"]
                if not session:
                    return self.send(200, json.dumps({"type": "idle"}) + "\n", "application/x-ndjson")
                return self.stream(session.channel.follow(int(body.get("since", 0))))
            if path.startswith("studio/"):
                return self.send(200, json.dumps(api_studio(path.removeprefix("studio/"), body)))
            if path.startswith("nav/"):
                return self.send(200, json.dumps(api_nav(path.removeprefix("nav/"), body)))
            raise ValueError("Unknown request")
        except (ValueError, RuntimeError, TimeoutError) as error:
            self.send(400, json.dumps({"error": str(error)}))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as error:
            self.send(500, json.dumps({"error": f"Unexpected server error ({type(error).__name__})."}))

    def log_message(self, *_args):
        pass


def close_navigator():
    session = NAV["session"]
    if session:
        session.close()


def main():
    load_environment()
    atexit.register(close_navigator)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"VoiceNav: {ORIGIN}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
