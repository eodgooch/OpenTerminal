"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, type Quote } from "./api";

/**
 * Fast-polled quote for a symbol, shared (via the react-query cache) with any
 * other consumer using the same `["quote", symbol]` key — e.g. QuoteWidget.
 * Mounting this alongside an open QuoteWidget for the same symbol does not
 * add a second poll; the query is deduped by react-query's single QueryClient.
 *
 * `enabled` lets a caller stop polling entirely (e.g. when a chart's range
 * isn't the one that needs live ticks) without unmounting anything else that
 * shares the same key.
 */
export function useLivePrice(symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    refetchInterval: 1_000,
    enabled,
  });
}
