"""OpenRouter chat for Studio: streamed generation and JSON replies. Credentials stay server-side."""

import json
import os
import time

import httpx

URL = "https://openrouter.ai/api/v1/chat/completions"
BUILDER_MODEL = "anthropic/claude-haiku-5.5"


def builder_model():
    return os.environ.get("BUILDER_MODEL", BUILDER_MODEL)


def reasoning():
    """Hidden reasoning delays the first visible token by up to ~20 s and spends the output budget (a cut-off
    page), so Studio turns it off unless BUILDER_REASONING names an effort level."""
    effort = os.environ.get("BUILDER_REASONING", "none")
    return {"reasoning": {"enabled": False}} if effort == "none" else {"reasoning": {"effort": effort}}


def _key():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ValueError("Studio needs OPENROUTER_API_KEY.")
    return key


def _error(response):
    try:
        detail = response.json().get("error", {}).get("message", "")
    except ValueError:
        detail = response.text[:200]
    hint = " Add credits at openrouter.ai." if response.status_code == 402 else ""
    return RuntimeError(f"OpenRouter returned HTTP {response.status_code}: {detail[:200]}{hint}")


def stream(messages, *, max_tokens=32000, temperature=0.7, model=None, cancelled=lambda: False):
    """Yield ("delta", text) chunks, then one ("usage", dict) at the end."""
    body = {
        "model": model or builder_model(),
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
        **reasoning(),
    }
    usage = {}
    timeout = httpx.Timeout(300, connect=15, read=120)
    try:
        with httpx.stream("POST", URL, json=body, timeout=timeout, headers={"Authorization": f"Bearer {_key()}"}) as r:
            if r.is_error:
                r.read()
                raise _error(r)
            for line in r.iter_lines():
                if cancelled():
                    return
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                try:
                    chunk = json.loads(line[6:])
                except ValueError:
                    continue
                if "error" in chunk:
                    raise RuntimeError(f"OpenRouter stream error: {str(chunk['error'].get('message', ''))[:200]}")
                if chunk.get("usage"):
                    usage = chunk["usage"]
                for choice in chunk.get("choices", []):
                    text = (choice.get("delta") or {}).get("content")
                    if text:
                        yield "delta", text
    except httpx.HTTPError as error:
        raise RuntimeError(f"OpenRouter connection failed: {type(error).__name__}") from None
    yield "usage", usage


def complete(messages, *, max_tokens=4000, temperature=0.5, model=None):
    """One non-streamed reply. Returns (text, meta)."""
    started = time.perf_counter()
    body = {"model": model or builder_model(), "max_tokens": max_tokens, "temperature": temperature,
            "messages": messages, **reasoning()}
    for attempt in range(3):
        try:
            response = httpx.post(URL, json=body, timeout=httpx.Timeout(120, connect=15),
                                  headers={"Authorization": f"Bearer {_key()}"})
            break
        except httpx.HTTPError as error:
            if attempt == 2:
                raise RuntimeError(f"OpenRouter connection failed: {type(error).__name__}") from None
            time.sleep(0.5 * 2**attempt)
    if response.is_error:
        raise _error(response)
    data = response.json()
    text = data["choices"][0]["message"].get("content") or ""
    return text, {"model": data.get("model", body["model"]), "usage": data.get("usage", {}),
                  "latency_ms": round((time.perf_counter() - started) * 1000)}


def first_json_object(text):
    """The first JSON object in a reply, ignoring Markdown fences and surrounding prose. None if absent."""
    start = text.find("{")
    while start >= 0:
        try:
            value = json.JSONDecoder().raw_decode(text, start)[0]
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
        start = text.find("{", start + 1)
    return None


def json_reply(system, user, *, max_tokens=4000, temperature=0.5):
    """Ask for a JSON object; one corrective retry if the first reply does not contain one."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    text, meta = complete(messages, max_tokens=max_tokens, temperature=temperature)
    value = first_json_object(text)
    if value is None:
        messages += [{"role": "assistant", "content": text},
                     {"role": "user", "content": "Reply again with only the JSON object, no other text."}]
        text, meta = complete(messages, max_tokens=max_tokens, temperature=0.2)
        value = first_json_object(text)
    if value is None:
        raise RuntimeError("The model did not return a usable plan. Try again.")
    return value, meta
