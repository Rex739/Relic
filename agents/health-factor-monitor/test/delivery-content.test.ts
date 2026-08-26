import { describe, expect, it } from "vitest";

import { normalizeDeliveryContent } from "../src/delivery-content.js";

describe("delivery response serialization", () => {
  it("parses legacy string storage without spreading string characters", () => {
    expect(normalizeDeliveryContent('{"version":"1.0","jobId":647}')).toEqual({
      version: "1.0",
      jobId: 647,
    });
  });

  it("preserves already parsed canonical delivery content", () => {
    const manifest = { version: "1.0", response: { content: "result" } };
    expect(normalizeDeliveryContent(manifest)).toBe(manifest);
  });

  it.each([null, [], "null", '"text"'])(
    "rejects non-object delivery content: %j",
    (value) => {
      expect(() => normalizeDeliveryContent(value)).toThrow(
        "Persisted delivery content must be a JSON object",
      );
    },
  );
});
