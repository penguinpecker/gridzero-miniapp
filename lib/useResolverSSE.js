"use client";
import { useEffect, useRef, useState, useCallback } from "react";

export function useResolverSSE({ url, onRoundResolved, onCellPicked }) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const retryCount = useRef(0);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    try {
      const es = new EventSource(url);
      esRef.current = es;
      es.onopen = () => { setConnected(true); retryCount.current = 0; };
      es.addEventListener("round_resolved", () => onRoundResolved?.());
      es.addEventListener("cell_picked", (e) => {
        try { onCellPicked?.(JSON.parse(e.data)); } catch {}
      });
      es.onerror = () => {
        setConnected(false); es.close(); esRef.current = null;
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
        retryCount.current++;
        setTimeout(connect, delay);
      };
    } catch { setConnected(false); }
  }, [url, onRoundResolved, onCellPicked]);

  useEffect(() => {
    connect();
    return () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } };
  }, [connect]);

  return { connected };
}
