import { describe, expect, it } from "vitest";

import {
  isPublicIpAddress,
  safeHttpRequest,
  validateEndpointUrl,
} from "../src/endpoint-observer.js";

describe("safe endpoint observation boundaries", () => {
  it("rejects private, loopback, link-local, and mapped private addresses", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.1.2.3")).toBe(false);
    expect(isPublicIpAddress("169.254.1.1")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:192.168.1.1")).toBe(false);
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
  });

  it("allows only credential-free HTTP(S) on standard ports", () => {
    expect(validateEndpointUrl("file:///etc/passwd")).toMatchObject({
      ok: false,
      status: "unsupported_protocol",
    });
    expect(
      validateEndpointUrl("https://user:secret@example.com"),
    ).toMatchObject({
      ok: false,
      code: "embedded_credentials",
    });
    expect(validateEndpointUrl("https://example.com:8443")).toMatchObject({
      ok: false,
      code: "disallowed_port",
    });
    expect(validateEndpointUrl("https://example.com/health")).toMatchObject({
      ok: true,
    });
  });

  it("refuses credentials before issuing a request", async () => {
    await expect(
      safeHttpRequest("https://example.com", {
        headers: { authorization: "Bearer secret" },
      }),
    ).rejects.toThrow(/cannot send credentials/);
  });
});
