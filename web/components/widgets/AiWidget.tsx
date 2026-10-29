"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type ToolCallTrace = { name: string; arguments: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string; toolCalls?: ToolCallTrace[] };

type Portfolio = { id: number; name: string };
// A lightweight slice of GET /api/portfolios/:id/positions (see PortfolioWidget.tsx for the
// full shape) — just enough for the assistant to ground answers, not the full options fields.
type PositionSnapshot = { symbol: string; instrumentType: string; quantity: number; avgCost: number };

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const watchlist = useTerminal((s) => s.watchlist);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMutation({
    mutationFn: async (userText: string) => {
      // Every turn auto-injects a lightweight positions snapshot and the client-side
      // watchlist as context — best-effort, same as the quote fetch: either one failing
      // never blocks the chat itself. Run both independent lookups concurrently rather
      // than serially, so one slow/failing fetch doesn't add to the other's latency.
      const context: Record<string, unknown> = { activeSymbol, watchlist };
      const [quoteResult, positionsResult] = await Promise.allSettled([
        apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`),
        (async () => {
          const portfolios = await apiGet<Portfolio[]>("/api/portfolios");
          const pid = portfolios[0]?.id;
          if (!pid) return [];
          return apiGet<PositionSnapshot[]>(`/api/portfolios/${pid}/positions`);
        })(),
      ]);
      if (quoteResult.status === "fulfilled") context.quote = quoteResult.value[0];
      if (positionsResult.status === "fulfilled" && positionsResult.value.length > 0) {
        context.positions = positionsResult.value.map(
          (p): PositionSnapshot => ({
            symbol: p.symbol,
            instrumentType: p.instrumentType,
            quantity: p.quantity,
            avgCost: p.avgCost,
          })
        );
      }

      const next = [...messages, { role: "user" as const, content: userText }];
      const res = await apiPost<{ text: string; toolCalls?: ToolCallTrace[] }>("/api/ai/chat", { messages: next, context });
      return { next, reply: res.text, toolCalls: res.toolCalls };
    },
    onSuccess: ({ next, reply, toolCalls }) => {
      setMessages([...next, { role: "assistant", content: reply, toolCalls }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    chat.mutate(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. The current quote is shared as context.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            <span className="whitespace-pre-wrap">{m.content}</span>
            {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
              <details className="dim text-xs mt-1">
                <summary className="cursor-pointer">looked up {m.toolCalls.length} thing{m.toolCalls.length === 1 ? "" : "s"}</summary>
                <ul className="pl-4 list-disc">
                  {m.toolCalls.map((t, j) => (
                    <li key={j}>
                      {t.name}
                      {Object.keys(t.arguments).length > 0 ? `(${JSON.stringify(t.arguments)})` : "()"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {chat.isPending && <div className="dim">thinking…</div>}
        {chat.error && <div className="down">{(chat.error as Error).message}</div>}
      </div>
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Ask about ${activeSymbol}…`}
        />
        <button className="term-btn" onClick={send}>SEND</button>
      </div>
    </div>
  );
}
