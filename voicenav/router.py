"""Voice and command routing with Jev: one request picks the app operation and its target.

The same dynamic action space idea as the browser agent: only operations that make sense in the current view
and stage are offered, and every target is an observed option (a theme card, a preview section, a device).
"""

import os
import time

from .model import JEV_URL, post_json, validate_choice

ROUTE_RULES = """Decide what the user wants VoiceNav to do with this utterance, given the current screen and
stage. Prefer the most specific operation. Navigation phrases ("go to", "show me", "open", "scroll", "click",
"take me to") refer to the website preview when one exists. Requests to change how the site looks or reads
are edits. A request to do something on a real external website (shop, search, book, look up) is a web task.
A description of a new website to make is a new build."""

TARGET_RULES = """Choose the option the utterance refers to, if this operation is the one selected. Match by
name, meaning, position words (first, second, last), or description."""

OPERATIONS = {
    "BUILD_WEBSITE": "Start building a new website or landing page from this description.",
    "WEB_TASK": "Do a task on a real website in the browser: search, shop, compare, look something up.",
    "OPEN_PROJECTS": "Show my saved website projects.",
    "OPEN_STUDIO": "Go to the website builder.",
    "OPEN_NAVIGATOR": "Go to the web task agent.",
    "ANSWER": "Answer the open questions about the website being planned.",
    "DECIDE_FOR_ME": "Skip the questions and let VoiceNav decide.",
    "PICK_THEME": "Choose one of the offered visual themes.",
    "BUILD_NOW": "Approve the plan and start building the website.",
    "CHANGE_PLAN": "Change the planned sections or content before building.",
    "EDIT_SITE": "Change the website's design, copy, colors, or sections.",
    "GO_TO": "Navigate the website preview to a section, or click a link, tab, or button in it.",
    "SCROLL_DOWN": "Scroll the website preview down.",
    "SCROLL_UP": "Scroll the website preview up.",
    "SCROLL_TOP": "Go back to the top of the website preview.",
    "DEVICE": "Preview the website on another device size.",
    "SHOW_CODE": "Show the website's HTML code.",
    "SHOW_PREVIEW": "Show the website preview instead of code.",
    "DOWNLOAD": "Download or export the website.",
    "TEST_IN_NAVIGATOR": "Let the browser agent use this website.",
    "STOP_BUILD": "Stop the build that is running.",
    "PAUSE": "Pause the running web task.",
    "RESUME": "Resume the paused web task.",
    "STOP": "Stop the web task.",
    "CONFIRM": "Approve the shown next action and run it.",
}

DEVICES = {"desktop": "Desktop or laptop width", "tablet": "Tablet width", "mobile": "Phone width"}


def operations_for(context):
    view = context.get("view", "home")
    stage = context.get("stage") or ""
    ops = ["BUILD_WEBSITE", "WEB_TASK", "OPEN_PROJECTS"]
    if view != "studio":
        ops.append("OPEN_STUDIO")
    if view != "navigator":
        ops.append("OPEN_NAVIGATOR")
    if view == "studio":
        if stage == "asking":
            ops += ["ANSWER", "DECIDE_FOR_ME"]
        if stage == "planned":
            ops += ["BUILD_NOW", "CHANGE_PLAN"] + (["PICK_THEME"] if context.get("themes") else [])
        if stage in {"building", "editing"}:
            ops.append("STOP_BUILD")
        if context.get("has_site"):
            ops += ["EDIT_SITE", "DEVICE", "SHOW_CODE", "SHOW_PREVIEW", "DOWNLOAD", "TEST_IN_NAVIGATOR",
                    "SCROLL_DOWN", "SCROLL_UP", "SCROLL_TOP"]
            if context.get("targets"):
                ops.append("GO_TO")
    if view == "preview":
        ops = ["SCROLL_DOWN", "SCROLL_UP", "SCROLL_TOP"] + (["GO_TO"] if context.get("targets") else [])
    if view == "navigator":
        if context.get("nav_status") in {"running", "paused", "waiting"}:
            ops += ["PAUSE", "RESUME", "STOP"]
        if context.get("nav_status") == "waiting":
            ops.append("CONFIRM")
    return ops


def route(utterance, context):
    utterance = " ".join(str(utterance or "").split())[:600]
    if not utterance:
        raise ValueError("Say or type something first")
    context = context if isinstance(context, dict) else {}
    ops = operations_for(context)
    themes = {str(i + 1): t for i, t in enumerate((context.get("themes") or [])[:8]) if isinstance(t, dict)}
    targets = {str(t.get("index")): t for t in (context.get("targets") or [])[:120]
               if isinstance(t, dict) and t.get("index") is not None}
    criteria = {op: OPERATIONS[op] for op in ops}
    questions = {"operation": {"type": "choice", "criteria": criteria,
                               "instructions": {"utterance": utterance, "rules": ROUTE_RULES}}}
    if "PICK_THEME" in ops:
        questions["theme_target"] = {"type": "choice", "instructions": {"utterance": utterance, "rules": TARGET_RULES},
                                     "criteria": {k: f"Theme {k}: {t.get('name')} · {t.get('mode')} · "
                                                     f"{t.get('description', '')}" for k, t in themes.items()}}
    if "GO_TO" in ops:
        questions["page_target"] = {"type": "choice", "instructions": {"utterance": utterance, "rules": TARGET_RULES},
                                    "criteria": {k: f"{t.get('kind', 'element')}: {str(t.get('label', ''))[:120]}"
                                                 for k, t in targets.items()}}
    if "DEVICE" in ops:
        questions["device_target"] = {"type": "choice", "criteria": DEVICES,
                                      "instructions": {"utterance": utterance, "rules": TARGET_RULES}}
    body = {
        "model": os.environ.get("TYPESAFE_MODEL", "jev-latest"),
        "state": {"utterance": utterance, "screen": context.get("view"), "stage": context.get("stage"),
                  "site": context.get("site_name"), "running_task": context.get("nav_goal")},
        "questions": questions,
    }
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ValueError("Voice routing needs OPENROUTER_API_KEY")
    started = time.perf_counter()
    result = post_json(JEV_URL, key, body)
    answer = validate_choice(result["answers"].get("operation", {}), criteria)
    operation = answer["choice"]
    target = None
    heads = {"PICK_THEME": ("theme_target", themes), "GO_TO": ("page_target", targets), "DEVICE": ("device_target",
                                                                                                    DEVICES)}
    if operation in heads:
        head, options = heads[operation]
        try:
            target = validate_choice(result["answers"].get(head, {}), options)["choice"]
        except ValueError:
            target = None
    label = None
    if operation == "PICK_THEME" and target:
        label = themes[target].get("name")
        target = themes[target].get("id")
    elif operation == "GO_TO" and target:
        label = targets[target].get("label")
        target = targets[target].get("index")
    elif operation == "DEVICE":
        label = target
    return {
        "operation": operation,
        "target": target,
        "label": label,
        "utterance": utterance,
        "confidence": answer["confidence"],
        "probabilities": dict(sorted(answer["probabilities"].items(), key=lambda kv: -kv[1])[:5]),
        "latency_ms": round((time.perf_counter() - started) * 1000),
    }
