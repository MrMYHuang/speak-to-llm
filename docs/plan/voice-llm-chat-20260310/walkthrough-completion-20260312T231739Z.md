# WebSocket Bugfix Walkthrough — voice-llm-chat-20260310

**Audience:** developers  
**Completed:** 2026-03-12T23:17:39Z  
**Scope:** backend-only websocket bugfix and regression coverage

## 1. Original symptom and observed logs

The bug wave investigated a disconnect that happened while the backend was sending `llm_response` from `/ws/audio`. Research notes and the current websocket instrumentation agree on the important detail: the handler is still in `LLM_CALLING` until the `llm_response` send completes, so a send-time disconnect naturally logs as a disconnect during `LLM_CALLING`, not as a post-send idle transition.

Representative observed/verified log shapes from `backend/app/ws/audio.py` and `backend/tests/test_ws_audio.py`:

```text
[ws:<id>] sending type=llm_response payload_bytes=<n> state=LLM_CALLING
[ws:<id>] disconnect during send type=llm_response payload_bytes=<n> state=LLM_CALLING
[ws:<id>] client disconnected state=LLM_CALLING buffered_chunks=<n> history_messages=<n>
```

The investigation also preserved the original context that the suspect payload was only about 5.6 KB, which is small for a WebSocket text frame.

## 2. Research conclusion

The research outcome was: **peer/client close is more likely than a Unicode encoding failure**.

Why:

- `backend/app/ws/audio.py` still sends JSON with `json.dumps(..., ensure_ascii=False)`, so native Unicode delivery remains intentional.
- Existing and current tests show CJK, Cyrillic, and emoji payloads round-trip correctly over the websocket path.
- Frontend websocket consumption parses JSON and dispatches it; it does not close based on `<think>` tags or Unicode content.
- The missing coverage before this bugfix was the race where the peer closes during `websocket.send_text(...)`.

## 3. Backend fix implemented

The implemented fix is minimal and backend-only in `backend/app/ws/audio.py`:

1. Add `sanitize_llm_reply(text: str) -> str`.
2. Remove complete `<think>...</think>` blocks with a regex.
3. If a malformed/open-ended `<think` remains, truncate everything from that point onward.
4. Persist the **sanitized** assistant reply into `conversation_history`.
5. Send the **sanitized** reply as `llm_response`.
6. Keep the websocket send path Unicode-safe and otherwise unchanged:

```python
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
```

The sanitizer behavior is:

```python
_THINK_BLOCK_PATTERN = re.compile(r"<think\b[^>]*>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_OPEN_PATTERN = re.compile(r"<think", re.IGNORECASE)

def sanitize_llm_reply(text: str) -> str:
    sanitized = _THINK_BLOCK_PATTERN.sub("", text)
    malformed_open_match = _THINK_OPEN_PATTERN.search(sanitized)
    if malformed_open_match is None:
        return sanitized
    return sanitized[: malformed_open_match.start()]
```

This means the backend now strips hidden reasoning both for well-formed tags and for malformed/open-ended `<think>` output, while preserving visible Unicode text around those tags.

## 4. Tests added/updated

The bugfix wave is covered in backend tests, primarily `backend/tests/test_ws_audio.py`, with one supporting LLM client test in `backend/tests/test_llm_client.py`.

Added/updated coverage includes:

- `test_large_sanitized_unicode_llm_response_round_trip_over_websocket`
  - verifies a large mixed-language reply is sanitized before send
  - confirms visible Chinese/Cyrillic/emoji text is preserved
- `test_sanitize_llm_reply_suppresses_think_blocks_and_preserves_unicode`
  - verifies normal `<think>...</think>` removal
- `test_sanitize_llm_reply_truncates_open_ended_think_blocks`
  - verifies malformed/open-ended `<think>` truncation
- `test_llm_response_suppresses_think_blocks_and_history_uses_sanitized_reply`
  - verifies sent reply and stored history stay in parity
- `test_open_ended_think_block_is_truncated_in_websocket_response_and_history`
  - verifies malformed tag handling for both websocket output and persisted history
- `test_disconnect_during_llm_response_send_uses_existing_disconnect_path`
  - simulates peer close during `llm_response` send
  - verifies the server exits through the existing disconnect path and logs the event
- `test_chat_preserves_unicode_transcript_and_history`
  - verifies `LLMClient.chat(..., history=...)` continues to preserve Unicode transcript/history content

## 5. Final validation results

Validation against the implemented backend delta:

- Source parity verified against:
  - `backend/app/ws/audio.py`
  - `backend/tests/test_ws_audio.py`
  - `backend/tests/test_llm_client.py`
  - `docs/plan/voice-llm-chat-20260310/plan.yaml`
  - `docs/plan/voice-llm-chat-20260310/research_findings_websocket-disconnect-bug.yaml`
- Targeted backend validation command:

```bash
cd backend && uv run pytest tests/test_ws_audio.py tests/test_llm_client.py -q
```

- Result: **23 passed in 7.78s**

What this validates:

- `<think>` content is no longer emitted in `llm_response`
- malformed/open-ended `<think>` output is truncated safely
- visible Unicode content still survives websocket delivery
- send-time disconnects are treated as disconnects, not misdiagnosed as encoding failures

## 6. Next steps / monitoring suggestions

- Monitor backend logs for repeated sequences of:
  - `disconnect during send type=llm_response`
  - `client disconnected state=LLM_CALLING`
- If disconnects continue, capture browser-side close code/reason and confirm whether navigation, unmount, or a proxy is closing the socket.
- If future telemetry shows a repeatable client lifecycle issue, follow up in the frontend websocket hook; this bugfix intentionally stopped at the backend boundary.
