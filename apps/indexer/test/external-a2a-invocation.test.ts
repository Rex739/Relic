import { describe, expect, it } from "vitest";

import { parseSignedA2aQuote } from "../src/external-a2a-invocation.js";

describe("external A2A invocation evidence", () => {
  it("accepts a signed negotiation envelope without treating it as commerce", () => {
    const parsed = parseSignedA2aQuote({
      jsonrpc: "2.0",
      result: {
        taskId: "task-1",
        contextId: "context-1",
        parts: [
          {
            kind: "data",
            data: {
              request_hash: `0x${"1".repeat(64)}`,
              response_hash: `0x${"2".repeat(64)}`,
              negotiation_hash: `0x${"3".repeat(64)}`,
              provider_sig: `0x${"4".repeat(130)}`,
              chain_id: 56,
              verifying_contract: `0x${"5".repeat(40)}`,
              response: {
                accepted: true,
                terms: {
                  price: "100000000000000000",
                  currency: `0x${"6".repeat(40)}`,
                },
                negotiated_at: 1,
                quote_expires_at: 2,
              },
            },
          },
        ],
      },
    });
    expect(parsed.quote.response.terms.price).toBe("100000000000000000");
    expect(parsed.quote.chain_id).toBe(56);
  });

  it("rejects an unsigned or malformed response", () => {
    expect(() =>
      parseSignedA2aQuote({
        jsonrpc: "2.0",
        result: { taskId: "task", contextId: "context", parts: [] },
      }),
    ).toThrow(/no data part/);
  });
});
