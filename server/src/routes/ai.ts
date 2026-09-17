import { Router } from "express";
import { activeProvider, LlmConfigError } from "../llm/index.js";

export const aiRouter = Router();

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  let provider;
  try {
    provider = activeProvider();
  } catch (err) {
    const detail = err instanceof LlmConfigError ? err.message : String(err);
    return res.status(503).json({ error: `AI assistant unavailable: ${detail}` });
  }
  if (!provider.hasCredentials()) {
    return res.status(503).json({ error: `AI assistant unavailable: ${provider.missingCredentialHint()}` });
  }

  try {
    const response = await provider.chat({ system: SYSTEM, messages, context });
    res.json({ text: response.text });
  } catch (err) {
    // A present-but-invalid/revoked key surfaces as an upstream auth error here
    // (missing keys are already caught by hasCredentials() above) — report it
    // the same actionable way as a missing key, not as a raw upstream 502.
    if (provider.isAuthError(err)) {
      return res.status(503).json({ error: `AI assistant unavailable: ${provider.missingCredentialHint()}` });
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});
