"""Tests for the /ws/audio WebSocket endpoint (task-005)."""
from __future__ import annotations

import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocketDisconnect
from starlette.testclient import TestClient

from app.main import app
from app.ws import audio as ws_audio_module
from app.ws.audio import sanitize_llm_reply


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


def test_second_turn_includes_prior_chat_history() -> None:
    """Each new turn should include prior user/assistant messages in the LLM call."""
    mock_llm = AsyncMock()
    mock_llm.chat.side_effect = ["First reply", "Second reply"]

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.side_effect = ["first prompt", "second prompt"]

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            ws.receive_json()  # buffering
            ws.send_json({"type": "stop"})
            ws.receive_json()  # transcribing
            ws.receive_json()  # transcript
            ws.receive_json()  # thinking
            ws.receive_json()  # llm_response
            ws.receive_json()  # idle

            ws.send_json({"type": "start"})
            ws.receive_json()  # buffering
            ws.send_json({"type": "stop"})
            ws.receive_json()  # transcribing
            ws.receive_json()  # transcript
            ws.receive_json()  # thinking
            ws.receive_json()  # llm_response
            ws.receive_json()  # idle

    first_call = mock_llm.chat.await_args_list[0]
    assert first_call.args == ("first prompt",)
    assert first_call.kwargs["history"] == []

    second_call = mock_llm.chat.await_args_list[1]
    assert second_call.args == ("second prompt",)
    assert second_call.kwargs["history"] == [
        {"role": "user", "content": "first prompt"},
        {"role": "assistant", "content": "First reply"},
    ]


def test_unicode_transcript_and_llm_response_round_trip_over_websocket() -> None:
    """Chinese transcript and LLM reply should survive the websocket flow intact."""
    transcript_text = "请帮我总结今天的会议内容。"
    reply_text = "当然可以，以下是今天会议的重点总结。"
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = reply_text

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = transcript_text

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_bytes("你好，世界".encode("utf-8"))
            ws.send_json({"type": "stop"})

            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": transcript_text}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": reply_text}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

    mock_llm.chat.assert_awaited_once_with(transcript_text, history=[])


def test_large_unicode_llm_response_round_trip_over_websocket() -> None:
    """Large unicode replies should still be delivered over the websocket."""
    transcript_text = "请详细解释下面这段日志。"
    reply_text = "这是一个很长的中文响应。 " * 700
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = reply_text

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = transcript_text

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_bytes(b"\x01" * 512)
            ws.send_json({"type": "stop"})

            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": transcript_text}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}

            llm_event = ws.receive_json()
            assert llm_event["type"] == "llm_response"
            assert llm_event["text"] == reply_text
            assert len(llm_event["text"]) == len(reply_text)

            assert ws.receive_json() == {"type": "status", "state": "idle"}


def test_large_think_tagged_unicode_llm_response_round_trip_over_websocket() -> None:
    """Large replies should preserve raw think-tagged unicode text on the websocket."""
    transcript_text = "请清理并发送这段回复。"
    raw_reply = ("保留这段可见文本🙂世界。" * 220) + ("<think>内部推理🔒</think>" * 180) + (
        "再保留这一段Привет🌍。" * 220
    )
    sanitized_reply = ("保留这段可见文本🙂世界。" * 220) + ("再保留这一段Привет🌍。" * 220)
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = raw_reply

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = transcript_text

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_bytes(b"\x02" * 512)
            ws.send_json({"type": "stop"})

            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": transcript_text}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}

            llm_event = ws.receive_json()
            assert llm_event["type"] == "llm_response"
            assert llm_event["text"] == raw_reply
            assert "<think>" in llm_event["text"]
            assert "内部推理" in llm_event["text"]
            assert sanitized_reply != llm_event["text"]
            assert "保留这段可见文本🙂世界。" in llm_event["text"]
            assert "再保留这一段Привет🌍。" in llm_event["text"]

            assert ws.receive_json() == {"type": "status", "state": "idle"}


def test_sanitize_llm_reply_suppresses_think_blocks_and_preserves_unicode() -> None:
    """Visible unicode text should survive while <think> blocks are removed."""
    raw_reply = "Привет 🌍<think>internal 推理 🤫</think>你好\n<think>скрыто</think>🙂"

    assert sanitize_llm_reply(raw_reply) == "Привет 🌍你好\n🙂"


def test_sanitize_llm_reply_truncates_open_ended_think_blocks() -> None:
    """Malformed think blocks should drop everything from the first <think onward."""
    raw_reply = "可见前缀🙂<think>private 推理 🤫"

    assert sanitize_llm_reply(raw_reply) == "可见前缀🙂"


def test_sanitize_llm_reply_preserves_lookalike_tags() -> None:
    """Lookalike tags should remain visible unless they are real think tags."""
    raw_reply = "Visible<thinkabout>keep me</thinkabout><thinking>still visible</thinking>"

    assert sanitize_llm_reply(raw_reply) == raw_reply


def test_llm_response_sends_raw_reply_and_history_uses_sanitized_reply() -> None:
    """Raw assistant text should be sent while sanitized text is persisted in history."""
    raw_reply = "Ответ: Привет<think>private 推理 🤫</think>你好 🙂"
    sanitized_reply = "Ответ: Привет你好 🙂"
    mock_llm = AsyncMock()
    mock_llm.chat.side_effect = [raw_reply, "Second reply"]

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.side_effect = ["first prompt", "second prompt"]

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "first prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": raw_reply}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "second prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": "Second reply"}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

    second_call = mock_llm.chat.await_args_list[1]
    assert second_call.kwargs["history"] == [
        {"role": "user", "content": "first prompt"},
        {"role": "assistant", "content": sanitized_reply},
    ]


def test_open_ended_think_block_is_sent_raw_and_truncated_in_history() -> None:
    """Open-ended think output should be sent raw but truncated before history persistence."""
    raw_reply = "Visible🙂世界<think>private 推理 🤫"
    sanitized_reply = "Visible🙂世界"
    mock_llm = AsyncMock()
    mock_llm.chat.side_effect = [raw_reply, "Second reply"]

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.side_effect = ["first prompt", "second prompt"]

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "first prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": raw_reply}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "second prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": "Second reply"}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

    second_call = mock_llm.chat.await_args_list[1]
    assert second_call.kwargs["history"] == [
        {"role": "user", "content": "first prompt"},
        {"role": "assistant", "content": sanitized_reply},
    ]


def test_large_think_tagged_unicode_reply_stays_sanitized_in_second_turn_history() -> None:
    """Large raw think-tagged replies should remain sanitized when reused as history."""
    raw_reply = ("保留这段可见文本🙂世界。" * 220) + ("<think>内部推理🔒</think>" * 180) + (
        "再保留这一段Привет🌍。" * 220
    )
    sanitized_reply = ("保留这段可见文本🙂世界。" * 220) + ("再保留这一段Привет🌍。" * 220)
    mock_llm = AsyncMock()
    mock_llm.chat.side_effect = [raw_reply, "Second reply"]

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.side_effect = ["first prompt", "second prompt"]

        with _make_client() as client, _ws_connect(client) as ws:
            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_bytes(b"\x02" * 512)
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "first prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": raw_reply}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

            ws.send_json({"type": "start"})
            assert ws.receive_json() == {"type": "status", "state": "buffering"}
            ws.send_json({"type": "stop"})
            assert ws.receive_json() == {"type": "status", "state": "transcribing"}
            assert ws.receive_json() == {"type": "transcript", "text": "second prompt"}
            assert ws.receive_json() == {"type": "status", "state": "thinking"}
            assert ws.receive_json() == {"type": "llm_response", "text": "Second reply"}
            assert ws.receive_json() == {"type": "status", "state": "idle"}

    second_call = mock_llm.chat.await_args_list[1]
    assert second_call.kwargs["history"] == [
        {"role": "user", "content": "first prompt"},
        {"role": "assistant", "content": sanitized_reply},
    ]


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


async def test_disconnect_during_llm_response_send_uses_existing_disconnect_path(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A peer-close during llm_response send should exit via the disconnect path."""
    caplog.set_level(logging.INFO)
    websocket = MagicMock()
    websocket.client = ("testclient", 1234)
    websocket.app.state.whisper_model = object()
    websocket.accept = AsyncMock()
    websocket.receive = AsyncMock(
        side_effect=[
            {"text": json.dumps({"type": "start"})},
            {"text": json.dumps({"type": "stop"})},
        ]
    )

    sent_payloads: list[dict[str, str]] = []

    async def _send_text(payload: str) -> None:
        event = json.loads(payload)
        sent_payloads.append(event)
        if event["type"] == "llm_response":
            raise WebSocketDisconnect()

    websocket.send_text = AsyncMock(side_effect=_send_text)

    mock_llm = AsyncMock()
    mock_llm.chat.return_value = "Visible🙂<think>private</think>世界"

    with (
        patch(_PATCH_TRANSCRIBE, new_callable=AsyncMock) as mock_transcribe,
        patch(_PATCH_LLM_CLS, return_value=mock_llm),
    ):
        mock_transcribe.return_value = "hello"
        await ws_audio_module.ws_audio(websocket)

    assert sent_payloads == [
        {"type": "status", "state": "buffering"},
        {"type": "status", "state": "transcribing"},
        {"type": "transcript", "text": "hello"},
        {"type": "status", "state": "thinking"},
        {"type": "llm_response", "text": "Visible🙂<think>private</think>世界"},
    ]
    assert "disconnect during send type=llm_response" in caplog.text
    assert "client disconnected state=LLM_CALLING" in caplog.text


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
