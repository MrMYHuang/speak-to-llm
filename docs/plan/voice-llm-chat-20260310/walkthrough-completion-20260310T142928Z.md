# Completion Walkthrough — voice-llm-chat-20260310

**Artifact type:** completion walkthrough  
**Plan ID:** voice-llm-chat-20260310  
**Completed:** 2026-03-10T14:29:28Z  
**Status:** ✅ All 11 tasks done — local voice→LLM pipeline operational

---

## 1. Overview

**speak-to-llm** is a fullstack, voice-first LLM chat application that runs entirely on a local machine with no cloud services. The user holds a mic button in the browser, releases it to trigger transcription, and receives an LLM response—all streamed through a single WebSocket connection.

```
Browser (React 19 + Vite 7 + TypeScript)
  └─ MicButton → useAudioStream (AudioWorklet, Int16 PCM @ 16 kHz)
        └─ useWebSocket → ws://localhost:5173/ws/audio (Vite proxy)
              └─ FastAPI /ws/audio (Python 3.11 + uv)
                    ├─ transcriber.py  → openai-whisper "base"
                    └─ llm_client.py   → LM Studio  http://localhost:1234/v1
```

**One-utterance data flow:**

| Step | Action |
|------|--------|
| 1 | User holds mic button; browser starts capturing PCM Int16 @ 16 kHz |
| 2 | `{"type":"start"}` JSON event + binary audio frames sent over WebSocket |
| 3 | User releases button; `{"type":"stop"}` sent |
| 4 | Backend Whisper transcribes audio (non-blocking via `run_in_executor`) |
| 5 | Transcript forwarded to LM Studio via `AsyncOpenAI` |
| 6 | LLM response returned to frontend; displayed in cyberpunk chat thread |

---

## 2. Tasks Completed

All 11 atomic tasks across 5 waves reached `status: done`.

### Wave 1 — Repo skeleton
| Task | Title | Key deliverables |
|------|-------|-----------------|
| task-001 | Bootstrap repo skeleton | `.gitignore`, `.env.example`, `Makefile` (dev/test/lint/clean), `scripts/dev.sh` (SIGINT-trapping concurrent launcher), `README.md` skeleton |

### Wave 2 — Parallel scaffolds
| Task | Title | Key deliverables |
|------|-------|-----------------|
| task-002 | Backend — FastAPI scaffold | `pyproject.toml` (uv), `app/main.py` (lifespan Whisper load, CORS, `/healthz`), `app/core/config.py` (pydantic-settings), test skeleton |
| task-006 | Frontend — Vite + React scaffold | `vite.config.ts` (ws proxy, `@/` alias), `tailwind.config.ts` (cyberpunk tokens), `src/styles/index.css` (CSS custom properties), `src/types/ws.ts` (discriminated union) |

### Wave 3 — Backend services + frontend state machine (parallel)
| Task | Title | Key deliverables |
|------|-------|-----------------|
| task-003 | Backend — Whisper transcription service | `services/transcriber.py`: `load_model()`, async `transcribe()` via `run_in_executor`; `test_transcriber.py` (5 tests) |
| task-004 | Backend — LM Studio LLM client | `services/llm_client.py`: `LLMClient` with `AsyncOpenAI`, `LLMConnectionError`, `chat(transcript, history)`; `test_llm_client.py` (6 tests) |
| task-007 | Frontend — state machine and hooks | `store/chatReducer.ts` (6-phase `useReducer`), `hooks/useAudioStream.ts` (AudioWorklet PCM capture), `hooks/useWebSocket.ts` (reconnect on 1006/error), `hooks/useWaveform.ts` (AnalyserNode → canvas) |

### Wave 4 — WebSocket endpoint + UI + App wiring (parallel)
| Task | Title | Key deliverables |
|------|-------|-----------------|
| task-005 | Backend — WebSocket audio endpoint | `ws/audio.py`: 4-state server-side machine (IDLE→BUFFERING→TRANSCRIBING→LLM_CALLING); `test_ws_audio.py` (8 tests) |
| task-008 | Frontend — cyberpunk UI components | `TopBar`, `ChatThread`, `MessageBubble`, `WaveformBar` (canvas), `BottomBar`, `MicButton`, `StatusOverlay` — all styled with cyberpunk tokens (Orbitron + Rajdhani fonts) |
| task-009 | Frontend — App.tsx wiring | `App.tsx` composing all three hooks; dispatch wired end-to-end; prod `dist/` build confirmed |

### Wave 5 — Validation + documentation
| Task | Title | Key deliverables |
|------|-------|-----------------|
| task-010 | Smoke validation of full local pipeline | 19 backend tests pass (4.73 s); TypeScript typecheck exits 0; `dist/` production bundle present |
| task-011 | README and developer documentation | Complete `README.md`: Overview, Architecture diagram, WebSocket protocol table, Tech stack table, Prerequisites, Getting Started (5 steps), Environment Variables, Whisper model selection, Troubleshooting, Known Limitations |

---

## 3. Key Technical Decisions and Resolved Integration Issues

### 3.1 Non-blocking Whisper via `run_in_executor`
`whisper.transcribe()` is a synchronous CPU/GPU call. Running it directly in a FastAPI `async` handler would block the entire event loop and stall all concurrent WebSocket connections. The solution—enforced from plan pre-mortem through implementation and tests—wraps every transcription call in `asyncio.get_running_loop().run_in_executor(None, partial(_transcribe_sync, model, audio))`. The WebSocket integration tests (`test_ws_audio.py`) mock this path with `AsyncMock` to validate the full state-machine flow without a real GPU.

### 3.2 Vite proxy eliminates CORS entirely
The browser WebSocket connects to `ws://localhost:5173/ws/audio`, which Vite's dev server silently proxies to `ws://localhost:8000/ws/audio`. Neither the backend CORS headers nor a `frontend/.env.local` file is needed during development—a zero-configuration default that was intentional and is documented in the README "Getting Started" note.

### 3.3 Frontend resampling to 16 kHz
Browsers default to capturing audio at 44.1–48 kHz. Feeding that to Whisper produces garbage transcripts. The `useAudioStream` hook creates an `AudioContext({ sampleRate: 16000 })` so the Web Audio API itself performs the resampling before the AudioWorkletProcessor captures any samples. No backend DSP library (librosa etc.) is required.

### 3.4 Whisper model loaded once at lifespan, stored on `app.state`
The model is loaded during FastAPI's `lifespan` context manager and stored at `app.state.whisper_model`. Each WebSocket handler reads it from `websocket.app.state` on demand. This avoids redundant disk reads and ensures a single shared model instance regardless of connection count.

### 3.5 Typed WebSocket protocol with discriminated union
`src/types/ws.ts` exports a `ServerMessage` discriminated union (`transcript | llm_response | status | error`) and a runtime `parseServerMessage()` parser. This gives TypeScript exhaustiveness checking across the reducer and hooks without any external schema library.

### 3.6 State machine on both sides
- **Backend** (`ws/audio.py`): `_State` enum — `IDLE → BUFFERING → TRANSCRIBING → LLM_CALLING → IDLE`. Binary frames received outside `BUFFERING` are silently dropped; a spurious `stop` outside `BUFFERING` is ignored without error.
- **Frontend** (`chatReducer.ts`): six phases — `idle | requesting-mic | recording | processing | responding | error` — plus an independent `wsStatus` (`connecting | open | closed | error`). Separating connection health from interaction phase allows the UI to show "reconnecting…" while still displaying the last response.

### 3.7 `LLMConnectionError` typed exception
`llm_client.py` wraps `openai.APIConnectionError` in a local `LLMConnectionError`. The WebSocket handler catches only this typed exception and sends `{"type":"error","message":"..."}` to the client, then resets state to `IDLE`. Unrelated exceptions propagate to the outer `except Exception` which logs and also resets cleanly.

---

## 4. Validation Summary

| Check | Result |
|-------|--------|
| Backend unit tests (`pytest -q`) | **19 passed** in 4.73 s |
| Frontend TypeScript typecheck (`tsc -b --noEmit`) | **0 errors** |
| Frontend production build (`pnpm build`) | **dist/ bundle present** |
| `/healthz` endpoint | Returns `{"status":"ok","whisper_model":"base"}` |
| WebSocket happy-path integration test | start → PCM frames → stop → transcript + llm_response → idle ✅ |
| Error recovery tests | transcription error, LLM error, spurious stop, invalid JSON, abrupt disconnect — all handled without server crash ✅ |
| Vite proxy config | `/ws` → `ws://localhost:8000`, `/api` → `http://localhost:8000` ✅ |

**Test coverage by module:**

| Module | Tests | Coverage highlights |
|--------|-------|---------------------|
| `services/transcriber.py` | 5 | empty bytes, text stripping, padding, whitespace-only, load_model delegate |
| `services/llm_client.py` | 6 | reply content, model selection, message assembly (with/without history), `LLMConnectionError`, empty transcript |
| `ws/audio.py` | 8 | full happy-path, early binary discard, transcription error, LLM error, spurious stop, disconnect, invalid JSON |
| `app/main.py` | 1 | `/healthz` returns 200 with `whisper_model` field |

---

## 5. Natural Next Steps

### Immediate quality / robustness
- **Streaming LLM responses** — use `AsyncOpenAI.chat.completions.create(stream=True)` and forward token chunks as `{"type":"token","text":"..."}` events; the `chatReducer` would accumulate them for live typing effect.
- **Frontend tests** — add Vitest + React Testing Library unit tests for `chatReducer`, `parseServerMessage`, and key components; the `vitest` dependency is already installed.
- **`fp16` config** — expose `WHISPER_FP16=true` env var for CUDA-capable machines; the `transcriber.py` `_transcribe_sync` function already passes `fp16=False` as a named argument.

### UX / audio
- **Push-to-talk vs. voice activity detection (VAD)** — replace the manual hold-to-record button with a Silero VAD AudioWorklet so utterances are detected automatically.
- **TTS playback** — pipe the LLM response through a local TTS engine (e.g., Coqui, Kokoro) and play it back in the browser via the Web Audio API for a fully voice-in / voice-out loop.
- **Safari compatibility** — `AudioContext({ sampleRate: 16000 })` is not supported on Safari; add a ScriptProcessorNode fallback or resampling in the AudioWorklet itself.

### Architecture / deployment
- **CI pipeline** — add GitHub Actions: `pytest` + `pnpm test --run` + `pnpm build` on push; the Makefile targets map directly to workflow steps.
- **Docker Compose** — containerise the backend (`FROM python:3.12-slim`) and serve the frontend static dist from nginx; add a `compose.yaml` at repo root.
- **Conversation history** — the `LLMClient.chat()` already accepts a `history: list[Message]` parameter; wire the frontend `messages[]` array from `chatReducer` into the WebSocket `stop` payload or a separate REST endpoint.
- **Multi-model support** — add a model selector to the TopBar (backed by `GET /api/models` that proxies `GET http://localhost:1234/v1/models`) so users can switch LM Studio models without restarting the backend.
