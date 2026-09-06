---
name: bnbagent-studio-buying-via-mpp
description: When the user wants an agent to buy from a native MPP+B402 endpoint. Covers trust, quote, buy, recipe wiring, wallet limits, and unknown payment outcomes.
---

> **Reference file** of the `bnbagent-studio` router skill, installed at `bnbagent-studio/references/` and loaded on demand (not a standalone skill).

# Buy via native MPP+B402

MPP and x402 are parallel alternatives. Use this flow only when the server returns a native `WWW-Authenticate: Payment` challenge with method `b402` and intent `charge`. Never route an x402 402 body into this buyer and never add automatic protocol fallback.

## Trust, inspect, then buy

```bash
bag mpp trust https://seller.example/mpp --yes
bag mpp quote https://seller.example/mpp
bag mpp buy https://seller.example/mpp --max-usd 0.10
```

`trust` is an unpaid probe. Review the live domain, realm, recipient, CAIP-2 network, token address, EIP-3009 method, price, and cap. For an unreviewed endpoint, verify the realm and recipient out-of-band. The resulting `[payments.mpp.merchants.*]` entry pins all of them before any typed data is signed.

P0 supports only:

- `wallet.kind = "evm-local"` or an equivalent wallet exposing `sign.typed_data`;
- native MPP `b402.charge`;
- B402's pinned BSC mainnet/testnet U facts;
- EIP-3009;
- one paid dispatch per call.

TWAK's delegated `x402.pay` permission is not generic EIP-712 signing, and Altana's current session interface does not expose the required signing surface. Both must fail before payment.

## Wire the agent tools

```bash
bag recipe code mpp-buyer
```

This emits `mppBuyer.ts` with `quote_mpp` and `buy_with_mpp`. Spread `MPP_BUYER_TOOLS` into the generated AgentCore or Azure Foundry AI SDK tool map. Runtime enforcement remains in `@bnbagent/studio-runtime/mpp`; the LLM can tighten `max_usd` but cannot widen configured merchant or daily caps or choose another recipient.

## Unknown means stop

After `Authorization: Payment` crosses the fetch boundary, a timeout, connection loss, or paid response without a successful `Payment-Receipt` is an `unknown` outcome. Studio records `mpp_buy` with status `unknown`. Do not retry automatically or tell the user to rerun blindly. Reconcile the wallet/facilitator/seller state first; another request can create another payment.

Use `--local-dev` only for an operator-owned loopback endpoint. It permits plain HTTP and pins recipient plus realm from the live challenge for that invocation; it is not a production trust mechanism.
