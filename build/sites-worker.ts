import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const securityHeaders: Record<string, string> = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://login.microsoftonline.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; media-src 'none'; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

// EMBED_ORIGINS lists sites allowed to show the booking page in an iframe, e.g. "https://mjeffries.com https://www.mjeffries.com".
function embedOrigins(env?: Cloudflare.Env) {
  const value = (env as { EMBED_ORIGINS?: string } | undefined)?.EMBED_ORIGINS ?? "";
  return value.split(/\s+/).filter((origin) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin));
}

function secureResponse(request: Request, response: Response, env?: Cloudflare.Env) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
  const origins = embedOrigins(env);
  if (origins.length) {
    secured.headers.set("content-security-policy", securityHeaders["content-security-policy"].replace("frame-ancestors 'none'", `frame-ancestors 'self' ${origins.join(" ")}`));
    secured.headers.delete("x-frame-options");
  }
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/") || pathname === "/manage" || pathname.startsWith("/manage/")) {
    secured.headers.set("cache-control", "private, no-store");
    secured.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  return secured;
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    const requestHost = request.headers.get("host")?.split(":", 1)[0];
    if (url.protocol !== "https:" && requestHost !== "localhost" && requestHost !== "127.0.0.1") {
      url.protocol = "https:";
      return secureResponse(request, Response.redirect(url.toString(), 308));
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    return secureResponse(request, response, env);
  },
};
