from __future__ import annotations

import json
import logging
import re
from enum import Enum, auto
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import transcriber as transcriber_service
from app.services.llm_client import LLMClient, LLMConnectionError, Message

logger = logging.getLogger(__name__)

router = APIRouter()
_THINK_BLOCK_PATTERN = re.compile(r"<think\b[^>]*>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_OPEN_PATTERN = re.compile(r"<think", re.IGNORECASE)


class _State(Enum):
    IDLE = auto()
    BUFFERING = auto()
    TRANSCRIBING = auto()
    LLM_CALLING = auto()


def sanitize_llm_reply(text: str) -> str:
    """Remove hidden reasoning blocks while preserving visible unicode text."""
    sanitized = _THINK_BLOCK_PATTERN.sub("", text)
    malformed_open_match = _THINK_OPEN_PATTERN.search(sanitized)
    if malformed_open_match is None:
        return sanitized
    return sanitized[: malformed_open_match.start()]


@router.websocket("/ws/audio")
async def ws_audio(websocket: WebSocket) -> None:
    """State-machine WebSocket endpoint for real-time voice → LLM chat.

    Client protocol
    ---------------
    - Send ``{"type": "start"}`` to begin an utterance.
    - Send raw PCM binary frames (Int16 mono 16 kHz) while recording.
    - Send ``{"type": "stop"}`` to end recording and trigger transcription + LLM.

    Server events
    -------------
    - ``{"type": "status", "state": "<STATE>"}``
    - ``{"type": "transcript", "text": "..."}``
    - ``{"type": "llm_response", "text": "..."}``
    - ``{"type": "error", "message": "..."}``
    """
    await websocket.accept()

    session_id = uuid4().hex[:8]
    state = _State.IDLE
    audio_chunks: list[bytes] = []
    conversation_history: list[Message] = []
    llm = LLMClient()

    logger.info(
        "[ws:%s] accepted client=%s",
        session_id,
        websocket.client,
    )

    async def _send(data: dict) -> None:  # type: ignore[type-arg]
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        payload_size = len(payload.encode("utf-8"))
        logger.info(
            "[ws:%s] sending type=%s payload_bytes=%d state=%s",
            session_id,
            data.get("type"),
            payload_size,
            state.name,
        )
        try:
            await websocket.send_text(payload)
        except WebSocketDisconnect:
            logger.warning(
                "[ws:%s] disconnect during send type=%s payload_bytes=%d state=%s",
                session_id,
                data.get("type"),
                payload_size,
                state.name,
            )
            raise

    try:
        while True:
            message = await websocket.receive()

            # ── text frame ──────────────────────────────────────────────────
            if "text" in message:
                try:
                    event = json.loads(message["text"])
                except json.JSONDecodeError:
                    logger.warning("[ws:%s] received invalid JSON", session_id)
                    await _send({"type": "error", "message": "Invalid JSON"})
                    continue

                event_type = event.get("type")
                logger.info("[ws:%s] received event type=%s state=%s", session_id, event_type, state.name)

                if event_type == "start":
                    state = _State.BUFFERING
                    audio_chunks = []
                    logger.info("[ws:%s] recording started", session_id)
                    await _send({"type": "status", "state": "buffering"})

                elif event_type == "stop":
                    if state is not _State.BUFFERING:
                        # Ignore spurious stop outside of a recording session
                        logger.warning(
                            "[ws:%s] ignored stop while state=%s",
                            session_id,
                            state.name,
                        )
                        continue

                    # ── TRANSCRIBING ────────────────────────────────────────
                    state = _State.TRANSCRIBING
                    await _send({"type": "status", "state": "transcribing"})

                    audio_bytes = b"".join(audio_chunks)
                    logger.info(
                        "[ws:%s] transcribing %d chunks (%d bytes)",
                        session_id,
                        len(audio_chunks),
                        len(audio_bytes),
                    )

                    try:
                        model = websocket.app.state.whisper_model
                        text = await transcriber_service.transcribe(model, audio_bytes)
                    except Exception as exc:
                        logger.exception("Transcription failed")
                        await _send({"type": "error", "message": str(exc)})
                        state = _State.IDLE
                        continue

                    logger.info("[ws:%s] transcript length=%d", session_id, len(text))
                    await _send({"type": "transcript", "text": text})

                    # ── LLM_CALLING ─────────────────────────────────────────
                    state = _State.LLM_CALLING
                    await _send({"type": "status", "state": "thinking"})

                    user_message = {"role": "user", "content": text}

                    try:
                        logger.info(
                            "[ws:%s] requesting llm history_messages=%d",
                            session_id,
                            len(conversation_history),
                        )
                        reply = await llm.chat(text, history=list(conversation_history))
                    except LLMConnectionError as exc:
                        conversation_history.append(user_message)
                        logger.error("LLM connection error: %s", exc)
                        await _send({"type": "error", "message": str(exc)})
                        state = _State.IDLE
                        continue

                    sanitized_reply = sanitize_llm_reply(reply)
                    if sanitized_reply != reply:
                        logger.info(
                            "[ws:%s] sanitized llm reply raw_length=%d clean_length=%d",
                            session_id,
                            len(reply),
                            len(sanitized_reply),
                        )
                    conversation_history.extend(
                        [user_message, {"role": "assistant", "content": sanitized_reply}]
                    )
                    logger.info(
                        "[ws:%s] llm reply length=%d reply_bytes=%d history_messages=%d",
                        session_id,
                        len(sanitized_reply),
                        len(sanitized_reply.encode("utf-8")),
                        len(conversation_history),
                    )
                    await _send({"type": "llm_response", "text": sanitized_reply})
                    state = _State.IDLE
                    await _send({"type": "status", "state": "idle"})

            # ── binary frame ─────────────────────────────────────────────────
            elif "bytes" in message:
                if state is _State.BUFFERING:
                    audio_chunks.append(message["bytes"])
                else:
                    logger.debug(
                        "[ws:%s] discarded binary frame while state=%s",
                        session_id,
                        state.name,
                    )
                # Frames outside BUFFERING are silently discarded

            # ── disconnect ───────────────────────────────────────────────────
            elif message.get("type") == "websocket.disconnect":
                logger.info("[ws:%s] receive loop disconnect message state=%s", session_id, state.name)
                break

    except WebSocketDisconnect:
        logger.warning(
            "[ws:%s] client disconnected state=%s buffered_chunks=%d history_messages=%d",
            session_id,
            state.name,
            len(audio_chunks),
            len(conversation_history),
        )
    except Exception:
        logger.exception("[ws:%s] unexpected error in ws_audio", session_id)
