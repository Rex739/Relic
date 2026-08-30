import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";

export type EndpointObservationStatus =
  "reachable" | "unreachable" | "timeout" | "invalid" | "unsupported_protocol";

export interface EndpointObservationResult {
  endpoint: string;
  status: EndpointObservationStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  redirectCount: number;
  errorCode: string | null;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a = 0, b = 0] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    )
      return false;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped?.[1] === undefined ? true : isPublicIpAddress(mapped[1]);
  }
  return false;
}

export function validateEndpointUrl(
  value: string,
):
  | { ok: true; url: URL }
  | { ok: false; status: "invalid" | "unsupported_protocol"; code: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, status: "invalid", code: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return {
      ok: false,
      status: "unsupported_protocol",
      code: "unsupported_protocol",
    };
  if (url.username !== "" || url.password !== "")
    return { ok: false, status: "invalid", code: "embedded_credentials" };
  if (
    (url.protocol === "http:" && url.port !== "" && url.port !== "80") ||
    (url.protocol === "https:" && url.port !== "" && url.port !== "443")
  )
    return { ok: false, status: "invalid", code: "disallowed_port" };
  return { ok: true, url };
}

async function resolvePublicAddresses(hostname: string) {
  const literalVersion = isIP(hostname);
  const addresses =
    literalVersion === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: literalVersion }];
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  )
    throw Object.assign(
      new Error("Endpoint resolves to a non-public address"),
      {
        code: "private_or_unresolved_address",
      },
    );
  return addresses;
}

function headRequest(
  url: URL,
  addresses: Awaited<ReturnType<typeof resolvePublicAddresses>>,
  timeoutMs: number,
): Promise<{ status: number; location: string | null; latencyMs: number }> {
  const started = performance.now();
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const selected = addresses[0]!;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: selected.address,
        family: selected.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "HEAD",
        agent: false,
        maxHeaderSize: 16 * 1024,
        headers: {
          host: url.host,
          "user-agent": "Relic-Availability-Observer/1.0",
        },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location ?? null,
          latencyMs: performance.now() - started,
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(
        Object.assign(new Error("Endpoint timeout"), { code: "ETIMEDOUT" }),
      ),
    );
    request.once("error", reject);
    request.end();
  });
}

export interface SafeHttpResult {
  endpoint: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  redirectCount: number;
  headers: Record<string, string | string[]>;
  body: string;
  errorCode: string | null;
}

export interface SafeHttpOptions {
  method?: "GET" | "HEAD" | "OPTIONS" | "POST";
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  headers?: Record<string, string>;
  body?: string;
}

function boundedRequest(
  url: URL,
  addresses: Awaited<ReturnType<typeof resolvePublicAddresses>>,
  options: {
    method: "GET" | "HEAD" | "OPTIONS" | "POST";
    timeoutMs: number;
    maxResponseBytes: number;
    headers: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  location: string | null;
  latencyMs: number;
  headers: Record<string, string | string[]>;
  body: string;
}> {
  const started = performance.now();
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const selected = addresses[0]!;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: selected.address,
        family: selected.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method,
        agent: false,
        maxHeaderSize: 16 * 1024,
        headers: {
          host: url.host,
          "user-agent": "Relic-Service-Inspector/1.0",
          ...options.headers,
        },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      },
      (response) => {
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > options.maxResponseBytes
        ) {
          response.destroy();
          reject(
            Object.assign(new Error("Response exceeds configured bound"), {
              code: "response_too_large",
            }),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.length;
          if (total > options.maxResponseBytes) {
            response.destroy(
              Object.assign(new Error("Response exceeds configured bound"), {
                code: "response_too_large",
              }),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.once("error", reject);
        response.once("end", () => {
          const headers = Object.fromEntries(
            Object.entries(response.headers).flatMap(([key, value]) =>
              value === undefined ? [] : [[key, value]],
            ),
          ) as Record<string, string | string[]>;
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            latencyMs: performance.now() - started,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(options.timeoutMs, () =>
      request.destroy(
        Object.assign(new Error("Endpoint timeout"), { code: "ETIMEDOUT" }),
      ),
    );
    request.once("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function boundedSafeHttpRequest(
  endpoint: string,
  options: SafeHttpOptions,
  allowAuthorization: boolean,
): Promise<SafeHttpResult> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRedirects = options.maxRedirects ?? 2;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
  const headers = options.headers ?? {};
  if (
    !allowAuthorization &&
    Object.keys(headers).some((key) =>
      ["authorization", "cookie", "proxy-authorization"].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new Error("Service inspection cannot send credentials");
  let current = endpoint;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const validation = validateEndpointUrl(current);
    if (!validation.ok)
      return {
        endpoint,
        ok: false,
        status: null,
        latencyMs: null,
        redirectCount: redirects,
        headers: {},
        body: "",
        errorCode: validation.code,
      };
    try {
      const addresses = await resolvePublicAddresses(validation.url.hostname);
      const response = await boundedRequest(validation.url, addresses, {
        method,
        timeoutMs,
        maxResponseBytes,
        headers,
        ...(options.body === undefined ? {} : { body: options.body }),
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.location !== null
      ) {
        if (method === "POST")
          return {
            endpoint,
            ok: false,
            status: response.status,
            latencyMs: response.latencyMs,
            redirectCount: redirects,
            headers: response.headers,
            body: response.body,
            errorCode: "post_redirect_refused",
          };
        if (redirects === maxRedirects)
          return {
            endpoint,
            ok: false,
            status: response.status,
            latencyMs: response.latencyMs,
            redirectCount: redirects,
            headers: response.headers,
            body: response.body,
            errorCode: "redirect_limit",
          };
        current = new URL(response.location, validation.url).toString();
        continue;
      }
      return {
        endpoint,
        ok: response.status >= 200 && response.status < 500,
        status: response.status,
        latencyMs: response.latencyMs,
        redirectCount: redirects,
        headers: response.headers,
        body: response.body,
        errorCode: null,
      };
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "request_failed";
      return {
        endpoint,
        ok: false,
        status: null,
        latencyMs: null,
        redirectCount: redirects,
        headers: {},
        body: "",
        errorCode: code,
      };
    }
  }
  throw new Error("Unreachable safe request state");
}

export async function safeHttpRequest(
  endpoint: string,
  options: SafeHttpOptions = {},
): Promise<SafeHttpResult> {
  return boundedSafeHttpRequest(endpoint, options, false);
}

/**
 * Send one bearer-authenticated request to an explicitly pinned HTTPS origin.
 *
 * This is intentionally separate from `safeHttpRequest`: the generic service
 * inspector remains credential-free. Redirects are always refused so a bearer
 * can never be forwarded to another host, and callers cannot inject any other
 * credential-bearing header.
 */
export async function safeBearerHttpRequest(
  endpoint: string,
  bearerToken: string,
  options: Omit<SafeHttpOptions, "maxRedirects"> & { allowedOrigin: string },
): Promise<SafeHttpResult> {
  if (bearerToken.trim() === "") throw new Error("Bearer token is required");
  const endpointValidation = validateEndpointUrl(endpoint);
  const originValidation = validateEndpointUrl(options.allowedOrigin);
  if (!endpointValidation.ok || !originValidation.ok)
    throw new Error("Authenticated endpoint must be a valid HTTPS URL");
  if (
    endpointValidation.url.protocol !== "https:" ||
    originValidation.url.protocol !== "https:" ||
    endpointValidation.url.origin !== originValidation.url.origin
  )
    throw new Error("Authenticated endpoint is outside the pinned origin");
  const headers = options.headers ?? {};
  if (
    Object.keys(headers).some((key) =>
      ["authorization", "cookie", "proxy-authorization"].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new Error("Authenticated request headers are managed internally");
  return boundedSafeHttpRequest(
    endpoint,
    {
      ...options,
      maxRedirects: 0,
      headers: { ...headers, authorization: `Bearer ${bearerToken}` },
    },
    true,
  );
}

export async function observeEndpoint(
  endpoint: string,
  options: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<EndpointObservationResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRedirects = options.maxRedirects ?? 2;
  let current = endpoint;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const validation = validateEndpointUrl(current);
    if (!validation.ok)
      return {
        endpoint,
        status: validation.status,
        httpStatus: null,
        latencyMs: null,
        redirectCount: redirects,
        errorCode: validation.code,
      };
    try {
      const addresses = await resolvePublicAddresses(validation.url.hostname);
      const response = await headRequest(validation.url, addresses, timeoutMs);
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.location !== null
      ) {
        if (redirects === maxRedirects)
          return {
            endpoint,
            status: "unreachable",
            httpStatus: response.status,
            latencyMs: response.latencyMs,
            redirectCount: redirects,
            errorCode: "redirect_limit",
          };
        current = new URL(response.location, validation.url).toString();
        continue;
      }
      return {
        endpoint,
        status:
          response.status >= 200 && response.status < 500
            ? "reachable"
            : "unreachable",
        httpStatus: response.status,
        latencyMs: response.latencyMs,
        redirectCount: redirects,
        errorCode: null,
      };
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "request_failed";
      return {
        endpoint,
        status: code === "ETIMEDOUT" ? "timeout" : "unreachable",
        httpStatus: null,
        latencyMs: null,
        redirectCount: redirects,
        errorCode: code,
      };
    }
  }
  throw new Error("Unreachable endpoint observer state");
}
