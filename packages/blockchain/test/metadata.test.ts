import { describe, expect, it } from "vitest";

import { HttpMetadataResolver } from "../src/index.js";

describe("ERC-8004 metadata resolver", () => {
  it("reads base64 data URIs without network access", async () => {
    const resolver = new HttpMetadataResolver();
    const payload = Buffer.from(
      JSON.stringify({ name: "Real URI shape" }),
    ).toString("base64");
    await expect(
      resolver.resolve(`data:application/json;base64,${payload}`),
    ).resolves.toEqual({ name: "Real URI shape" });
  });

  it("rejects unsupported schemes", async () => {
    const resolver = new HttpMetadataResolver();
    await expect(resolver.resolve("file:///etc/passwd")).rejects.toThrow(
      "Unsupported",
    );
  });

  it("blocks private-network metadata targets", async () => {
    const resolver = new HttpMetadataResolver();
    await expect(
      resolver.resolve("http://127.0.0.1/agent.json"),
    ).rejects.toThrow("private network");
  });
});
