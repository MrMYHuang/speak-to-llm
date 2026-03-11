from __future__ import annotations

import asyncio
import logging
from functools import partial

import numpy as np
import whisper

logger = logging.getLogger(__name__)

# Whisper always expects 16 kHz mono audio
WHISPER_SAMPLE_RATE = 16_000


def load_model(model_name: str) -> whisper.Whisper:
    """Load a Whisper model synchronously (call once at lifespan startup)."""
    logger.info("Loading Whisper model '%s'", model_name)
    return whisper.load_model(model_name)


def _transcribe_sync(model: whisper.Whisper, audio: np.ndarray) -> str:
    """Blocking Whisper transcription — run inside an executor, never directly."""
    result = model.transcribe(audio, fp16=False)
    return result.get("text", "").strip()


async def transcribe(
    model: whisper.Whisper,
    audio_bytes: bytes,
    sample_rate: int = WHISPER_SAMPLE_RATE,
) -> str:
    """Transcribe raw PCM audio (Int16, mono) to text without blocking the event loop.

    Steps:
      1. Convert Int16 bytes → float32 normalised to [-1.0, 1.0].
      2. Apply whisper.pad_or_trim so the array is exactly N_SAMPLES long.
      3. Run the synchronous model.transcribe in a thread executor.

    Returns an empty string for empty or silent input.
    """
    if not audio_bytes:
        return ""

    # Int16 PCM → float32 in [-1.0, 1.0]
    audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    if audio_np.size == 0:
        return ""

    # Pad silence / truncate to Whisper's expected window (30 s at 16 kHz)
    audio_trimmed = whisper.pad_or_trim(audio_np)

    loop = asyncio.get_running_loop()
    text: str = await loop.run_in_executor(
        None, partial(_transcribe_sync, model, audio_trimmed)
    )
    return text
