import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";

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

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
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
): { ok: true; url: URL } | { ok: false; code: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, code: "unsupported_protocol" };
  if (url.username !== "" || url.password !== "")
    return { ok: false, code: "embedded_credentials" };
  if (
    (url.protocol === "http:" && url.port !== "" && url.port !== "80") ||
    (url.protocol === "https:" && url.port !== "" && url.port !== "443")
  )
    return { ok: false, code: "disallowed_port" };
  return { ok: true, url };
}

async function publicAddresses(hostname: string) {
  const literal = isIP(hostname);
  const addresses =
    literal === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: literal }];
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  )
    throw Object.assign(new Error("Endpoint is not public"), {
      code: "private_or_unresolved_address",
    });
  return addresses;
}

function requestOnce(
  url: URL,
  addresses: Awaited<ReturnType<typeof publicAddresses>>,
  options: Required<
    Pick<SafeHttpOptions, "method" | "timeoutMs" | "maxResponseBytes">
  > &
    Pick<SafeHttpOptions, "headers" | "body">,
) {
  const started = performance.now();
  const transport = url.protocol === "https:" ? https : http;
  return new Promise<{
    status: number;
    location: string | null;
    latencyMs: number;
    headers: Record<string, string | string[]>;
    body: string;
  }>((resolve, reject) => {
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
          "user-agent": "Relic-Service-Client/1.0",
          ...(options.headers ?? {}),
        },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      },
      (response) => {
        const declared = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
          response.destroy();
          reject(
            Object.assign(new Error("Response too large"), {
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
              Object.assign(new Error("Response too large"), {
                code: "response_too_large",
              }),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            latencyMs: performance.now() - started,
            headers: Object.fromEntries(
              Object.entries(response.headers).flatMap(([key, value]) =>
                value === undefined ? [] : [[key, value]],
              ),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
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

async function boundedRequest(
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
    throw new Error("Service request cannot send credentials");
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
      const response = await requestOnce(
        validation.url,
        await publicAddresses(validation.url.hostname),
        {
          method,
          timeoutMs,
          maxResponseBytes,
          headers,
          ...(options.body === undefined ? {} : { body: options.body }),
        },
      );
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.location !== null
      ) {
        if (method === "POST" || redirects === maxRedirects)
          return {
            endpoint,
            ok: false,
            ...response,
            redirectCount: redirects,
            errorCode:
              method === "POST" ? "post_redirect_refused" : "redirect_limit",
          };
        current = new URL(response.location, validation.url).toString();
        continue;
      }
      return {
        endpoint,
        ok: response.status >= 200 && response.status < 500,
        ...response,
        redirectCount: redirects,
        errorCode: null,
      };
    } catch (error) {
      return {
        endpoint,
        ok: false,
        status: null,
        latencyMs: null,
        redirectCount: redirects,
        headers: {},
        body: "",
        errorCode:
          error !== null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "request_failed",
      };
    }
  }
  throw new Error("Unreachable safe request state");
}

export const safeHttpRequest = (
  endpoint: string,
  options: SafeHttpOptions = {},
) => boundedRequest(endpoint, options, false);

export async function safeBearerHttpRequest(
  endpoint: string,
  bearerToken: string,
  options: Omit<SafeHttpOptions, "maxRedirects"> & { allowedOrigin: string },
) {
  if (bearerToken.trim() === "") throw new Error("Bearer token is required");
  const target = validateEndpointUrl(endpoint);
  const allowed = validateEndpointUrl(options.allowedOrigin);
  if (
    !target.ok ||
    !allowed.ok ||
    target.url.protocol !== "https:" ||
    target.url.origin !== allowed.url.origin
  )
    throw new Error(
      "Authenticated endpoint is outside the pinned HTTPS origin",
    );
  if (
    Object.keys(options.headers ?? {}).some((key) =>
      ["authorization", "cookie", "proxy-authorization"].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new Error("Authenticated request headers are managed internally");
  return boundedRequest(
    endpoint,
    {
      ...options,
      maxRedirects: 0,
      headers: {
        ...(options.headers ?? {}),
        authorization: `Bearer ${bearerToken}`,
      },
    },
    true,
  );
}
