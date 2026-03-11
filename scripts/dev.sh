#!/usr/bin/env bash
# scripts/dev.sh — Start backend + frontend dev servers concurrently.
# Traps SIGINT (Ctrl-C) to cleanly stop both child processes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load root .env if present (non-fatal)
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck source=/dev/null
  set -o allexport
  source "$ROOT_DIR/.env"
  set +o allexport
fi

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

BACKEND_CMD="uv run uvicorn app.main:app --host ${BACKEND_HOST} --port ${BACKEND_PORT} --reload"
FRONTEND_CMD="pnpm dev"

# ── Colours ──────────────────────────────────────────────────
C_RESET='\033[0m'
C_CYAN='\033[0;36m'
C_MAGENTA='\033[0;35m'
C_YELLOW='\033[0;33m'

log()     { echo -e "${C_YELLOW}[dev.sh]${C_RESET} $*"; }
log_be()  { echo -e "${C_CYAN}[backend]${C_RESET} $*"; }
log_fe()  { echo -e "${C_MAGENTA}[frontend]${C_RESET} $*"; }

# ── PID tracking ─────────────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  log "Caught SIGINT — stopping services…"
  [[ -n "$BACKEND_PID"  ]] && kill "$BACKEND_PID"  2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID"  2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  log "All services stopped. Goodbye."
  exit 0
}

trap cleanup INT TERM

# ── Backend ───────────────────────────────────────────────────
log_be "Starting → ${BACKEND_CMD}"
if [[ -d "$ROOT_DIR/backend" ]]; then
  (cd "$ROOT_DIR/backend" && eval "$BACKEND_CMD") &
  BACKEND_PID=$!
  log_be "PID $BACKEND_PID"
else
  log_be "backend/ directory not found — skipping (will start once scaffold exists)"
fi

# ── Frontend ──────────────────────────────────────────────────
log_fe "Starting → ${FRONTEND_CMD}"
if [[ -d "$ROOT_DIR/frontend" ]]; then
  (cd "$ROOT_DIR/frontend" && eval "$FRONTEND_CMD") &
  FRONTEND_PID=$!
  log_fe "PID $FRONTEND_PID"
else
  log_fe "frontend/ directory not found — skipping (will start once scaffold exists)"
fi

log "Both services launched. Press Ctrl-C to stop."

# Wait for both processes; exit when either exits unexpectedly
wait
