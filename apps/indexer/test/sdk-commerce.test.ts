import { describe, expect, it, vi } from "vitest";

import { SdkErc8183CommerceProvider } from "../src/sdk-commerce.js";

const tx = (suffix: string) => `0x${suffix.padStart(64, "0")}`;

const fakeClient = () => ({
  router: { address: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" },
  policy: {
    address: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
    disputeWindow: vi.fn(() => Promise.resolve(60n)),
  },
  commerce: { address: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" },
  paymentToken: vi.fn(() =>
    Promise.resolve("0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"),
  ),
  createJob: vi.fn(() =>
    Promise.resolve({
      transactionHash: tx("1"),
      status: 1,
      receipt: null,
      jobId: 7n,
    }),
  ),
  registerJob: vi.fn(() =>
    Promise.resolve({ transactionHash: tx("2"), status: 1, receipt: null }),
  ),
  setBudget: vi.fn(() =>
    Promise.resolve({ transactionHash: tx("3"), status: 1, receipt: null }),
  ),
  fund: vi.fn(() =>
    Promise.resolve({ transactionHash: tx("4"), status: 1, receipt: null }),
  ),
  getJob: vi.fn(() =>
    Promise.resolve({
      id: 7n,
      status: 1,
      deliverable: tx("0"),
      submittedAt: 0n,
    }),
  ),
  submit: vi.fn(),
  settle: vi.fn(() =>
    Promise.resolve({ transactionHash: tx("5"), status: 1, receipt: null }),
  ),
  cancelOpen: vi.fn(),
  claimRefund: vi.fn(),
});

describe("SDK ERC-8183 buyer", () => {
  it("executes the complete zero-price authorization sequence", async () => {
    const client = fakeClient();
    const provider = new SdkErc8183CommerceProvider(
      client as never,
      "0x1111111111111111111111111111111111111111",
      "https://seller.example/",
    );
    const jobId = await provider.createJob({
      provider: "0x1111111111111111111111111111111111111111",
      evaluator: client.router.address as `0x${string}`,
      expiresAt: 2_000_000_000n,
      description: "fixture",
      hook: client.router.address as `0x${string}`,
      budget: 0n,
    });
    await provider.registerJob(jobId);
    await provider.setBudget(jobId, 0n);
    await provider.fundJob(jobId, 0n);
    expect(client.setBudget).toHaveBeenCalledWith(7n, 0n);
    expect(client.fund).toHaveBeenCalledWith(7n, 0n);
    expect(provider.drainEvidence().map(({ operation }) => operation)).toEqual([
      "createJob",
      "registerJob",
      "setBudget(0)",
      "fund(0)",
    ]);
  });

  it("refreshes idempotently without writing", async () => {
    const client = fakeClient();
    const provider = new SdkErc8183CommerceProvider(
      client as never,
      "0x1111111111111111111111111111111111111111",
      "https://seller.example/",
    );
    await provider.refreshJob(7n);
    await provider.refreshJob(7n);
    expect(client.getJob).toHaveBeenCalledTimes(2);
    expect(provider.drainEvidence()).toEqual([]);
  });

  it("rejects any accidental paid activation", async () => {
    const provider = new SdkErc8183CommerceProvider(
      fakeClient() as never,
      "0x1111111111111111111111111111111111111111",
      "https://seller.example/",
    );
    await expect(provider.fundJob(7n, 1n)).rejects.toThrow(/zero-price/);
  });

  it("surfaces failed negotiation without creating a job", async () => {
    const client = fakeClient();
    const provider = new SdkErc8183CommerceProvider(
      client as never,
      "0x1111111111111111111111111111111111111111",
      "https://seller.example/",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "rejected" }), { status: 409 }),
        ),
      ),
    );
    await expect(provider.negotiate({ terms: {} })).rejects.toThrow(
      /negotiation failed/,
    );
    expect(client.createJob).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("surfaces settlement failure and records no false evidence", async () => {
    const client = fakeClient();
    client.settle.mockRejectedValueOnce(new Error("fixture settlement revert"));
    const provider = new SdkErc8183CommerceProvider(
      client as never,
      "0x1111111111111111111111111111111111111111",
      "https://seller.example/",
    );
    await expect(provider.settle(7n, "0x")).rejects.toThrow(
      /settlement revert/,
    );
    expect(provider.drainEvidence()).toEqual([]);
  });
});
