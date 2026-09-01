import { createPublicKey, verify } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const ISSUER = "relic-connect";
const INSPECT_SCOPE = "relic.inspect";
const INVOKE_SCOPE = "relic.invoke";

type TokenClaims = {
  iss?: unknown;
  aud?: unknown;
  scope?: unknown;
  exp?: unknown;
  nbf?: unknown;
};

function audience(endpoint: string) {
  const url = new URL(endpoint);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function decodeJson(value: string): Record<string, unknown> | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function tokenScopes(claims: TokenClaims) {
  return Array.isArray(claims.scope)
    ? claims.scope.filter((scope): scope is string => typeof scope === "string")
    : [];
}

function publicPath(path: string) {
  return (
    path === "/ping" ||
    path === "/readiness" ||
    path === "/.well-known/agent-card.json"
  );
}

/**
 * Verifies only Relic Connect's short-lived Ed25519 bearer tokens. The public
 * verification key belongs in the runtime configuration; the matching private
 * key is held by Relic and is never shipped to sellers or buyers.
 */
export function relicConnectMiddleware(options: {
  publicKeyPem?: string;
  audience?: string;
  now?: () => number;
} = {}) {
  const publicKeyPem = options.publicKeyPem ?? process.env.RELIC_CONNECT_PUBLIC_KEY_PEM;
  const target = options.audience ?? process.env.AGENTCORE_RUNTIME_URL ?? process.env.BNBAGENT_PUBLIC_URL;
  const now = options.now ?? Date.now;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || publicPath(req.path)) {
      next();
      return;
    }
    // Local Studio development stays usable without deploying platform
    // configuration. A deployed Relic Connect runtime always provides both
    // values and therefore fails closed below.
    if (!publicKeyPem || !target) {
      if (process.env.RELIC_CONNECT_REQUIRED === "true") {
        res.status(503).json({ error: "relic_connect_not_configured" });
        return;
      }
      next();
      return;
    }
    const raw = req.header("authorization");
    const token = raw?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
    if (!token || token.length > 8_192) {
      res.status(401).json({ error: "relic_connect_token_required" });
      return;
    }
    const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSignature) {
      res.status(401).json({ error: "relic_connect_token_invalid" });
      return;
    }
    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedClaims) as TokenClaims | null;
    if (header?.alg !== "EdDSA" || header.typ !== "JWT" || claims === null) {
      res.status(401).json({ error: "relic_connect_token_invalid" });
      return;
    }
    try {
      if (!verify(null, Buffer.from(`${encodedHeader}.${encodedClaims}`), createPublicKey(publicKeyPem), Buffer.from(encodedSignature, "base64url"))) {
        res.status(401).json({ error: "relic_connect_token_invalid" });
        return;
      }
    } catch {
      res.status(503).json({ error: "relic_connect_not_configured" });
      return;
    }
    const timestamp = Math.floor(now() / 1_000);
    const scopes = tokenScopes(claims);
    const permitted = scopes.includes(INSPECT_SCOPE) || scopes.includes(INVOKE_SCOPE);
    if (
      claims.iss !== ISSUER ||
      claims.aud !== audience(target) ||
      !permitted ||
      typeof claims.exp !== "number" ||
      claims.exp < timestamp - 15 ||
      (typeof claims.nbf === "number" && claims.nbf > timestamp + 15)
    ) {
      res.status(403).json({ error: "relic_connect_token_not_authorized" });
      return;
    }
    next();
  };
}
