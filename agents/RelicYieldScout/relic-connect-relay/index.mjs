import { createPublicKey, randomUUID, verify } from "node:crypto";

const issuer = "relic-connect";
const supportedScopes = new Set(["relic.inspect", "relic.invoke"]);
let cachedCredential;

function relayPublicKey() {
  const pem =
    process.env.RELIC_CONNECT_PUBLIC_KEY_PEM ??
    (process.env.RELIC_CONNECT_PUBLIC_KEY_PEM_BASE64
      ? Buffer.from(process.env.RELIC_CONNECT_PUBLIC_KEY_PEM_BASE64, "base64").toString("utf8")
      : undefined);
  if (!pem) throw new Error("Relic Connect public key is not configured");
  return createPublicKey(pem);
}

function json(value, statusCode) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(value),
  };
}

function base64Json(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function validRelicToken(request) {
  const token = request.headers?.authorization?.match(
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
  )?.[1];
  if (!token || token.length > 8192) return false;
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  const header = base64Json(encodedHeader);
  const claims = base64Json(encodedClaims);
  if (header?.alg !== "EdDSA" || header.typ !== "JWT" || !claims) return false;
  try {
    if (
      !verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        relayPublicKey(),
        Buffer.from(encodedSignature, "base64url"),
      )
    )
      return false;
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const scopes = Array.isArray(claims.scope) ? claims.scope : [];
  return (
    claims.iss === issuer &&
    claims.aud === process.env.RELIC_CONNECT_AUDIENCE &&
    typeof claims.exp === "number" &&
    claims.exp >= now - 15 &&
    scopes.some(
      (scope) => typeof scope === "string" && supportedScopes.has(scope),
    )
  );
}

async function relayCredential() {
  if (cachedCredential) return cachedCredential;
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    "@aws-sdk/client-secrets-manager"
  );
  const response = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({
      SecretId: process.env.RELIC_CONNECT_RUNTIME_CREDENTIAL_SECRET_ID,
    }),
  );
  const credential = JSON.parse(response.SecretString ?? "{}");
  if (
    !credential.clientId ||
    !credential.clientSecret ||
    !credential.tokenUrl ||
    !credential.scope
  )
    throw new Error("Relay credential secret is incomplete");
  cachedCredential = credential;
  return credential;
}

async function runtimeAccessToken() {
  const credential = await relayCredential();
  const basic = Buffer.from(
    `${credential.clientId}:${credential.clientSecret}`,
  ).toString("base64");
  const response = await fetch(credential.tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: credential.scope,
    }),
  });
  if (!response.ok) throw new Error("Relay could not acquire a runtime token");
  const body = await response.json();
  if (!body?.access_token || typeof body.access_token !== "string")
    throw new Error("Runtime token response was invalid");
  return body.access_token;
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "";
  if (method === "GET" && event.rawPath === "/health")
    return json({ status: "ready" }, 200);
  if (method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!validRelicToken(event))
    return json({ error: "relic_connect_token_not_authorized" }, 401);
  if ((event.body?.length ?? 0) > 1_000_000)
    return json({ error: "payload_too_large" }, 413);

  try {
    const token = await runtimeAccessToken();
    const sessionId =
      event.headers?.["x-amzn-bedrock-agentcore-runtime-session-id"] ??
      randomUUID();
    const upstream = await fetch(process.env.RELIC_CONNECT_RUNTIME_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": event.headers?.["content-type"] ?? "application/json",
        "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
      },
      body: event.body ?? "",
    });
    return {
      statusCode: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
      body: await upstream.text(),
    };
  } catch (error) {
    console.error(
      "relic-connect relay failure",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "relay_unavailable" }, 502);
  }
};
