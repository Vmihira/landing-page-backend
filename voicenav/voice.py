"""Fish Audio speech-to-text. A spoken task becomes the same single natural-language goal."""

import os
import re

import httpx

ASR_URL = "https://api.fish.audio/v1/asr"
# transcribe-1-pro accepts browser recordings (WebM/Ogg Opus, MP4) as well as WAV/MP3.
ASR_MODEL = "transcribe-1-pro"
MAX_AUDIO_BYTES = 10_000_000
MAX_GOAL_CHARS = 2000


def transcribe(audio, mime="audio/webm"):
    key = os.environ.get("FISH_AUDIO_API_KEY")
    if not key:
        raise ValueError("Voice input needs FISH_AUDIO_API_KEY; nothing was run.")
    if not 0 < len(audio) <= MAX_AUDIO_BYTES:
        raise ValueError("Record a short spoken task (at most 10 MB of audio).")
    data = {"ignore_timestamps": "true", "diarize": "false", "tag_audio_events": "false"}
    language = os.environ.get("FISH_AUDIO_LANGUAGE", "en")
    if language:
        data["language"] = language
    try:
        response = httpx.post(
            ASR_URL,
            headers={"Authorization": f"Bearer {key}", "model": ASR_MODEL},
            files={"audio": ("task." + mime.split("/")[-1], audio, mime)},
            data=data,
            timeout=60,
        )
    except httpx.HTTPError:
        raise RuntimeError("Fish Audio connection failed; nothing was run.") from None
    if response.is_error:
        raise RuntimeError(f"Fish Audio returned HTTP {response.status_code}: {response.text[:160]}")
    # Drop speaker markers (<|speaker:0|>) and audio-event cues ([laughs]); the goal is the spoken words only.
    text = " ".join(re.sub(r"<\|[^|]*\|>|\[[^\]]*\]", " ", response.json().get("text") or "").split())
    if not text:
        raise ValueError("No speech was recognised. Try again closer to the microphone.")
    if len(text) > MAX_GOAL_CHARS:
        raise ValueError("The spoken task is longer than 2,000 characters.")
    return text


TTS_URL = "https://api.fish.audio/v1/tts"
MAX_SPOKEN_CHARS = 400


def speak(text):
    """Short spoken replies (MP3) with Fish Audio text-to-speech."""
    key = os.environ.get("FISH_AUDIO_API_KEY")
    if not key:
        raise ValueError("Voice replies need FISH_AUDIO_API_KEY.")
    text = " ".join(str(text or "").split())[:MAX_SPOKEN_CHARS]
    if not text:
        raise ValueError("Nothing to say")
    body = {"text": text, "format": "mp3", "latency": "balanced"}
    voice = os.environ.get("FISH_AUDIO_VOICE")
    if voice:
        body["reference_id"] = voice
    try:
        response = httpx.post(TTS_URL, json=body, headers={"Authorization": f"Bearer {key}"}, timeout=30)
    except httpx.HTTPError:
        raise RuntimeError("Fish Audio connection failed.") from None
    if response.is_error:
        raise RuntimeError(f"Fish Audio returned HTTP {response.status_code}: {response.text[:160]}")
    return response.content
