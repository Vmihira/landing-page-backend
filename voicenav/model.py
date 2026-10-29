"""TypeSafe's Jev makes choices; a small OpenAI-compatible model writes field values. Both go through OpenRouter."""

import json
import locale
import math
import os
import re
import threading
import time
from urllib.parse import urlsplit

import httpx

from .questions import NEXT_ACTION, PLAN_STEP, START_PAGE, TARGET, TASK_PLAN, TEXT_VALUE

# One HTTP/2 client per thread: Studio, Navigator, and voice routing call models concurrently,
# and a shared HTTP/2 connection is not safe across threads.
_LOCAL = threading.local()
# OpenRouter serves Jev through the same System One request/answer format as api.typesafe.ai.
JEV_URL = "https://openrouter.ai/api/v1/systemone"
TEXT_MODEL = "inception/mercury-2.5"


def client():
    if not hasattr(_LOCAL, "client"):
        _LOCAL.client = httpx.Client(http2=True, timeout=25)
    return _LOCAL.client


def post_json(url, key, body):
    for attempt in range(3):
        try:
            response = client().post(url, json=body, headers={"Authorization": f"Bearer {key}"})
        except httpx.HTTPError:
            # A model call changes nothing in the browser, so a dropped connection is safe to retry.
            if attempt < 2:
                _LOCAL.__dict__.pop("client", None)
                time.sleep(0.4 * 2**attempt)
                continue
            raise RuntimeError("Model connection failed; no action executed.") from None
        if response.status_code in {429, 529, 503} and attempt < 2:
            time.sleep(0.5 * 2**attempt)
            continue
        if response.is_error:
            raise RuntimeError(f"Model provider returned HTTP {response.status_code}; no action executed.")
        return response.json()
    raise RuntimeError("Model unavailable")


def validate_choice(answer, ids):
    try:
        probabilities = answer["probabilities"]
        numbers = [*probabilities.values(), answer["confidence"]]
        valid = (
            answer["choice"] in ids
            and set(probabilities) == set(ids)
            and all(type(n) in (int, float) and math.isfinite(n) and 0 <= n <= 1 for n in numbers)
            and abs(sum(probabilities.values()) - 1) < 0.02
            and probabilities[answer["choice"]] >= max(probabilities.values()) - 1e-6
        )
    except (KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Invalid TypeSafe response; no action executed.")
    return answer


def action_space(actions):
    """One index per observed element; each operation has its own valid target choices."""
    elements, indices, targets, controls = [], {}, {}, {}
    operations = {"click": "CLICK", "fill": "TYPE_TEXT", "select": "SELECT"}
    for action in actions:
        kind = action["kind"]
        if kind not in operations:
            controls[action["id"].upper()] = action
            continue
        node = action["node"]
        if node not in indices:
            index = str(len(elements) + 1)
            indices[node] = index
            element = {k: action[k] for k in ("role", "value", "checked", "selected", "expanded") if k in action}
            element.update(index=index, label=action["label"].split(" → ")[0], operations=[])
            if kind == "select":
                element["value"] = action.get("current_value", "")
                element["options"] = []
            elements.append(element)
        index = indices[node]
        operation = operations[kind]
        group = targets.setdefault(operation, {})
        element = elements[int(index) - 1]
        if operation not in element["operations"]:
            element["operations"].append(operation)
        target = index
        if kind == "select":
            target = f"{index}:{len(element['options']) + 1}"
            element["options"].append({"index": target, "label": action["label"], "value": action["value"]})
        group[target] = action
    return elements, targets, controls


def choose(state, goal, history, plan=None):
    elements, targets, controls = action_space(state["actions"])
    labels = {
        "CLICK": "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
        "TYPE_TEXT": "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
        "SELECT": "Select an observed dropdown value.",
    }
    operations = {key: labels[key] for key in targets}
    operations.update({key: value["label"] for key, value in controls.items()})
    operations.update(DONE="Every requirement is visibly satisfied.", BLOCKED="No supported operation can progress.")
    questions = {
        "operation": {"type": "choice", "criteria": operations, "instructions": {"goal": goal, "rules": NEXT_ACTION}}
    }
    for operation, candidates in targets.items():
        questions[operation.lower() + "_target"] = {
            "type": "choice",
            "criteria": {
                index: {
                    "element": f"[{index}] {a['label']}",
                    "current_value": a.get("current_value", a.get("value", "")),
                    **{k: a[k] for k in ("role", "checked", "selected", "expanded") if k in a},
                }
                for index, a in candidates.items()
            },
            "instructions": {"goal": goal, "operation": operation, "rules": [NEXT_ACTION, TARGET]},
        }
    steps = {str(i + 1): step for i, step in enumerate(plan or [])}
    if steps:
        # Progress display only. The plan never enters the operation or target questions.
        instructions = {"goal": goal, "rules": PLAN_STEP}
        questions["plan_step"] = {"type": "choice", "criteria": steps, "instructions": instructions}
    body = {
        "model": os.environ.get("TYPESAFE_MODEL", "jev-latest"),
        "state": {
            "page": {k: state[k] for k in ("url", "title", "text")},
            "elements": elements,
            "recent_actions": [
                {k: h.get(k) for k in ("action", "kind", "text", "page_changed")} for h in history[-10:]
            ],
        },
        "questions": questions,
    }
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ValueError("Jev needs OPENROUTER_API_KEY; no action executed.")
    started = time.perf_counter()
    result = post_json(JEV_URL, key, body)
    operation_answer = validate_choice(result["answers"].get("operation", {}), operations)
    operation = operation_answer["choice"]
    target = None
    target_answer = None
    probabilities = {}
    if operation in targets:
        # Unused target heads cannot cause an action. Validate the head selected by the operation.
        target_answer = validate_choice(result["answers"].get(operation.lower() + "_target", {}), targets[operation])
        target = target_answer["choice"]
        choice = targets[operation][target]["id"]
        probabilities = {a["id"]: target_answer["probabilities"][index] for index, a in targets[operation].items()}
    else:
        choice = controls[operation]["id"] if operation in controls else operation
        probabilities[choice] = operation_answer["probabilities"][operation]
    plan_step = None
    if steps:
        try:
            plan_step = int(validate_choice(result["answers"].get("plan_step", {}), steps)["choice"])
        except ValueError:
            pass  # A malformed progress head never blocks the action.
    return {
        "choice": choice,
        "operation": operation,
        "target": target,
        "plan_step": plan_step,
        "confidence": operation_answer["confidence"],
        "probabilities": probabilities,
        "operation_probabilities": operation_answer["probabilities"],
        "target_probabilities": target_answer["probabilities"] if target_answer else {},
        "target_confidence": target_answer["confidence"] if target_answer else None,
        "raw_answers": result["answers"],
        "model": result["model"],
        "usage": result.get("usage", {}),
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "request": body,
    }


def field_context(goal, action, page, history):
    return {
        "goal": goal,
        "field": {k: action.get(k) for k in ("label", "role", "value")},
        "page": {"title": page["title"], "text": page["text"][:6000]},
        "recent_actions": [{k: h.get(k) for k in ("action", "text")} for h in history[-6:]],
    }


def field_text(context):
    value, helper = helper_value(TEXT_VALUE, context, "text")
    if value is None:
        raise ValueError("Text helper returned no valid field value; nothing typed.")
    return value, helper


def start_page(goal):
    """Where a goal begins: a URL written in the goal, else the site the helper names. Only http(s) is opened."""
    named = re.search(r"https?://[^\s\"'<>]+", goal)
    if named:
        url, helper = named.group(0).rstrip(".,;:!?)"), None
    else:
        region = {"time_zone": time.strftime("%Z"), "locale": locale.getlocale()[0]}
        url, helper = helper_value(START_PAGE, {"goal": goal, "user_region": region}, "url")
    parts = urlsplit(url or "")
    if parts.scheme not in {"http", "https"} or not parts.hostname or "@" in parts.netloc or re.search(r"\s", url):
        raise ValueError("Could not choose a website for this task; name the site or paste its URL.")
    return url, helper


def task_plan(goal, url):
    """A short human-readable plan for the Navigator display. Empty when the helper gives no usable list."""
    output, _ = helper_json(TASK_PLAN, {"goal": goal, "start_page": url})
    steps = output.get("steps") if output else None
    if not isinstance(steps, list):
        return []
    return [" ".join(s.split())[:90] for s in steps if isinstance(s, str) and s.strip()][:6]


def helper_value(system, context, field):
    """One JSON request to the small helper model. The reply must be exactly {field: a non-empty string}."""
    output, meta = helper_json(system, context)
    value = output.get(field) if output else None
    if set(output or {}) != {field} or not isinstance(value, str) or not value.strip() or len(value) > 2000:
        value = None
    return value, meta


def helper_json(system, context):
    """One JSON request to the small helper model; returns the first JSON object in its reply, or None."""
    key = os.environ.get("TEXT_MODEL_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ValueError("The text helper needs OPENROUTER_API_KEY; no text is hardcoded or guessed by the executor.")
    base = os.environ.get("TEXT_MODEL_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    model = os.environ.get("TEXT_MODEL", TEXT_MODEL)
    reasoning = {"thinking": {"type": "disabled"}} if "api.deepseek.com/" in base else {"reasoning": {"effort": "low"}}
    if os.environ.get("TEXT_MODEL_REASONING") == "none":
        reasoning = {"reasoning": {"enabled": False}}
    started = time.perf_counter()
    result = post_json(
        base + "/chat/completions",
        key,
        {
            "model": model,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"},
            **reasoning,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": json.dumps(context),
                },
            ],
        },
    )
    try:
        content = result["choices"][0]["message"]["content"]
        # Some helpers wrap or trail the object with a Markdown fence. Parse the first JSON object only.
        start = content.find("{")
        output = json.JSONDecoder().raw_decode(content, start)[0] if start >= 0 else None
    except (ValueError, KeyError, TypeError, IndexError):
        output = None
    return output if isinstance(output, dict) else None, {
        "model": model,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "usage": result.get("usage", {}),
    }
