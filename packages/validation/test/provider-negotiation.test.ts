import { describe, expect, it, vi } from "vitest";

import {
  negotiateOfferBoundService,
  type ProviderRequester,
} from "../src/index.js";

const input = {
  endpoint: "https://agent.example/.well-known/agent-card.json",
  interfaceProtocol: "a2a",
  agreementId: "agreement-1",
  offerId: "offer-1",
  offerVersionId: "version-1",
  capability: "market-analysis",
  terms: "Return a bounded market analysis.",
  termsHash: `0x${"11".repeat(32)}`,
  limitations: ["Does not move funds"],
  chainId: 97,
  amountBaseUnits: "1000000000",
  paymentTokenAddress: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
};

const result = {
  jsonrpc: "2.0",
  result: {
    taskId: "task-1",
    contextId: "context-1",
    parts: [
      {
        kind: "data",
        data: {
          request_hash: `0x${"22".repeat(32)}`,
          response_hash: `0x${"33".repeat(32)}`,
          negotiation_hash: `0x${"44".repeat(32)}`,
          provider_sig: `0x${"55".repeat(65)}`,
          chain_id: 97,
          verifying_contract: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
          response: {
            accepted: true,
            terms: {
              price: "1000000000",
              currency: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
            },
            negotiated_at: 1_000,
            quote_expires_at: 1_900,
          },
        },
      },
    ],
  },
};

describe("offer-bound provider negotiation", () => {
  it("derives the request from the persisted offer and accepts an exact quote", async () => {
    const requesterMock = vi
      .fn<ProviderRequester>()
      .mockResolvedValueOnce({
        endpoint: input.endpoint,
        ok: true,
        status: 200,
        latencyMs: 1,
        redirectCount: 0,
        headers: {},
        body: JSON.stringify({
          url: "https://agent.example/invoke",
          skills: [{ id: "negotiate" }],
        }),
        errorCode: null,
      })
      .mockResolvedValueOnce({
        endpoint: "https://agent.example/invoke",
        ok: true,
        status: 200,
        latencyMs: 1,
        redirectCount: 0,
        headers: {},
        body: JSON.stringify(result),
        errorCode: null,
      });
    const requester: ProviderRequester = requesterMock;
    const negotiated = await negotiateOfferBoundService(input, {
      requester,
      messageId: "message-1",
    });
    expect(negotiated.quote.response.terms.price).toBe("1000000000");
    const postedBody = requesterMock.mock.calls[1]?.[1]?.body;
    expect(typeof postedBody).toBe("string");
    const posted: unknown = JSON.parse(postedBody!);
    expect(posted).toMatchObject({
      params: {
        message: {
          parts: [
            {
              data: {
                skill: "negotiate",
                task_description:
                  "Execute capability market-analysis under the exact Relic marketplace offer bound to agreement agreement-1.",
                terms: {
                  price: "1000000000",
                  currency: input.paymentTokenAddress,
                  relic_offer: {
                    offer_id: "offer-1",
                    terms_hash: input.termsHash,
                  },
                },
              },
            },
          ],
        },
      },
    });
  });

  it("fails closed when the provider changes the offer price", async () => {
    const changed = structuredClone(result);
    changed.result.parts[0]!.data.response.terms.price = "1000000001";
    const requester: ProviderRequester = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          url: "https://agent.example/invoke",
          skills: [{ id: "negotiate" }],
        }),
        endpoint: input.endpoint,
        latencyMs: 1,
        redirectCount: 0,
        headers: {},
        errorCode: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify(changed),
        endpoint: "https://agent.example/invoke",
        latencyMs: 1,
        redirectCount: 0,
        headers: {},
        errorCode: null,
      });
    await expect(
      negotiateOfferBoundService(input, { requester }),
    ).rejects.toThrow("price does not match");
  });

  it("does not select behavior from an agent id or category", async () => {
    await expect(
      negotiateOfferBoundService(
        { ...input, interfaceProtocol: "custom" },
        { requester: vi.fn() },
      ),
    ).rejects.toThrow("not supported");
  });

});
