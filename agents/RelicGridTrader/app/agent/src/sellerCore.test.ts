import assert from "node:assert/strict";
import test from "node:test";
import { SellerCore, type SigningApi } from "./sellerCore.js";

function signingFake(onSign: (price: bigint) => void): SigningApi {
  return {
    listPrice: () => 10n,
    clampPrice: (price) => price,
    assertPriceWithinBounds: (price) => {
      if (price < 1n || price > 1000n) throw new Error("outside configured bounds");
      return price;
    },
    signQuote: async (_request, price) => {
      onSign(price);
      return { accepted: true, response: { terms: { price: String(price) } } };
    },
    verifySignedJob: async () => ({ ok: true, reason: "", permanent: false }),
    jobSpec: async () => null,
    submitResult: async () => ({ submitTx: "0x", deliverableUrl: null }),
  };
}

test("signs the exact Relic listing price rather than the local fallback", async () => {
  let signedPrice: bigint | undefined;
  const core = new SellerCore({
    generator: "test",
    runWork: async () => "",
    signing: signingFake((price) => {
      signedPrice = price;
    }),
  });

  await core.negotiate({
    task_description: "Run the configured grid",
    terms: {
      price: "275",
      currency: "0xtoken",
      relic_offer: { offer_id: "offer-1" },
    },
  });

  assert.equal(signedPrice, 275n);
});

test("rejects a malformed Relic marketplace price before signing", async () => {
  const core = new SellerCore({
    generator: "test",
    runWork: async () => "",
    signing: signingFake(() => assert.fail("must not sign")),
  });

  await assert.rejects(
    core.negotiate({ terms: { price: "0.01", relic_offer: { offer_id: "offer-1" } } }),
    /whole base-unit string/,
  );
});
