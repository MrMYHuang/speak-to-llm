from __future__ import annotations

from openai import APIConnectionError, AsyncOpenAI

from app.core.config import Settings, get_settings

Message = dict[str, str]

SYSTEM_PROMPT = "You are a helpful assistant. Respond concisely."


class LLMConnectionError(Exception):
    """Raised when the LLM service cannot be reached."""


class LLMClient:
    def __init__(self, settings: Settings | None = None) -> None:
        cfg = settings or get_settings()
        self._model = cfg.lm_studio_model
        self._client = AsyncOpenAI(
            base_url=cfg.lm_studio_base_url,
            api_key="lm-studio",
        )

    async def chat(
        self,
        transcript: str,
        history: list[Message] | None = None,
    ) -> str:
        messages: list[Message] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": transcript})

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,  # type: ignore[arg-type]
            )
        except APIConnectionError as exc:
            raise LLMConnectionError(str(exc)) from exc

        return response.choices[0].message.content or ""
