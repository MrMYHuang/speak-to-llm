.DEFAULT_GOAL := help
SHELL         := bash

# ─────────────────────────────────────────────────────────────
# speak-to-llm — root Makefile
# ─────────────────────────────────────────────────────────────

.PHONY: help dev backend frontend install install-backend install-frontend \
        lint lint-backend lint-frontend typecheck test clean

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Dev ──────────────────────────────────────────────────────

dev: ## Start backend + frontend together (SIGINT stops both)
	@bash scripts/dev.sh

backend: ## Start backend only (uvicorn with reload)
	@cd backend && uv run uvicorn app.main:app \
		--host "$${BACKEND_HOST:-0.0.0.0}" \
		--port "$${BACKEND_PORT:-8000}" \
		--reload

frontend: ## Start frontend only (Vite dev server)
	@cd frontend && pnpm dev

# ── Install ──────────────────────────────────────────────────

install: install-backend install-frontend ## Install all dependencies

install-backend: ## Install Python dependencies with uv
	@cd backend && uv sync

install-frontend: ## Install JS dependencies with pnpm
	@cd frontend && pnpm install

# ── Quality ──────────────────────────────────────────────────

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Lint Python code with ruff
	@cd backend && uv run ruff check .

lint-frontend: ## Lint TypeScript/JS with eslint
	@cd frontend && pnpm lint

typecheck: ## Type-check TypeScript
	@cd frontend && pnpm typecheck

test: ## Run all tests
	@cd backend && uv run pytest -q
	@cd frontend && pnpm test --run

# ── Housekeeping ─────────────────────────────────────────────

clean: ## Remove build artefacts and caches
	@rm -rf frontend/dist frontend/node_modules/.vite
	@find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find backend -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete."
