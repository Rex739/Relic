# Relic Studio agent layer

This is the minimum compatibility layer recognized by BNB Agent Studio 0.0.5.
It does not reimplement the seller. `main.py` launches the canonical
TypeScript `@bnbagent/sdk` service in `../../src/service.ts`.

The installed Studio CLI only scaffolds Python with the ADK framework. Relic
does not falsely declare ADK here because the seller is deterministic and has
no LLM dependency. The `agentcore` runtime and A2A protocol values describe
the Studio launch contract; native AgentCore packaging remains intentionally
deferred until its CLI is installed.
