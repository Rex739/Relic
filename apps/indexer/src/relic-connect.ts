import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  safeBearerHttpRequest,
  type SafeHttpOptions,
  type SafeHttpResult,
} from "./endpoint-observer.js";

const TOKEN_ISSUER = "relic-connect";
const TOKEN_KID = "relic-connect-v1";
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60;

export const RELIC_CONNECT_SIGNING_KEY_ENV =
  "RELIC_CONNECT_SIGNING_PRIVATE_KEY_PEM";

function signingKeyFromEnvironmentOrLocalDevelopmentFile() {
  const configured = process.env[RELIC_CONNECT_SIGNING_KEY_ENV];
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return undefined;
  const path = process.env.RELIC_CONNECT_DEVELOPMENT_SIGNING_KEY_PATH ?? [
    resolve(process.cwd(), ".relic-connect/private.pem"),
    resolve(process.cwd(), "../../.relic-connect/private.pem"),
  ].find(existsSync);
  if (!path) return undefined;
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export type RelicConnectScope = "relic.inspect" | "relic.invoke";

export interface RelicConnectClaims {
  iss: typeof TOKEN_ISSUER;
  aud: string;
  scope: RelicConnectScope[];
  iat: number;
  exp: number;
  jti: string;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

/**
 * The endpoint audience deliberately excludes query parameters. AgentCore's
 * qualifier is transport routing, not an authority boundary; the runtime URL
 * itself remains the token's pinned destination.
 */
export function relicConnectAudience(endpoint: string) {
  const url = new URL(endpoint);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

/**
 * Relay routing is platform configuration, never seller-supplied data. The
 * map is keyed by the protected execution endpoint's normalized audience and
 * may be supplied by the hosted indexer or its ignored local development
 * configuration. This keeps the adapter generic across every seller runtime.
 */
export function relicConnectRelayEndpoint(referenceEndpoint: string) {
  const configured = process.env.RELIC_CONNECT_RELAYS_JSON;
  const localPath = [
    resolve(process.cwd(), ".relic-connect/relays.json"),
    resolve(process.cwd(), "../../.relic-connect/relays.json"),
  ].find(existsSync);
  const raw = configured ?? (localPath ? readFileSync(localPath, "utf8") : "");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const relay = (parsed as Record<string, unknown>)[relicConnectAudience(referenceEndpoint)];
    if (typeof relay !== "string") return null;
    const url = new URL(relay);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function issueRelicConnectToken(input: {
  endpoint: string;
  scopes: RelicConnectScope[];
  privateKeyPem: string;
  now?: () => number;
  lifetimeSeconds?: number;
  jti: string;
}) {
  const now = Math.floor((input.now ?? Date.now)() / 1_000);
  const lifetime = input.lifetimeSeconds ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 300)
    throw new Error("Relic Connect token lifetime must be between 1 and 300 seconds");
  if (input.scopes.length === 0) throw new Error("Relic Connect token needs a scope");

  const header = base64Url(
    JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: TOKEN_KID }),
  );
  const claims: RelicConnectClaims = {
    iss: TOKEN_ISSUER,
    aud: relicConnectAudience(input.endpoint),
    scope: [...new Set(input.scopes)].sort(),
    iat: now,
    exp: now + lifetime,
    jti: input.jti,
  };
  const payload = base64Url(JSON.stringify(claims));
  const unsigned = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(unsigned), createPrivateKey(input.privateKeyPem));
  return `${unsigned}.${base64Url(signature)}`;
}

function failed(endpoint: string, errorCode: string): SafeHttpResult {
  return {
    endpoint,
    ok: false,
    status: null,
    latencyMs: null,
    redirectCount: 0,
    headers: {},
    body: "",
    errorCode,
  };
}

/**
 * Relic Connect is a marketplace-issued, short-lived bearer token. It never
 * reads a seller's OAuth client secret and never follows the supplied endpoint
 * to a different origin. This is the only requester used for adapters that
 * explicitly support Relic Connect.
 */
export function createRelicConnectRequester(
  referenceEndpoint: string,
  options: {
    privateKeyPem?: string;
    /** Public, platform-owned relay URL for this protected endpoint. */
    relayEndpoint?: string;
    now?: () => number;
    bearerRequest?: (
      endpoint: string,
      token: string,
      options: Omit<SafeHttpOptions, "maxRedirects"> & { allowedOrigin: string },
    ) => Promise<SafeHttpResult>;
  } = {},
) {
  let audience: string;
  try {
    audience = relicConnectAudience(referenceEndpoint);
  } catch {
    return (endpoint: string) =>
      Promise.resolve(failed(endpoint, "relic_connect_invalid_endpoint"));
  }
  const privateKeyPem =
    options.privateKeyPem ?? signingKeyFromEnvironmentOrLocalDevelopmentFile();
  const bearerRequest = options.bearerRequest ?? safeBearerHttpRequest;
  const relayEndpoint = options.relayEndpoint ?? referenceEndpoint;
  let relayOrigin: string;
  try {
    relayOrigin = new URL(relayEndpoint).origin;
  } catch {
    return (endpoint: string) =>
      Promise.resolve(failed(endpoint, "relic_connect_invalid_relay_endpoint"));
  }

  return async (endpoint: string, requestOptions: SafeHttpOptions = {}) => {
    let requestedAudience: string;
    try {
      requestedAudience = relicConnectAudience(referenceEndpoint);
    } catch {
      return failed(endpoint, "relic_connect_invalid_endpoint");
    }
    if (requestedAudience !== audience || endpoint !== relayEndpoint)
      return failed(endpoint, "relic_connect_audience_boundary_violation");
    if (!privateKeyPem)
      return failed(endpoint, "relic_connect_not_configured");
    let token: string;
    try {
      token = issueRelicConnectToken({
        // The token is bound to the protected execution endpoint; the relay
        // is only a transport hop and must never become the authority.
        endpoint: referenceEndpoint,
        scopes: ["relic.inspect"],
        privateKeyPem,
        ...(options.now === undefined ? {} : { now: options.now }),
        jti: randomUUID(),
      });
    } catch {
      return failed(endpoint, "relic_connect_invalid_signing_key");
    }
    try {
      return await bearerRequest(relayEndpoint, token, {
        ...requestOptions,
        allowedOrigin: relayOrigin,
      });
    } catch {
      return failed(endpoint, "relic_connect_request_failed");
    }
  };
}
