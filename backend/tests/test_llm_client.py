from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from openai import APIConnectionError

from app.core.config import Settings
from app.services.llm_client import LLMClient, LLMConnectionError


def _settings(**kwargs: object) -> Settings:
    defaults: dict[str, object] = dict(
        lm_studio_base_url="http://localhost:1234/v1",
        lm_studio_model="test-model",
    )
    defaults.update(kwargs)
    return Settings(**defaults)  # type: ignore[arg-type]


def _make_completion(content: str) -> MagicMock:
    completion = MagicMock()
    completion.choices[0].message.content = content
    return completion


@pytest.fixture
def settings() -> Settings:
    return _settings()


@pytest.fixture
def mock_openai():
    with patch("app.services.llm_client.AsyncOpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        yield mock_instance


async def test_chat_returns_assistant_reply(settings: Settings, mock_openai: MagicMock) -> None:
    mock_openai.chat.completions.create = AsyncMock(return_value=_make_completion("Hello!"))

    client = LLMClient(settings=settings)
    result = await client.chat("Hi there")

    assert result == "Hello!"
    mock_openai.chat.completions.create.assert_awaited_once()


async def test_chat_uses_model_from_settings(settings: Settings, mock_openai: MagicMock) -> None:
    mock_openai.chat.completions.create = AsyncMock(return_value=_make_completion("ok"))

    client = LLMClient(settings=settings)
    await client.chat("test")

    call_kwargs = mock_openai.chat.completions.create.call_args
    assert call_kwargs.kwargs["model"] == "test-model"


async def test_chat_without_history_sends_system_and_user(
    settings: Settings, mock_openai: MagicMock
) -> None:
    mock_openai.chat.completions.create = AsyncMock(return_value=_make_completion("Hi"))

    client = LLMClient(settings=settings)
    await client.chat("Hello")

    messages = mock_openai.chat.completions.create.call_args.kwargs["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "Hello"}


async def test_chat_includes_history(settings: Settings, mock_openai: MagicMock) -> None:
    mock_openai.chat.completions.create = AsyncMock(return_value=_make_completion("Response"))

    history = [
        {"role": "user", "content": "prev"},
        {"role": "assistant", "content": "ans"},
    ]
    client = LLMClient(settings=settings)
    await client.chat("Follow-up", history=history)

    messages = mock_openai.chat.completions.create.call_args.kwargs["messages"]
    assert len(messages) == 4  # system + 2 history + user
    assert messages[0]["role"] == "system"
    assert messages[1:3] == history
    assert messages[3] == {"role": "user", "content": "Follow-up"}


async def test_chat_raises_llm_connection_error_on_api_connection_error(
    settings: Settings, mock_openai: MagicMock
) -> None:
    mock_openai.chat.completions.create = AsyncMock(
        side_effect=APIConnectionError(request=httpx.Request("POST", "http://localhost"))
    )

    client = LLMClient(settings=settings)
    with pytest.raises(LLMConnectionError):
        await client.chat("Hello")


async def test_chat_empty_transcript_sends_empty_user_message(
    settings: Settings, mock_openai: MagicMock
) -> None:
    mock_openai.chat.completions.create = AsyncMock(return_value=_make_completion(""))

    client = LLMClient(settings=settings)
    result = await client.chat("")

    messages = mock_openai.chat.completions.create.call_args.kwargs["messages"]
    assert messages[-1] == {"role": "user", "content": ""}
    assert result == ""


async def test_chat_preserves_unicode_transcript_and_history(
    settings: Settings, mock_openai: MagicMock
) -> None:
    mock_openai.chat.completions.create = AsyncMock(
        return_value=_make_completion("这是一个测试回复。")
    )

    history = [
        {"role": "user", "content": "上一轮问题：请用中文回答。"},
        {"role": "assistant", "content": "好的，我会使用中文。"},
    ]
    transcript = "请解释一下这个错误日志。"

    client = LLMClient(settings=settings)
    result = await client.chat(transcript, history=history)

    messages = mock_openai.chat.completions.create.call_args.kwargs["messages"]
    assert messages[1:3] == history
    assert messages[3] == {"role": "user", "content": transcript}
    assert result == "这是一个测试回复。"
