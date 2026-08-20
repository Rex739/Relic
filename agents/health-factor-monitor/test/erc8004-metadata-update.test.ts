import { describe, expect, it } from "vitest";

import { replaceSingleEndpoint } from "../src/erc8004-metadata-update.js";

describe("ERC-8004 endpoint-only metadata update", () => {
  it("changes exactly one service endpoint and preserves the source", () => {
    const current = {
      description: "preserve",
      registrations: [{ agentId: 1840, agentRegistry: "eip155:97:test" }],
      services: [{ endpoint: "https://old.test/erc8183", name: "ERC8183" }],
      type: "registration-v1",
    };
    const result = replaceSingleEndpoint(
      current,
      "https://old.test/erc8183",
      "https://new.test/erc8183",
    );
    expect(result.path).toBe("$.services[0].endpoint");
    expect(result.metadata).toEqual({
      ...current,
      services: [{ endpoint: "https://new.test/erc8183", name: "ERC8183" }],
    });
    expect(current.services[0]?.endpoint).toBe("https://old.test/erc8183");
  });

  it("fails closed when the old URL is absent or duplicated", () => {
    expect(() => replaceSingleEndpoint({}, "old", "new")).toThrow("found 0");
    expect(() =>
      replaceSingleEndpoint(
        {
          services: [
            { endpoint: "old", name: "one" },
            { endpoint: "old", name: "two" },
          ],
        },
        "old",
        "new",
      ),
    ).toThrow("found 2");
  });
});
