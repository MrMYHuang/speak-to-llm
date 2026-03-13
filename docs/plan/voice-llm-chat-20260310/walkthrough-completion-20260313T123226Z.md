# Completion Walkthrough — Toggle-Button Follow-up Wave

**Audience:** developers  
**Completed:** 2026-03-13T12:32:26Z  
**Scope:** frontend follow-up wave for non-blocking start/stop recording UX

## 1. Original feedback

The follow-up request was to replace hold-to-speak with a true toggle button: first press starts capture, second press stops capture and sends the utterance. The wave explicitly kept the existing frontend reducer model and the websocket `start` / `stop` contract unchanged.

## 2. Frontend implementation summary

The implementation stays in the existing frontend boundary and does not change backend protocol behavior.

- `frontend/src/App.tsx`
  - adds a single `handleMicToggle()` path
  - starts recording from `idle`, `responding`, or `error`
  - stops recording whenever `captureState` shows an active or starting capture
  - derives `controlPhase` from hook-owned capture state so the button reflects the real mic lifecycle, not only reducer phase
- `frontend/src/components/BottomBar.tsx`
  - replaces separate press-start / press-end props with one toggle callback
- `frontend/src/components/MicButton.tsx`
  - moves from pointer/key hold semantics to normal button click semantics
  - updates copy to `Start recording`, `Cancel recording`, and `Stop recording`
  - exposes correct `aria-pressed` state while mic startup or recording is active
  - keeps `processing` disabled so the completion path stays non-blocking once audio is sent
- `frontend/src/hooks/useAudioStream.ts`
  - now exposes `captureState: 'idle' | 'starting' | 'recording'`
  - adds session and lifecycle guards (`sessionIdRef`, `isStartingRef`, `isRecordingRef`) so repeated DOM events do not duplicate side effects
  - supports cancelling an in-flight microphone request via `MIC_CANCELLED`
  - guarantees only one websocket `start` and one websocket `stop` are emitted per capture session
- `frontend/src/store/chatReducer.ts`
  - updates comments and action docs from push-to-talk wording to toggle wording
  - accepts `MIC_CANCELLED`
  - allows a fresh recording request from `error`, matching the new retry path

## 3. Race-condition fix: websocket error during active capture

The key non-blocking fix is the separation between reducer phase and live capture state.

Previously, a websocket error could force the reducer into `error` while the microphone was still active. That made the UI look restartable even though capture had not actually stopped yet. The follow-up wave fixes that by letting `App.tsx` prefer `useAudioStream`'s `captureState` when deciding the button phase, so an active capture still renders as `requesting-mic` or `recording` and the next press still calls `stopRecording()`. This keeps the user on a safe stop/cancel path even if `WS_ERROR` lands mid-capture.

## 4. Tests added / updated

Focused frontend regression coverage was added in:

- `frontend/src/App.toggle.test.tsx`
  - pointer click toggles start → stop without duplicate side effects
  - keyboard `Enter` / `Space` follow the same toggle contract
  - active capture can still be stopped after a reducer-level `WS_ERROR`
- `frontend/src/hooks/useAudioStream.test.tsx`
  - duplicate start requests are ignored while mic startup is in flight
  - an in-flight mic request can be cancelled cleanly without sending start frames
  - duplicate stop calls emit only one websocket stop event and one reducer stop action

Supporting test dependencies were also added in `frontend/package.json` / `frontend/pnpm-lock.yaml` for Testing Library and `jsdom`.

## 5. Final validation results

Source parity was verified against:

- `docs/plan/voice-llm-chat-20260310/plan.yaml`
- `frontend/src/App.tsx`
- `frontend/src/components/BottomBar.tsx`
- `frontend/src/components/MicButton.tsx`
- `frontend/src/hooks/useAudioStream.ts`
- `frontend/src/store/chatReducer.ts`
- `frontend/src/App.toggle.test.tsx`
- `frontend/src/hooks/useAudioStream.test.tsx`

Validation commands run:

```bash
cd frontend && pnpm vitest run src/App.toggle.test.tsx src/hooks/useAudioStream.test.tsx
cd frontend && pnpm typecheck
```

Results:

- `vitest`: **2 files passed, 6 tests passed**
- `typecheck`: **passed**

This validates the toggle interaction contract, the duplicate-event guards, the websocket-error stop path, and TypeScript correctness for the frontend delta.

## 6. Next-step monitoring notes

- Watch for browser logs showing repeated `[audio] ignored duplicate start request` or `[audio] ignored duplicate stop request`; occasional hits are expected, but frequent hits may indicate noisy DOM interaction paths.
- If users report being stuck after disconnects, capture the browser websocket close/error sequence together with whether the mic button was in `requesting-mic` or `recording` when the socket failed.
- Backend monitoring does not need new protocol checks for this wave because the websocket message contract stayed the same.
