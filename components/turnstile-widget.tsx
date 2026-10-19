"use client";

import { useEffect, useRef, useState } from "react";
import { turnstileAction } from "@/lib/turnstile-config";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load"));
    script.onerror = () => reject(new Error("Turnstile did not load"));
    document.head.appendChild(script);
  }).catch((error) => { loader = null; throw error; });
  return loader;
}

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
  onError,
}: {
  siteKey: string | null;
  resetKey: number;
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callbacks.current = { onToken, onError };
  }, [onError, onToken]);

  useEffect(() => {
    if (!siteKey || !container.current) {
      setLoading(false);
      callbacks.current.onError("Security verification is temporarily unavailable. Please try again later.");
      return;
    }
    let disposed = false;
    loadTurnstile().then((api) => {
      if (disposed || !container.current) return;
      widgetId.current = api.render(container.current, {
        sitekey: siteKey,
        action: turnstileAction,
        appearance: "interaction-only",
        size: "flexible",
        theme: "light",
        callback: (token: string) => { setLoading(false); callbacks.current.onError(""); callbacks.current.onToken(token); },
        "expired-callback": () => { callbacks.current.onToken(""); api.reset(widgetId.current!); },
        "error-callback": () => { setLoading(false); callbacks.current.onToken(""); callbacks.current.onError("The security check could not complete. Please try it again."); },
      });
    }).catch(() => {
      if (!disposed) {
        setLoading(false);
        callbacks.current.onError("The security check could not load. Please refresh and try again.");
      }
    });
    return () => {
      disposed = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (!resetKey || !widgetId.current || !window.turnstile) return;
    callbacks.current.onToken("");
    callbacks.current.onError("");
    setLoading(true);
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return <div className="turnstile-check" aria-live="polite">
    <div ref={container} />
    {loading && <span>Checking that you’re human…</span>}
  </div>;
}

