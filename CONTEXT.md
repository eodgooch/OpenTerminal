# OpenTerminal

A terminal-style financial dashboard: a Next.js frontend backed by an Express/SQLite API server that aggregates market data and provides an AI chat assistant.

## Language

**LLM Provider**:
A named backend for AI chat completion (`anthropic` or `ollama-cloud`), each with its own credentials, base URL, and default model.
_Avoid_: "Provider" alone — collides with the unrelated market-data providers in `server/src/providers/` (Binance, CoinGecko, Yahoo, Nasdaq, etc.), which are a different concept in a different domain.

**Active Provider**:
The single LLM Provider currently selected via the `LLM_PROVIDER` env var. Exactly one is active at a time — there is no fallback between providers and no runtime/UI selection.
_Avoid_: "Default provider" (ambiguous with the unset-env-var fallback to `anthropic`).
