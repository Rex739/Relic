"""BNB Agent Studio launch adapter for Relic's TypeScript reference seller.

BNB Agent Studio 0.0.5 scaffolds Python/ADK AgentCore projects and does not
provide a TypeScript scaffold. Relic's production seller already uses the
first-class ``@bnbagent/sdk`` TypeScript package, so this entrypoint preserves
that implementation instead of duplicating its protocol or health-factor
logic in Python.

Importing this module is side-effect free for ``bag doctor``. Executing it
hands the process to the seller package's existing ``dev`` script. An
AgentCore deployment descriptor is intentionally deferred until the native
AgentCore CLI is installed and the deployment packaging boundary is reviewed.
"""

from __future__ import annotations

import os
from pathlib import Path


SELLER_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    """Replace this adapter process with the canonical TypeScript seller."""
    tsx = SELLER_ROOT / "node_modules" / ".bin" / "tsx"
    service = SELLER_ROOT / "src" / "service.ts"
    if not tsx.is_file():
        raise RuntimeError(
            "TypeScript dependencies are not installed; run the monorepo's "
            "normal pnpm install before starting this seller"
        )
    os.chdir(SELLER_ROOT)
    os.execv(tsx, (str(tsx), str(service)))


if __name__ == "__main__":
    main()
