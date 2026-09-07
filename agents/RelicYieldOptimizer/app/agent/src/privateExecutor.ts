import { verifyVenusDeployment } from "./deploymentVerifier.js";
import { executeSupplyWithdrawal, type VenusExecutionReader } from "./executionBridge.js";
import { parseVerifiedFundedYieldRequest } from "./fundedExecutionRequest.js";
import type { YieldJobStore } from "./jobState.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { VenusReadClient } from "./deploymentVerifier.js";
import type { PrivateYieldExecutor } from "./privateRuntime.js";
import type { SessionTransactionSigner } from "./signerBoundary.js";

export type YieldExecutionDependencies = Readonly<{
  signer: SessionTransactionSigner;
  reader: VenusExecutionReader;
  store: YieldJobStore;
}>;

/**
 * Runtime composition root. Readiness is fail-closed: an unavailable or
 * changed protocol deployment prevents Layer B from reaching execution.
 *
 * Execution is deliberately disabled until the scoped-session adapter and
 * durable job-store bridge are attached in the following subphase.
 */
export class YieldPrivateExecutor implements PrivateYieldExecutor {
  public constructor(
    private readonly config: VenusTestnetConfig,
    private readonly venus: VenusReadClient,
    private readonly execution?: YieldExecutionDependencies,
  ) {}

  async readiness(): Promise<{ ready: boolean; detail?: string }> {
    try {
      await verifyVenusDeployment(this.venus, this.config);
      return { ready: true };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : "deployment verification failed" };
    }
  }

  async handleA2a(body: unknown): Promise<{ status: number; body: unknown }> {
    const readiness = await this.readiness();
    if (!readiness.ready) return { status: 503, body: { error: "executor_not_ready", detail: readiness.detail } };
    if (!this.execution) {
      return { status: 503, body: { error: "executor_not_enabled", detail: "Durable funded-job execution wiring is not enabled" } };
    }
    try {
      const request = parseVerifiedFundedYieldRequest(body);
      const job = await executeSupplyWithdrawal({ ...request, config: this.config, ...this.execution });
      return {
        status: job.state === "RECOVERY_REQUIRED" ? 409 : 200,
        body: {
          id: job.id,
          commerceJobId: job.commerceJobId,
          state: job.state,
          approvalTxHash: job.approvalTxHash,
          supplyTxHash: job.supplyTxHash,
          withdrawTxHash: job.withdrawTxHash,
          recoveryReason: job.recoveryReason,
        },
      };
    } catch (error) {
      return { status: 422, body: { error: "execution_rejected", detail: error instanceof Error ? error.message : "invalid execution request" } };
    }
  }
}
