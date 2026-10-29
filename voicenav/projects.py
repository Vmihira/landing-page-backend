"""Studio projects on disk: projects/<id>/project.json plus one HTML file per version."""

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

ID = re.compile(r"^[a-z0-9]{6,32}$")


class Store:
    def __init__(self, root=None):
        self.root = Path(root or os.environ.get("VOICENAV_PROJECTS", Path.cwd() / "projects"))
        self.lock = threading.RLock()

    def _dir(self, project_id):
        if not isinstance(project_id, str) or not ID.match(project_id):
            raise ValueError("Unknown project")
        return self.root / project_id

    def create(self, brief):
        project_id = time.strftime("%y%m%d") + secrets.token_hex(4)
        now = time.time()
        project = {
            "id": project_id,
            "name": "Untitled site",
            "brief": brief,
            "created": now,
            "updated": now,
            "stage": "understanding",
            "summary": "",
            "questions": [],
            "answers": {},
            "plan": None,
            "themes": [],
            "theme_id": None,
            "messages": [],
            "versions": [],
            "current": None,
        }
        with self.lock:
            self._dir(project_id).mkdir(parents=True, exist_ok=True)
            self.save(project)
        return project

    def save(self, project):
        with self.lock:
            project["updated"] = time.time()
            folder = self._dir(project["id"])
            folder.mkdir(parents=True, exist_ok=True)
            temporary = folder / "project.json.tmp"
            temporary.write_text(json.dumps(project, indent=1), encoding="utf-8")
            os.replace(temporary, folder / "project.json")
        return project

    def get(self, project_id):
        with self.lock:
            path = self._dir(project_id) / "project.json"
            if not path.exists():
                raise ValueError("Unknown project")
            return json.loads(path.read_text(encoding="utf-8"))

    def list(self):
        with self.lock:
            if not self.root.exists():
                return []
            projects = []
            for path in self.root.glob("*/project.json"):
                try:
                    projects.append(json.loads(path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
            return sorted(projects, key=lambda p: p.get("updated", 0), reverse=True)

    def delete(self, project_id):
        with self.lock:
            folder = self._dir(project_id)
            for path in folder.glob("*"):
                path.unlink()
            folder.rmdir()

    def add_version(self, project, html, note, stats=None):
        with self.lock:
            number = len(project["versions"]) + 1
            (self._dir(project["id"]) / f"v{number}.html").write_text(html, encoding="utf-8")
            project["versions"].append({"n": number, "created": time.time(), "note": note, "stats": stats or {}})
            project["current"] = number
            self.save(project)
            return number

    def html(self, project_id, number=None):
        with self.lock:
            project = self.get(project_id)
            number = number or project.get("current")
            if not number:
                raise ValueError("This project has no page yet")
            path = self._dir(project_id) / f"v{int(number)}.html"
            if not path.exists():
                raise ValueError("Unknown version")
            return path.read_text(encoding="utf-8")
