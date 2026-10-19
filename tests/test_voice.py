"""Offline contracts for OpenRouter routing, start-page choice, and Fish Audio voice input. No paid APIs."""

import json
from unittest.mock import Mock

import httpx
import pytest

from voicenav import model, voice


def asr(text, status=200):
    return httpx.Response(status, json={"text": text, "duration": 1.2, "segments": []})


def test_jev_and_text_helper_go_through_openrouter(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    monkeypatch.delenv("TEXT_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("TEXT_MODEL_BASE_URL", raising=False)
    monkeypatch.delenv("TEXT_MODEL", raising=False)
    post = Mock(return_value={"choices": [{"message": {"content": '{"text":"Zurich"}'}}]})
    monkeypatch.setattr(model, "post_json", post)
    model.field_text({"goal": "Fly from Zurich"})
    url, key, body = post.call_args.args
    assert url == "https://openrouter.ai/api/v1/chat/completions" and key == "router"
    assert body["model"] == model.TEXT_MODEL
    assert model.JEV_URL == "https://openrouter.ai/api/v1/systemone"


def test_missing_openrouter_key_stops_before_jev(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    post = Mock()
    monkeypatch.setattr(model, "post_json", post)
    state = {"url": "u", "title": "t", "text": "x", "actions": [{"id": "wait", "kind": "wait", "label": "Wait"}]}
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        model.choose(state, "Find a book", [])
    post.assert_not_called()


def test_transcript_becomes_a_clean_goal(monkeypatch):
    monkeypatch.setenv("FISH_AUDIO_API_KEY", "fish")
    monkeypatch.delenv("FISH_AUDIO_LANGUAGE", raising=False)
    post = Mock(return_value=asr("<|speaker:0|> Open the  article [cough] about Gödel."))
    monkeypatch.setattr(voice.httpx, "post", post)
    assert voice.transcribe(b"audio", "audio/webm") == "Open the article about Gödel."
    request = post.call_args
    assert request.args[0] == "https://api.fish.audio/v1/asr"
    assert request.kwargs["headers"] == {"Authorization": "Bearer fish", "model": "transcribe-1-pro"}
    assert request.kwargs["files"]["audio"] == ("task.webm", b"audio", "audio/webm")
    assert request.kwargs["data"]["language"] == "en" and request.kwargs["data"]["diarize"] == "false"


def test_voice_without_key_or_speech_runs_nothing(monkeypatch):
    post = Mock(return_value=asr("<|speaker:0|>"))
    monkeypatch.setattr(voice.httpx, "post", post)
    monkeypatch.delenv("FISH_AUDIO_API_KEY", raising=False)
    with pytest.raises(ValueError, match="FISH_AUDIO_API_KEY"):
        voice.transcribe(b"audio")
    post.assert_not_called()
    monkeypatch.setenv("FISH_AUDIO_API_KEY", "fish")
    with pytest.raises(ValueError, match="No speech"):
        voice.transcribe(b"audio")
    with pytest.raises(ValueError, match="short spoken task"):
        voice.transcribe(b"")


def test_fish_audio_errors_are_reported(monkeypatch):
    monkeypatch.setenv("FISH_AUDIO_API_KEY", "fish")
    monkeypatch.setattr(voice.httpx, "post", Mock(return_value=httpx.Response(400, text="audio_too_short")))
    with pytest.raises(RuntimeError, match="HTTP 400: audio_too_short"):
        voice.transcribe(b"audio")


def helper_reply(content):
    return Mock(return_value={"choices": [{"message": {"content": content}}]})


def test_a_url_in_the_goal_is_used_without_a_model_call(monkeypatch):
    post = helper_reply('{"url":"https://elsewhere.example"}')
    monkeypatch.setattr(model, "post_json", post)
    assert model.start_page("Open https://www.amazon.in/deals, then find a phone.")[0] == "https://www.amazon.in/deals"
    post.assert_not_called()


def test_named_site_is_resolved_by_the_helper_with_the_region(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    post = helper_reply('{"url":"https://www.amazon.in"}')
    monkeypatch.setattr(model, "post_json", post)
    url, helper = model.start_page("Find the cheapest Galaxy S25 on Amazon")
    assert url == "https://www.amazon.in" and helper["model"] == model.TEXT_MODEL
    sent = json.loads(post.call_args.args[2]["messages"][1]["content"])
    assert sent["goal"] == "Find the cheapest Galaxy S25 on Amazon"
    assert set(sent["user_region"]) == {"time_zone", "locale"}


@pytest.mark.parametrize(
    "content",
    [
        '{"url":"javascript:alert(1)"}',
        '{"url":"file:///C:/Windows"}',
        '{"url":"https://user:pass@amazon.in"}',
        '{"url":"https://amazon.in","extra":1}',
        '{"url":null}',
        "Amazon",
    ],
)
def test_only_plain_web_addresses_can_start_a_run(monkeypatch, content):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    monkeypatch.setattr(model, "post_json", helper_reply(content))
    with pytest.raises(ValueError, match="Could not choose a website"):
        model.start_page("Find a phone on Amazon")


@pytest.mark.parametrize("content", ['{"text": "Galaxy S25"}\n```', '```json\n{"text": "Galaxy S25"}\n```'])
def test_a_fenced_helper_object_is_still_one_validated_value(monkeypatch, content):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    monkeypatch.setattr(model, "post_json", helper_reply(content))
    assert model.field_text({"goal": "Find a Galaxy S25"})[0] == "Galaxy S25"
