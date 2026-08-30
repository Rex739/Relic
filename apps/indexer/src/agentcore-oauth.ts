import { z } from "zod";

import {
  safeBearerHttpRequest,
  safeHttpRequest,
  type SafeHttpOptions,
  type SafeHttpResult,
} from "./endpoint-observer.js";

const credentialSchema = z.object({
  runtimeArn: z
    .string()
    .regex(
      /^arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[A-Za-z0-9_-]+$/,
    ),
  tokenUrl: z.url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scope: z.string().min(1),
});

const credentialsSchema = z.array(credentialSchema);
type Credential = z.infer<typeof credentialSchema>;
type Requester = (
  endpoint: string,
  options?: SafeHttpOptions,
) => Promise<SafeHttpResult>;
type BearerRequestOptions = Omit<SafeHttpOptions, "maxRedirects"> & {
  allowedOrigin: string;
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional().default(300),
  token_type: z.string().optional(),
});

export const AGENTCORE_OAUTH_ENV = "RELIC_AGENTCORE_OAUTH_CLIENTS_JSON";

export function agentcoreRuntime(
  endpoint: string,
): { arn: string; origin: string; region: string } | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  const host = url.hostname.match(
    /^bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com$/,
  );
  if (url.protocol !== "https:" || host?.[1] === undefined) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const runtime = pathname.match(
    /^\/runtimes\/(arn:aws:bedrock-agentcore:([a-z0-9-]+):\d{12}:runtime\/[A-Za-z0-9_-]+)\/invocations(?:\/|$)/,
  );
  if (
    runtime?.[1] === undefined ||
    runtime[2] === undefined ||
    runtime[2] !== host[1]
  )
    return null;
  return { arn: runtime[1], origin: url.origin, region: runtime[2] };
}

function validTokenUrl(tokenUrl: string, region: string) {
  const url = new URL(tokenUrl);
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.pathname === "/oauth2/token" &&
    url.hostname.endsWith(`.auth.${region}.amazoncognito.com`)
  );
}

function missingCredentialResult(
  endpoint: string,
  code: string,
): SafeHttpResult {
  return {
    endpoint,
    ok: false,
    status: null,
    latencyMs: null,
    redirectCount: 0,
    headers: {},
    body: "",
    errorCode: code,
  };
}

function matchingCredential(
  runtime: NonNullable<ReturnType<typeof agentcoreRuntime>>,
  raw: string | undefined,
): Credential | null {
  if (raw === undefined || raw.trim() === "") return null;
  const entries = credentialsSchema.parse(JSON.parse(raw));
  const credential = entries.find(
    ({ runtimeArn }) => runtimeArn === runtime.arn,
  );
  if (credential === undefined) return null;
  if (!validTokenUrl(credential.tokenUrl, runtime.region))
    throw new Error(
      "AgentCore OAuth token URL is outside the pinned Cognito region",
    );
  return credential;
}

/**
 * Select a credential-free requester for ordinary services or a strictly
 * runtime-bound OAuth requester for an AWS AgentCore endpoint.
 *
 * Credentials are operator configuration only. They are never read from an
 * agent declaration, database record, redirect, or response payload.
 */
export function createAgentcoreAwareRequester(
  referenceEndpoint: string,
  options: {
    credentialsJson?: string;
    tokenRequest?: Requester;
    bearerRequest?: (
      endpoint: string,
      token: string,
      options: BearerRequestOptions,
    ) => Promise<SafeHttpResult>;
    now?: () => number;
  } = {},
): Requester {
  const runtime = agentcoreRuntime(referenceEndpoint);
  if (runtime === null) return safeHttpRequest;
  let credential: Credential | null;
  try {
    credential = matchingCredential(
      runtime,
      options.credentialsJson ?? process.env[AGENTCORE_OAUTH_ENV],
    );
  } catch {
    return (endpoint) =>
      Promise.resolve(
        missingCredentialResult(endpoint, "agentcore_oauth_invalid_config"),
      );
  }
  if (credential === null)
    return (endpoint) =>
      Promise.resolve(
        missingCredentialResult(endpoint, "agentcore_oauth_not_configured"),
      );

  const tokenRequest = options.tokenRequest ?? safeHttpRequest;
  const bearerRequest = options.bearerRequest ?? safeBearerHttpRequest;
  const now = options.now ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | null = null;

  const accessToken = async () => {
    if (cachedToken !== null && cachedToken.expiresAt - 30_000 > now())
      return cachedToken.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      scope: credential.scope,
    }).toString();
    const response = await tokenRequest(credential.tokenUrl, {
      method: "POST",
      maxRedirects: 0,
      maxResponseBytes: 16 * 1024,
      timeoutMs: 5_000,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok || response.status !== 200)
      throw new Error(
        `AgentCore OAuth token request failed with HTTP ${response.status}`,
      );
    const token = tokenSchema.parse(JSON.parse(response.body));
    cachedToken = {
      value: token.access_token,
      expiresAt: now() + token.expires_in * 1_000,
    };
    return cachedToken.value;
  };

  return async (endpoint, requestOptions = {}) => {
    const requestedRuntime = agentcoreRuntime(endpoint);
    if (requestedRuntime?.arn !== runtime.arn)
      return missingCredentialResult(
        endpoint,
        "agentcore_runtime_boundary_violation",
      );
    try {
      return await bearerRequest(endpoint, await accessToken(), {
        ...requestOptions,
        allowedOrigin: runtime.origin,
      });
    } catch {
      return missingCredentialResult(
        endpoint,
        "agentcore_oauth_request_failed",
      );
    }
  };
}

export function agentcoreAuthenticationRequirements(endpoint: string | null) {
  if (endpoint === null) return null;
  const runtime = agentcoreRuntime(endpoint);
  return runtime === null
    ? null
    : {
        type: "oauth2_client_credentials",
        provider: "aws-agentcore-cognito",
        runtimeArn: runtime.arn,
        credentialSource: "operator_secret",
      };
}
