"""Modal deployment: one container runs VoiceNav and a headless Chromium for Navigator.

    modal secret create voicenav VOICENAV_PUBLIC_URL=https://<workspace>--voicenav.modal.run \
        VOICENAV_PASSWORD=... VOICENAV_TOKEN=... OPENROUTER_API_KEY=... FISH_AUDIO_API_KEY=...
    modal deploy modal_app.py
"""

import subprocess
from pathlib import Path

import modal

ROOT = Path(__file__).parent
PORT = 8000

image = (
    modal.Image.debian_slim(python_version="3.13")
    # Chromium for Navigator, fonts so pages render text, tzdata so TZ sets the region hint for start sites.
    .apt_install("chromium", "fonts-liberation", "fonts-noto-color-emoji", "tzdata")
    .pip_install_from_pyproject(str(ROOT / "pyproject.toml"))
    .env({"PORT": str(PORT), "TZ": "Asia/Kolkata", "VOICENAV_PROJECTS": "/data/projects"})
    .add_local_dir(ROOT / "voicenav", "/root/voicenav", ignore=["**/__pycache__"])
    .add_local_file(ROOT / "scripts" / "start.sh", "/root/scripts/start.sh")
)
projects = modal.Volume.from_name("voicenav-projects", create_if_missing=True)
app = modal.App("voicenav", image=image)


# All state (running builds, the Navigator session) lives in one process, so the app never scales out.
@app.function(secrets=[modal.Secret.from_name("voicenav")], volumes={"/data": projects}, cpu=1, memory=2048,
              max_containers=1, scaledown_window=900, timeout=3600)
@modal.concurrent(max_inputs=100)
@modal.web_server(PORT, startup_timeout=60, label="voicenav")
def serve():
    subprocess.Popen(["sh", "scripts/start.sh"], cwd="/root")
