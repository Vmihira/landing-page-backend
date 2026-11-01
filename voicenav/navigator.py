"""Navigator sessions: the browser agent in a background thread, narrated as a live event stream.

Every phase is announced before it happens (thinking, the next action and its target, typing, executing,
settling), and a viewer thread streams the agent's own page as frames, so the screen never looks stuck.
"""

import os
import threading
import time

from .agent import Agent
from .browser import StalePage
from .events import Channel
from .model import action_space, start_page, task_plan
from .questions import MAX_STEPS

MODES = {"fast": 0.0, "watch": 0.7, "step": None}


class Session:
    def __init__(self, goal, url=None, mode="watch"):
        goal = " ".join(str(goal or "").split())[:2000]
        if not goal:
            raise ValueError("Tell the agent what to do")
        self.goal = goal
        self.url = url
        self.mode = mode if mode in MODES else "watch"
        self.channel = Channel()
        self.agent = None
        self.status = "starting"
        self.plan = []
        self.paused = threading.Event()
        self.stopped = threading.Event()
        self.confirmed = threading.Event()
        self.ending = threading.Event()
        self.started = time.perf_counter()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.viewer = threading.Thread(target=self._view, daemon=True)
        self.thread.start()

    # -------- controls

    def control(self, action, value=None):
        if action == "pause":
            self.paused.set()
            self._status("paused")
        elif action == "resume":
            self.paused.clear()
            self._status("running")
        elif action == "stop":
            self.stopped.set()
            self.paused.clear()
            self.confirmed.set()
        elif action == "confirm":
            self.confirmed.set()
        elif action == "mode" and value in MODES:
            self.mode = value
            self.channel.push("mode", mode=value)
            if value != "step":
                self.confirmed.set()
        else:
            raise ValueError("Unknown control")

    def close(self):
        self.stopped.set()
        self.confirmed.set()
        self.thread.join(timeout=5)
        if self.agent:
            try:
                self.agent.close()
            except Exception:
                pass

    # -------- internals

    def _elapsed(self):
        return round((time.perf_counter() - self.started) * 1000)

    def _status(self, status):
        self.status = status
        self.channel.push("status", status=status, elapsed_ms=self._elapsed())

    def _phase(self, phase, **data):
        self.channel.push("phase", phase=phase, elapsed_ms=self._elapsed(), **data)

    def _hold(self):
        """Wait while paused. Returns False when the run was stopped."""
        while self.paused.is_set() and not self.stopped.is_set():
            time.sleep(0.05)
        return not self.stopped.is_set()

    def _on_agent(self, kind, data):
        self._phase(kind, **data)

    def _page_info(self):
        page = self.agent.state["page"]
        return {"url": page["url"], "title": page["title"], "w": page.get("w"), "h": page.get("h")}

    def _decision_event(self, decision):
        page = self.agent.state["page"]
        action = next((a for a in page["actions"] if a["id"] == decision["choice"]), None)
        elements = action_space(page["actions"])[0]
        ranked = []
        target_probs = decision.get("target_probabilities") or {}
        for element in elements:
            p = target_probs.get(element["index"])
            if p is None and element.get("options"):
                p = max((target_probs.get(o["index"], -1) for o in element["options"]), default=-1)
            if p is not None and p >= 0:
                ranked.append({"index": element["index"], "label": element["label"][:90], "role": element.get("role"),
                               "p": p})
        ranked.sort(key=lambda e: -e["p"])
        return {
            "operation": decision["operation"],
            "choice": decision["choice"],
            "label": action["label"][:140] if action else decision["operation"],
            "kind": action["kind"] if action else None,
            "rect": action.get("rect") if action else None,
            "confidence": decision["confidence"],
            "target_confidence": decision.get("target_confidence"),
            "operations": dict(sorted(decision["operation_probabilities"].items(), key=lambda kv: -kv[1])[:6]),
            "candidates": ranked[:6],
            "plan_step": decision.get("plan_step"),
            "latency_ms": decision["latency_ms"],
            "elements": len(elements),
            "page": self._page_info(),
        }

    def _run(self):
        try:
            self._status("running")
            if not self.url:
                self._phase("choosing_site", goal=self.goal)
                self.url, helper = start_page(self.goal)
                self._phase("site", url=self.url, latency_ms=helper["latency_ms"] if helper else 0)
            threading.Thread(target=self._make_plan, daemon=True).start()
            self._phase("opening", url=self.url)
            self.agent = Agent(self.url, self.goal, on_event=self._on_agent)
            self.agent.task_plan = self.plan
            self.viewer.start()
            self._phase("observed", **self._page_info(), elements=len(action_space(self.agent.state["page"]
                                                                                    ["actions"])[0]))
            self._loop()
        except Exception as error:
            message = str(error) if isinstance(error, (ValueError, RuntimeError, TimeoutError)) else (
                f"The agent stopped: {type(error).__name__}")
            if os.environ.get("BU_CDP_URL"):
                # A browser VoiceNav reaches by URL (the hosted Chromium, or a separate Chrome), not the user's own.
                if "daemon" in message or "unreachable" in message:
                    message += " · The browser isn't reachable yet; try again in a few seconds."
            elif "daemon" in message or "DevToolsActivePort" in message or "remote debugging" in message:
                message += " · Allow remote debugging in Chrome (chrome://inspect/#remote-debugging) and try again."
            self.channel.push("error", message=message, elapsed_ms=self._elapsed())
            self.status = "error"
        finally:
            self._finish()

    def _make_plan(self):
        try:
            steps = task_plan(self.goal, self.url)
        except Exception:
            steps = []
        self.plan[:] = steps
        self.channel.push("plan", steps=steps)

    def _loop(self):
        agent = self.agent
        state = agent.state
        while state["status"] not in {"done", "blocked"}:
            if not self._hold():
                self._status("stopped")
                return
            if len(state["decisions"]) >= MAX_STEPS * 2:
                raise ValueError("Reached the step budget for this task")
            self._phase("thinking", step=len(state["history"]) + 1, elements=len(action_space(
                state["page"]["actions"])[0]))
            try:
                agent.command("predict", {})
            except StalePage:
                self._phase("stale")
                state["page"] = state["browser"].observe(screenshot=False)
                continue
            decision = state["decision"]
            event = self._decision_event(decision)
            self.channel.push("decision", **event, elapsed_ms=self._elapsed())
            if not self._await_go():
                self._status("stopped")
                return
            try:
                agent.command("act", {"fingerprint": state["page"]["fingerprint"]})
            except StalePage:
                self._phase("stale")
                state["status"] = "ready"
                state["page"] = state["browser"].observe(screenshot=False)
                continue
            if state["history"] and decision["choice"] not in {"DONE", "BLOCKED"}:
                item = state["history"][-1]
                self.channel.push("action", **{k: item.get(k) for k in (
                    "step", "action", "kind", "operation", "text", "latency_ms", "text_latency_ms", "page_changed",
                    "url", "executed_ms")}, elapsed_ms=self._elapsed(), page=self._page_info())

    def _await_go(self):
        """Show the decided action before running it: a short hold in watch mode, a confirmation in step mode."""
        delay = MODES.get(self.mode)
        if delay is None:
            self.confirmed.clear()
            self._status("waiting")
            while not self.confirmed.is_set() and not self.stopped.is_set():
                if self.mode != "step":
                    break
                time.sleep(0.05)
            self._status("running")
        else:
            until = time.perf_counter() + delay
            while time.perf_counter() < until and not self.stopped.is_set():
                time.sleep(0.03)
        return self._hold()

    def _view(self):
        """Stream the agent's page to the big screen while the run lasts, then once more at the end."""
        from browser_harness.helpers import cdp

        last = None
        while True:
            running = not self.ending.is_set()
            try:
                browser = self.agent.browser
                frame = cdp("Page.captureScreenshot", session_id=browser.session, format="jpeg", quality=62)["data"]
                if frame != last:
                    last = frame
                    page = self.agent.state["page"]
                    self.channel.set_latest("frame", data=frame, url=page["url"], title=page["title"])
            except Exception:
                pass
            if not running:
                return
            time.sleep(0.16)

    def _finish(self):
        state = self.agent.state if self.agent else {}
        if self.status not in {"error", "stopped"}:
            self.status = state.get("status", "blocked")
        decisions = state.get("decisions", [])
        self.channel.push(
            "finished",
            status=self.status,
            elapsed_ms=self._elapsed(),
            agent_ms=state.get("elapsed_ms"),
            actions=len(state.get("history", [])),
            decisions=len(decisions),
            last=decisions[-1]["operation"] if decisions else None,
            page=self._page_info() if self.agent else None,
        )
        self.ending.set()
        if self.viewer.is_alive():
            self.viewer.join(timeout=3)
        self.channel.close()
