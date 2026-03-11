from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import whisper
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.ws.audio import router as ws_audio_router

settings = get_settings()

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load Whisper model once at startup; release on shutdown."""
    logger.info("Loading Whisper model '%s'…", settings.whisper_model)
    app.state.whisper_model = whisper.load_model(settings.whisper_model)
    app.state.settings = settings
    logger.info("Whisper model loaded.")
    yield
    logger.info("Backend shutting down.")


def create_app() -> FastAPI:
    app = FastAPI(title="speak-to-llm backend", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(ws_audio_router)

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "whisper_model": settings.whisper_model}

    return app


app = create_app()
