# Relic health-factor seller

For any BNB Agent Studio operation, load the `/bnbagent-studio` skill first.

- `src/` is the canonical TypeScript health-factor and ERC-8183 implementation.
- `app/agent/` is a thin Studio compatibility layer; do not duplicate the
  health-factor business logic there.
- `.studio/` is local security state. Never commit, print, copy, or expose its
  encrypted keystores or environment file.
- Wallet signing must remain fixed application code and must never become an
  LLM-callable tool.
- The reference seller is BSC Testnet-only, read-only with respect to Venus,
  and zero-price.
