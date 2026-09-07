# Relic Yield Optimizer

The optimizer is a separate executable agent. `RelicYieldScout` remains a
read-only observer and is not promoted to a signer.

The first release permits only BSC Testnet USDT approvals, Venus supply, and
Venus withdrawal after a Relic-bound buyer mandate passes the fixed policy.
All deployment addresses are injected at runtime and must be verified before
the private executor becomes ready.

This folder intentionally contains no wallet, session file, RPC credential, or
deployment address default.
