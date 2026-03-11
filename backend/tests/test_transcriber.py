from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services.transcriber import WHISPER_SAMPLE_RATE, load_model, transcribe


async def test_transcribe_empty_bytes_returns_empty_string() -> None:
    """Empty audio_bytes must return '' without calling the model."""
    mock_model = MagicMock()
    result = await transcribe(mock_model, b"")
    assert result == ""
    mock_model.transcribe.assert_not_called()


async def test_transcribe_calls_model_and_returns_stripped_text() -> None:
    """A valid Int16 buffer should call model.transcribe and return stripped text."""
    silence_int16 = np.zeros(WHISPER_SAMPLE_RATE, dtype=np.int16)
    audio_bytes = silence_int16.tobytes()

    mock_model = MagicMock()
    mock_model.transcribe.return_value = {"text": "  hello world  "}

    result = await transcribe(mock_model, audio_bytes, sample_rate=WHISPER_SAMPLE_RATE)

    assert result == "hello world"
    mock_model.transcribe.assert_called_once()
    # First positional arg to transcribe must be a float32 ndarray
    audio_arg = mock_model.transcribe.call_args.args[0]
    assert audio_arg.dtype == np.float32


async def test_transcribe_short_audio_is_padded_without_error() -> None:
    """Audio shorter than 30 s must be silently padded — no exception raised."""
    short_audio = np.zeros(100, dtype=np.int16).tobytes()
    mock_model = MagicMock()
    mock_model.transcribe.return_value = {"text": ""}

    result = await transcribe(mock_model, short_audio)
    assert result == ""
    mock_model.transcribe.assert_called_once()


async def test_transcribe_returns_empty_string_for_empty_text() -> None:
    """Model returning empty / whitespace text should yield ''."""
    audio_bytes = np.zeros(WHISPER_SAMPLE_RATE, dtype=np.int16).tobytes()
    mock_model = MagicMock()
    mock_model.transcribe.return_value = {"text": "   "}

    result = await transcribe(mock_model, audio_bytes)
    assert result == ""


def test_load_model_delegates_to_whisper() -> None:
    """load_model must call whisper.load_model with the given name."""
    with patch("app.services.transcriber.whisper.load_model") as mock_load:
        fake_model = MagicMock()
        mock_load.return_value = fake_model

        model = load_model("base")

        mock_load.assert_called_once_with("base")
        assert model is fake_model
