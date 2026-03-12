# speak-to-llm

> Voice-first LLM chat — speak into your browser, get an AI response back.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Whisper Model Selection](#whisper-model-selection)
- [Development](#development)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)

---

## Overview

**speak-to-llm** streams microphone audio from the browser over a WebSocket,
transcribes it with [openai-whisper](https://github.com/openai/whisper), sends the
latest transcript plus prior in-session chat turns to a locally-running
[LM Studio](https://lmstudio.ai/) model, and returns the response to a
cyberpunk-styled React UI — everything runs entirely on your machine, no cloud
services required.

**Data flow (one utterance):**

```
1. Hold mic button  →  browser captures PCM Int16 @ 16 kHz
2. Release button   →  backend transcribes with Whisper
3. Transcript sent  →  LM Studio returns assistant reply
4. Reply received   →  UI displays response in chat thread
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser  (React 19 + Vite 7 + TypeScript)  │
│                                             │
│  MicButton ──► useAudioStream               │
│                  │  AudioWorklet            │
│                  │  Float32 → Int16 PCM     │
│                  ▼                          │
│              useWebSocket ─── ws://…/ws/audio│
│                  ▲                          │
│  ChatThread ◄── chatReducer (useReducer)    │
└───────────────────────┬─────────────────────┘
          WebSocket     │  binary PCM frames + JSON events
┌───────────────────────▼─────────────────────┐
│  FastAPI backend  (Python ≥ 3.11 + uv)      │
│                                             │
│  /ws/audio  ─► state machine                │
│     IDLE → BUFFERING → TRANSCRIBING         │
│                       → LLM_CALLING → IDLE  │
│                                             │
│  Transcriber service                        │
│    run_in_executor(whisper.transcribe)      │
│                                             │
│  LLMClient (AsyncOpenAI)                    │
│    POST http://localhost:1234/v1/chat/…     │
└─────────────────────────────────────────────┘
          OpenAI-compat REST
┌─────────────────────────────────────────────┐
│  LM Studio  (local model server)            │
│  GET/POST  http://localhost:1234/v1         │
└─────────────────────────────────────────────┘
```

### WebSocket protocol

The client and server exchange lightweight JSON control events alongside raw binary
audio frames.

**Client → server**

| Message                                                          | When                          |
|------------------------------------------------------------------|-------------------------------|
| `{"type":"start","sample_rate":16000,"encoding":"pcm_int16"}`   | Mic button pressed            |
| Binary `ArrayBuffer` of Int16 PCM samples                       | Each AudioWorklet render frame |
| `{"type":"stop"}`                                               | Mic button released           |

**Server → client**

| Message                                    | Meaning                            |
|--------------------------------------------|------------------------------------|
| `{"type":"status","state":"buffering"}`    | Recording started                  |
| `{"type":"status","state":"transcribing"}` | Running Whisper                    |
| `{"type":"status","state":"thinking"}`     | Waiting for LLM reply              |
| `{"type":"status","state":"idle"}`         | Cycle complete, ready for next     |
| `{"type":"transcript","text":"…"}`         | Whisper transcription result       |
| `{"type":"llm_response","text":"…"}`       | LLM assistant reply                |
| `{"type":"error","message":"…"}`           | Any recoverable error              |

### Tech stack

| Layer     | Technology                                             |
|-----------|--------------------------------------------------------|
| Frontend  | React 19, Vite 7, TypeScript, Tailwind CSS             |
| Backend   | Python ≥ 3.11, uv, FastAPI, uvicorn, openai-whisper   |
| LLM       | LM Studio (OpenAI-compatible `/v1` endpoint)           |
| Transport | WebSocket — binary PCM + JSON control frames           |
| Audio     | Web Audio API + inline `AudioWorkletProcessor` (no extra bundled asset) |

---

## Prerequisites

| Tool       | Version   | Purpose                               | Install                          |
|------------|-----------|---------------------------------------|----------------------------------|
| Node.js    | ≥ 20      | Frontend runtime                      | https://nodejs.org               |
| pnpm       | ≥ 9       | JS package manager                    | `npm i -g pnpm`                  |
| Python     | ≥ 3.11    | Backend runtime                       | https://python.org               |
| uv         | ≥ 0.4     | Python package / venv manager         | `pip install uv` or see uv docs  |
| LM Studio  | latest    | Local LLM server with OpenAI API      | https://lmstudio.ai              |
| ffmpeg     | any       | Audio decoding required by Whisper    | `brew install ffmpeg` / `apt install ffmpeg` |

> **macOS / Linux only** — `scripts/dev.sh` uses bash. Windows users should run
> inside WSL 2 or start backend and frontend manually.

---

## Getting Started

### 1. Clone and configure

```bash
git clone https://github.com/your-org/speak-to-llm.git
cd speak-to-llm

# Copy env template; edit values if needed
cp .env.example .env
```

> **Note:** The Vite dev server proxies `/ws/*` → `ws://localhost:8000` and
> `/api/*` → `http://localhost:8000`, so you do **not** need a separate
> `frontend/.env.local` for local development — the defaults work out of the box.

### 2. Install dependencies

```bash
make install
```

This runs `uv sync` (backend) and `pnpm install` (frontend) in one step.

### 3. ⚠️ Pre-download the Whisper model

**Do this before `make dev`.** The first time the backend starts it calls
`whisper.load_model(WHISPER_MODEL)`, which downloads model weights from the internet
if they are not already cached. On a slow connection this can take several minutes and
*will* make the initial `make dev` appear to hang.

Download the model ahead of time:

```bash
# Default model (base, ~74 MB):
cd backend && uv run python -c "import whisper; whisper.load_model('base')"

# Or whichever size you set in .env (see Whisper Model Selection below):
cd backend && uv run python -c "import whisper; whisper.load_model('small')"
```

Models are cached in `~/.cache/whisper/` and only downloaded once.

### 4. Start LM Studio

1. Open LM Studio and load any chat model.
2. Go to **Local Server** (the `↔` icon) and click **Start Server**.  
   The server should be listening on `http://localhost:1234`.
3. Confirm the model identifier shown in LM Studio matches `LM_STUDIO_MODEL` in
   your `.env` (or update the env var to match).

You can verify connectivity:

```bash
curl http://localhost:1234/v1/models
```

### 5. Start the app

```bash
make dev
```

`scripts/dev.sh` launches both the FastAPI backend (uvicorn with `--reload`) and the
Vite dev server concurrently. Press **Ctrl-C** to stop both.

Open **<http://localhost:5173>** in your browser and allow microphone access when
prompted. Hold the mic button to speak, release to transcribe.

You can also verify the backend is healthy independently:

```bash
curl http://localhost:8000/healthz
# {"status":"ok","whisper_model":"base"}
```

---

## Environment Variables

All variables live in [`.env.example`](.env.example) — that file is the authoritative
reference. Copy it to `.env` at the repo root before running the app.

| Variable             | Default                        | Description                                            |
|----------------------|--------------------------------|--------------------------------------------------------|
| `VITE_WS_URL`        | `ws://localhost:8000/ws/audio` | WebSocket URL used by the browser (Vite proxies this in dev) |
| `VITE_APP_TITLE`     | `speak-to-llm`                 | Browser tab / app title                                |
| `LM_STUDIO_BASE_URL` | `http://localhost:1234/v1`     | LM Studio OpenAI-compatible base URL                   |
| `LM_STUDIO_MODEL`    | `local-model`                  | Model identifier as reported by LM Studio              |
| `WHISPER_MODEL`      | `base`                         | Whisper model size (`tiny`/`base`/`small`/`medium`/`large`) |
| `BACKEND_HOST`       | `0.0.0.0`                      | Uvicorn bind host                                      |
| `BACKEND_PORT`       | `8000`                         | Uvicorn bind port                                      |
| `CORS_ORIGINS`       | `http://localhost:5173`        | Allowed CORS origins, comma-separated                  |
| `LOG_LEVEL`          | `INFO`                         | Python log level (`DEBUG`/`INFO`/`WARNING`/`ERROR`)    |

> **`VITE_*` variables** are read by Vite at build time from `.env` in the repo root
> when using the Vite proxy. If you ever build the frontend for production or run it
> without the Vite proxy, copy the `VITE_*` lines into `frontend/.env.local` as well.

---

## Whisper Model Selection

The `WHISPER_MODEL` environment variable controls which OpenAI Whisper checkpoint the
backend loads at startup. Choose based on your hardware and acceptable latency.

| Model    | Parameters | Download  | VRAM (approx.) | Relative speed | English WER | Recommended for        |
|----------|-----------|-----------|-----------------|----------------|-------------|------------------------|
| `tiny`   | 39 M      | ~75 MB    | ~1 GB           | ~10×           | ~14%        | Very fast machines or rapid prototyping |
| `base`   | 74 M      | ~145 MB   | ~1 GB           | ~7×            | ~11%        | **Default** — good balance on most laptops |
| `small`  | 244 M     | ~483 MB   | ~2 GB           | ~4×            | ~9%         | Noticeably better accuracy, still fast |
| `medium` | 769 M     | ~1.5 GB   | ~5 GB           | ~2×            | ~8%         | High accuracy; needs a mid-range GPU  |
| `large`  | 1550 M    | ~3 GB     | ~10 GB          | 1×             | ~7%         | Best accuracy; requires a capable GPU |

> WER figures are approximate and vary by accent and recording conditions.  
> Speed multipliers are relative to `large` on a typical dev machine.

To change the model:

```bash
# In .env:
WHISPER_MODEL=small

# Then pre-download before restarting:
cd backend && uv run python -c "import whisper; whisper.load_model('small')"
```

The backend logs the loaded model name at startup:

```
INFO  Loading Whisper model 'small'…
INFO  Whisper model loaded.
```

---

## Development

```bash
make dev            # start backend + frontend together (Ctrl-C stops both)
make backend        # start backend only  (uvicorn --reload)
make frontend       # start frontend only (Vite dev server)
make install        # install all dependencies
make lint           # ruff (Python) + eslint (TypeScript)
make typecheck      # tsc --noEmit (frontend only)
make test           # pytest (backend) + vitest --run (frontend)
make clean          # remove build artefacts and caches
```

The Vite dev server proxies:
- `/ws/*`  →  `ws://localhost:8000`
- `/api/*` →  `http://localhost:8000`

No CORS configuration is needed during local development.

---

## Project Structure

```
speak-to-llm/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app factory + Whisper lifespan
│   │   ├── core/config.py        # pydantic-settings env var schema
│   │   ├── services/
│   │   │   ├── transcriber.py    # async Whisper wrapper (run_in_executor)
│   │   │   └── llm_client.py     # AsyncOpenAI → LM Studio
│   │   └── ws/audio.py           # /ws/audio state machine endpoint
│   ├── tests/                    # pytest test suite
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/           # UI components (MicButton, ChatThread, …)
│   │   ├── hooks/
│   │   │   ├── useAudioStream.ts # mic capture + AudioWorklet (PCM Int16)
│   │   │   ├── useWebSocket.ts   # WS lifecycle + auto-reconnect
│   │   │   └── useWaveform.ts    # AnalyserNode → waveform visualisation
│   │   ├── store/chatReducer.ts  # useReducer state machine
│   │   └── types/ws.ts           # server message type definitions
│   ├── vite.config.ts            # Vite proxy configuration
│   └── package.json
├── docs/plan/                    # Architecture artefacts and research
├── scripts/dev.sh                # Concurrent dev-server launcher (bash)
├── .env.example                  # Authoritative env var reference
├── Makefile                      # Developer workflow commands
└── README.md
```

---

## Troubleshooting

### Backend fails to start / Whisper hangs on first run

**Symptom:** `make dev` appears stuck for a long time; backend logs show  
`Loading Whisper model 'base'…` and then nothing.

**Cause:** Whisper is downloading the model weights on first use.

**Fix:** Pre-download the model before starting the app (see
[step 3 in Getting Started](#3--pre-download-the-whisper-model)).

---

### `LLMConnectionError` / LLM response never arrives

**Symptom:** The chat overlay shows an error, backend logs contain
`LLM connection error: …`.

**Causes and fixes:**

1. LM Studio is not running — open LM Studio and click **Start Server**.
2. No model is loaded in LM Studio — load a model first.
3. `LM_STUDIO_BASE_URL` is wrong — default is `http://localhost:1234/v1`.
4. `LM_STUDIO_MODEL` doesn't match the loaded model name — check the identifier
   shown in LM Studio's Local Server tab and update your `.env`.

Verify with:

```bash
curl http://localhost:1234/v1/models
```

---

### Microphone access denied

**Symptom:** Clicking the mic button shows an error; browser console shows
`NotAllowedError` or `NotFoundError`.

**Fix:**
- Ensure the browser has microphone permission for `localhost` (check site settings).
- Reload the page after granting permission.
- On macOS, check **System Settings → Privacy & Security → Microphone**.

---

### Transcript is empty or garbled

**Symptom:** Whisper returns an empty string or nonsense text.

**Causes and fixes:**

1. **Wrong sample rate** — the frontend AudioWorklet captures at the browser's native
   rate and resamples to 16 kHz before sending PCM. If the browser does not support
   `AudioContext` at `{sampleRate: 16000}`, audio arrives at the wrong rate.
   Check browser console for `AudioContext` errors.
2. **Too short an utterance** — Whisper pads to a 30-second window; very short
   recordings (< 1 second) may not produce output. Speak for at least 2 seconds.
3. **Model too small** — try a larger `WHISPER_MODEL` (e.g. `small` instead of `base`).
4. **ffmpeg missing** — Whisper requires ffmpeg for audio decoding.
   Run `ffmpeg -version` to confirm it is installed.

---

### WebSocket connects then immediately drops

**Symptom:** The status indicator flickers connecting → open → closed repeatedly.

**Cause:** The backend crashed on startup (e.g. Whisper model not found, missing
dependency).

**Fix:** Run `make backend` in a separate terminal to see the full uvicorn output and
stack trace.

---

### `make dev` — `uv: command not found`

Install uv:

```bash
pip install uv
# or on macOS:
brew install uv
```

---

### `make dev` — `pnpm: command not found`

Install pnpm:

```bash
npm install -g pnpm
```

---

## Known Limitations

| Limitation | Detail |
|---|---|
| **Safari partial support** | `MediaRecorder` MIME type negotiation may fail on Safari; the hook falls back gracefully with a user-visible error. Use Chrome or Firefox for the best experience. |
| **Single-turn only** | The LLM client sends each transcript as a fresh single-user message with a fixed system prompt. Conversation history is not preserved across turns. |
| **No streaming LLM replies** | The backend awaits the full `chat.completions.create` response before sending `llm_response`. Long answers have noticeable latency. |
| **No speaker diarisation** | All audio is treated as a single speaker; there is no multi-speaker support. |
| **Local only** | There is no authentication, TLS, or multi-user support. The app is designed for single-developer local use. |
| **Whisper blocks CPU** | Transcription runs in a thread executor; on a busy machine large models can produce noticeable latency between speaking and seeing the transcript. |
| **Windows not natively supported** | `scripts/dev.sh` requires bash. Use WSL 2 or start services manually with `make backend` and `make frontend`. |

---

## Contributing

1. Fork the repo and create a feature branch.
2. Follow the existing code style — `ruff` for Python, `eslint` for TypeScript.
3. Add or update tests for your changes (`make test` must pass).
4. Open a pull request with a clear description of what changed and why.
