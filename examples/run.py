"""uv run --env-file .env python examples/run.py --url URL --goal 'A narrow goal'
uv run --env-file .env python examples/run.py --goal 'A narrow goal on a named website'
uv run --env-file .env python examples/run.py --audio spoken-goal.wav"""

import argparse
import mimetypes
from pathlib import Path

from voicenav import Agent
from voicenav.model import start_page
from voicenav.voice import transcribe

parser = argparse.ArgumentParser()
parser.add_argument("--url", help="Start page. Omit it to start on the website the goal names.")
parser.add_argument("--goal", action="append", default=[], help="Repeat for an ordered list of goals.")
parser.add_argument("--audio", help="A recorded spoken goal, transcribed by Fish Audio.")
args = parser.parse_args()
if args.audio:
    heard = transcribe(Path(args.audio).read_bytes(), mimetypes.guess_type(args.audio)[0] or "audio/webm")
    print(f"Heard: {heard}")
    args.goal.append(heard)
if not args.goal:
    parser.error("Supply --goal or --audio")
url = args.url or start_page("\n".join(args.goal))[0]
print(f"Start: {url}")

with Agent(url, args.goal) as agent:
    for state in agent.run():
        print(f"{state['elapsed_ms']:>5} ms  {len(state['history'])} actions  {state['status']}")
    print(state["page"]["url"])
