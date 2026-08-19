# BSC mainnet readiness

Audited 2026-08-18 from current official BNB SDK, APEX contract, ERC-8004,
8004scan, and hosting documentation. No mainnet write was performed.

## Deployed protocol support

| Component                  | BSC mainnet                                  |
| -------------------------- | -------------------------------------------- |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8183 commerce          | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| Evaluator router           | `0x51895229E12F9876011789B04f8698af06cCD6DA` |
| Optimistic policy          | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` |
| Payment token              | `0xcE24439F2D9C6a2289F741120FE202248B666666` |

Relic already stores chain ID independently on identities and activations. The
Phase 06 external candidates prove mainnet identities and services can enter
the same canonical model without colliding with the BSC-testnet reference
seller.

## Sponsorship and expected cost

The current BNB Agent SDK documents ERC-8004 sponsorship on BSC networks, but
mainnet ERC-8183 writes are explicitly self-paid. A nonzero job also requires
the service's payment token and may require a self-paid ERC-20 approval before
funding.

Observed real quotes:

- LP rebalancing: `0.1 U`, plus mainnet BNB gas.
- Grid trading: `0.1 U`, plus mainnet BNB gas.
- Yield optimisation: `1 U`, plus mainnet BNB gas.

Exact gas cost was not estimated by constructing an unsigned transaction
because the authorization boundary was already reached. Relic did not request,
buy, bridge, approve, or spend either asset.

## Architecture readiness

No commerce redesign is required. The existing provider boundary, chain-aware
identity tuple, service network field, activation chain ID, commerce/router/
policy evidence, and token fields support mainnet. Required operational work
is configuration and custody, not a new escrow architecture.

Before an authorized mainnet activation, Relic must still:

1. require an explicit mainnet flag and human transaction authorization;
2. verify current commerce/router/policy whitelist state read-only;
3. estimate native gas and payment-token allowance without broadcasting;
4. enforce a payment and gas cap;
5. persist receipt, block, token transfer, and effective gas price separately;
6. prevent testnet/reference evidence from being displayed as mainnet proof.

## Durable hosting and signer separation

Cloudflare Workers Free currently provides HTTPS, secrets, and a substantial
request allowance, but its 10 ms CPU limit, partial Node.js compatibility, and
ephemeral filesystem do not support the existing long-running Node watcher plus
encrypted-keystore runtime as-is. It is suitable for stateless discovery or an
ingress adapter, not for blindly uploading `.studio/wallets`.

AWS AgentCore supports longer-lived isolated runtimes and persistent session
filesystems, but it is consumption-priced rather than guaranteed `$0`; it also
requires an AWS/IAM and secret-management decision. It was not provisioned.

The SDK wallet interface remains pluggable: encrypted EVM keystore, TWAK, or a
custom remote/HSM provider can be injected without changing commerce logic.
Selecting or migrating custody is a human security decision. The Phase 05
keystore was not uploaded or copied.

## Verdict

Relic is structurally dual-network ready for read and catalog operations. It is
not authorized or operationally ready for mainnet writes until funding, caps,
and signer custody are explicitly approved. Real mainnet spend: **$0**.

## Primary references

- <https://github.com/bnb-chain/bnbagent-sdk>
- <https://github.com/bnb-chain/apex-contracts>
- <https://github.com/bnb-chain/apex-contracts/blob/main/scripts/addresses.ts>
- <https://8004scan.io/developers>
- <https://8004scan.io/networks>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html>
