export interface MetadataResolver {
  resolve(uri: string): Promise<unknown>;
}

export interface HttpMetadataResolverOptions {
  readonly ipfsGateway?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export class HttpMetadataResolver implements MetadataResolver {
  readonly #ipfsGateway: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  public constructor(options: HttpMetadataResolverOptions = {}) {
    this.#ipfsGateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxBytes = options.maxBytes ?? 1_000_000;
  }

  public async resolve(uri: string): Promise<unknown> {
    if (uri.startsWith("data:application/json;base64,")) {
      const encoded = uri.slice("data:application/json;base64,".length);
      return JSON.parse(
        Buffer.from(encoded, "base64").toString("utf8"),
      ) as unknown;
    }
    if (uri.startsWith("data:application/json,")) {
      return JSON.parse(
        decodeURIComponent(uri.slice("data:application/json,".length)),
      ) as unknown;
    }

    const url = uri.startsWith("ipfs://")
      ? new URL(uri.slice("ipfs://".length), this.#ipfsGateway).toString()
      : uri;
    let parsedUrl = new URL(url);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicHttpUrl(parsedUrl);
      response = await fetch(parsedUrl, {
        signal: AbortSignal.timeout(this.#timeoutMs),
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (location === null)
        throw new Error("Metadata redirect has no location");
      parsedUrl = new URL(location, parsedUrl);
    }
    if (
      response === undefined ||
      [301, 302, 303, 307, 308].includes(response.status)
    ) {
      throw new Error("Agent metadata exceeded the redirect limit");
    }
    if (!response.ok) {
      throw new Error(`Metadata request failed with HTTP ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > this.#maxBytes) {
      throw new Error(`Agent metadata exceeds ${this.#maxBytes} bytes`);
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > this.#maxBytes) {
      throw new Error(`Agent metadata exceeds ${this.#maxBytes} bytes`);
    }
    return JSON.parse(body) as unknown;
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  )
    return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 224 ||
    first === 255
  );
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`Unsupported agent metadata URI scheme: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "")
    throw new Error("Metadata URLs cannot contain credentials");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("Agent metadata URL resolves to a private network");
  }
  const addresses =
    isIP(url.hostname) === 0
      ? await lookup(url.hostname, { all: true, verbatim: true })
      : [{ address: url.hostname }];
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("Agent metadata URL resolves to a private network");
  }
}
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
