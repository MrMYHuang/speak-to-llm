from __future__ import annotations

import json
import logging
from enum import Enum, auto

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import transcriber as transcriber_service
from app.services.llm_client import LLMClient, LLMConnectionError, Message

logger = logging.getLogger(__name__)

router = APIRouter()


class _State(Enum):
    IDLE = auto()
    BUFFERING = auto()
    TRANSCRIBING = auto()
    LLM_CALLING = auto()


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

    state = _State.IDLE
    audio_chunks: list[bytes] = []
    conversation_history: list[Message] = []
    llm = LLMClient()

    async def _send(data: dict) -> None:  # type: ignore[type-arg]
        await websocket.send_text(json.dumps(data))

    try:
        while True:
            message = await websocket.receive()

            # ── text frame ──────────────────────────────────────────────────
            if "text" in message:
                try:
                    event = json.loads(message["text"])
                except json.JSONDecodeError:
                    await _send({"type": "error", "message": "Invalid JSON"})
                    continue

                event_type = event.get("type")

                if event_type == "start":
                    state = _State.BUFFERING
                    audio_chunks = []
                    await _send({"type": "status", "state": "buffering"})

                elif event_type == "stop":
                    if state is not _State.BUFFERING:
                        # Ignore spurious stop outside of a recording session
                        continue

                    # ── TRANSCRIBING ────────────────────────────────────────
                    state = _State.TRANSCRIBING
                    await _send({"type": "status", "state": "transcribing"})

                    audio_bytes = b"".join(audio_chunks)

                    try:
                        model = websocket.app.state.whisper_model
                        text = await transcriber_service.transcribe(model, audio_bytes)
                    except Exception as exc:
                        logger.exception("Transcription failed")
                        await _send({"type": "error", "message": str(exc)})
                        state = _State.IDLE
                        continue

                    await _send({"type": "transcript", "text": text})

                    # ── LLM_CALLING ─────────────────────────────────────────
                    state = _State.LLM_CALLING
                    await _send({"type": "status", "state": "thinking"})

                    user_message = {"role": "user", "content": text}

                    try:
                        reply = await llm.chat(text, history=list(conversation_history))
                    except LLMConnectionError as exc:
                        conversation_history.append(user_message)
                        logger.error("LLM connection error: %s", exc)
                        await _send({"type": "error", "message": str(exc)})
                        state = _State.IDLE
                        continue

                    conversation_history.extend(
                        [user_message, {"role": "assistant", "content": reply}]
                    )
                    await _send({"type": "llm_response", "text": reply})
                    state = _State.IDLE
                    await _send({"type": "status", "state": "idle"})

            # ── binary frame ─────────────────────────────────────────────────
            elif "bytes" in message:
                if state is _State.BUFFERING:
                    audio_chunks.append(message["bytes"])
                # Frames outside BUFFERING are silently discarded

            # ── disconnect ───────────────────────────────────────────────────
            elif message.get("type") == "websocket.disconnect":
                break

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception:
        logger.exception("Unexpected error in ws_audio")
