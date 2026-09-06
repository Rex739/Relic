import type { DrizzleCommerceStore } from "@relic/database";

import { ExecutionApplicationService } from "./executions.js";

const positionManager = "0x427bF5b37357632377eCbEC9de3626C71A5396c1";

/**
 * Converts a verified, funded ERC-8183 LP job into the mandate it was created
 * for. The public agent never receives a mandate ID or buyer session key: the
 * mapping is resolved exclusively from Relic's activation record.
 */
export class LpRebalanceAgentBridge {
  public constructor(
    private readonly commerce: DrizzleCommerceStore,
    private readonly executions: ExecutionApplicationService,
  ) {}

  public async executeFundedJob(jobId: string) {
    if (!/^\d+$/u.test(jobId)) throw new Error("Invalid ERC-8183 job id");
    const row = await this.commerce.findFundedLpRebalanceMandate(jobId);
    if (row === undefined)
      throw new Error("No active, funded BSC Testnet LP mandate is bound to this job");

    const constraints = row.version.riskConstraints as Record<string, unknown>;
    const positionTokenId = constraints.positionTokenId;
    const capitalCap = constraints.capitalCap;
    const rangeWidthBps = constraints.rangeWidthBps;
    if (
      typeof positionTokenId !== "string" ||
      !/^[1-9]\d*$/u.test(positionTokenId) ||
      typeof capitalCap !== "string" ||
      !/^\d+(?:\.\d+)?$/u.test(capitalCap) ||
      typeof rangeWidthBps !== "number" ||
      !Number.isInteger(rangeWidthBps)
    )
      throw new Error("The funded LP mandate has incomplete rebalance constraints");

    return this.executions.request(
      row.mandate.principalId,
      row.mandate.id,
      `erc8183-lp-rebalance:${row.activation.id}:${jobId}`,
      {
        mandateId: row.mandate.id,
        mandateVersion: row.mandate.currentVersion,
        agentId: row.mandate.agentId,
        chainId: 97,
        actionType: "rebalance_liquidity",
        capability: "submit_transactions",
        protocol: "PancakeSwap",
        target: positionManager,
        asset: "TEST_USDT",
        amount: capitalCap,
        destination: null,
        parameters: { positionTokenId, rangeWidthBps, maxSlippageBps: 50 },
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
        source: { kind: "northflank_verified_erc8183_job", jobId },
      },
    );
  }
}
