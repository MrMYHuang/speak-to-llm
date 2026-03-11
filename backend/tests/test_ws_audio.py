"""Tests for the /ws/audio WebSocket endpoint (task-005)."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from app.main import app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client() -> TestClient:
    """Return a TestClient that starts the full app lifespan."""
    return TestClient(app)


def _ws_connect(client: TestClient):  # type: ignore[return]
    return client.websocket_connect("/ws/audio")


# ---------------------------------------------------------------------------
# Patches used across tests
# ---------------------------------------------------------------------------

_PATCH_TRANSCRIBE = "app.ws.audio.transcriber_service.transcribe"
_PATCH_LLM_CLS = "app.ws.audio.LLMClient"


# ---------------------------------------------------------------------------
# Happy-path test
# ---------------------------------------------------------------------------


def test_start_binary_stop_yields_transcript_and_llm_response() -> None:
    """Full flow: start → binary PCM frames → stop → transcript + llm_response."""
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = "Hi there!"

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = "hello world"

        with _make_client() as client, _ws_connect(client) as ws:
            # Start recording
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}

            # Send a binary PCM frame
            ws.send_bytes(b"\x00" * 200)

            # Stop recording
            ws.send_json({"type": "stop"})

            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            transcript_event = ws.receive_json()
            assert transcript_event["type"] == "transcript"
            assert transcript_event["text"] == "hello world"

            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            llm_event = ws.receive_json()
            assert llm_event["type"] == "llm_response"
            assert llm_event["text"] == "Hi there!"

            assert ws.receive_json() == {"type": "status", "state": "idle"}

    # Verify binary chunk was forwarded to transcribe
    mock_transcribe.assert_awaited_once()
    call_audio_bytes = mock_transcribe.await_args.args[1]
    assert call_audio_bytes == b"\x00" * 200


# ---------------------------------------------------------------------------
# Binary frames before start are silently dropped
# ---------------------------------------------------------------------------


def test_binary_frames_ignored_when_not_buffering() -> None:
    """Binary frames received in IDLE state must be silently discarded."""
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = "ok"

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = "text"

        with _make_client() as client, _ws_connect(client) as ws:
            # Send bytes before start — should be ignored
            ws.send_bytes(b"\xff" * 50)

            # Now do a normal flow with no bytes inside the session
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}

            ws.send_json({"type": "stop"})
            ws.receive_json()  # transcribing
            ws.receive_json()  # transcript
            ws.receive_json()  # thinking
            ws.receive_json()  # llm_response
            ws.receive_json()  # idle

    # transcribe received only the bytes sent after start (none in this case)
    call_audio_bytes = mock_transcribe.await_args.args[1]
    assert call_audio_bytes == b""


# ---------------------------------------------------------------------------
# Transcription error
# ---------------------------------------------------------------------------


def test_transcription_error_sends_error_event_and_resets_to_idle() -> None:
    """If transcription raises, an error event is sent and state resets to IDLE."""
    mock_llm = AsyncMock()

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.side_effect = RuntimeError("GPU OOM")

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            ws.receive_json()  # BUFFERING
            ws.send_json({"type": "stop"})
            ws.receive_json()  # TRANSCRIBING

            error_event = ws.receive_json()
            assert error_event["type"] == "error"
            assert "GPU OOM" in error_event["message"]

            # After error, server is back in IDLE → accepts a new start
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}

    mock_llm.chat.assert_not_called()


# ---------------------------------------------------------------------------
# LLM connection error
# ---------------------------------------------------------------------------


def test_llm_connection_error_sends_error_event_and_resets_to_idle() -> None:
    """LLMConnectionError must send an error event and reset to IDLE."""
    from app.services.llm_client import LLMConnectionError

    mock_llm = AsyncMock()
    mock_llm.chat.side_effect = LLMConnectionError("LM Studio unreachable")

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = "some text"

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            ws.receive_json()  # BUFFERING
            ws.send_json({"type": "stop"})
            ws.receive_json()  # TRANSCRIBING
            ws.receive_json()  # transcript
            ws.receive_json()  # LLM_CALLING

            error_event = ws.receive_json()
            assert error_event["type"] == "error"
            assert "LM Studio unreachable" in error_event["message"]

            # State reset to IDLE: new start should work
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}


# ---------------------------------------------------------------------------
# Spurious stop when not buffering
# ---------------------------------------------------------------------------


def test_stop_without_start_is_ignored() -> None:
    """Stop received in IDLE state must be silently ignored (no crash, no event)."""
    mock_llm = AsyncMock()

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock),
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "stop"})
            # No response expected — server stays alive and accepts a start
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}


# ---------------------------------------------------------------------------
# Client disconnect does not crash
# ---------------------------------------------------------------------------


def test_client_disconnect_does_not_crash_server() -> None:
    """Closing the WebSocket mid-session must not raise on the server side."""
    mock_llm = AsyncMock()

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock),
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        # Connect, send start, then disconnect immediately — no exception should propagate
        with _make_client() as client:
            with _ws_connect(client) as ws:
                ws.send_json({"type": "start"})
                ws.receive_json()  # BUFFERING
                # Close without stop — simulates abrupt disconnect


# ---------------------------------------------------------------------------
# Invalid JSON is handled gracefully
# ---------------------------------------------------------------------------


def test_invalid_json_sends_error_event() -> None:
    """Malformed JSON text frame must produce an error event, not crash."""
    mock_llm = AsyncMock()

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock),
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_text("not-json{{{{")
            error_event = ws.receive_json()
            assert error_event["type"] == "error"
            assert "Invalid JSON" in error_event["message"]
