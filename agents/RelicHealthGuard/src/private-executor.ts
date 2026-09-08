import { executeHealthGuardCycle, type HealthGuardCycleIdentity, type HealthGuardCycleStore, type HealthGuardReader } from "./executor.js";
import { parseFundedHealthGuardJob } from "./funded-job.js";
import type { HealthGuardConfig } from "./config.js";
import type { BoundedSessionSigner } from "./signer.js";

export type HealthGuardExecutionDependencies = Readonly<{
  signer: BoundedSessionSigner;
  reader: HealthGuardReader;
  cycles: HealthGuardCycleStore;
}>;

export type HealthGuardExecutionDependencyFactory = (input: {
  commerceJobId: string;
  canonicalJob: ReturnType<typeof parseFundedHealthGuardJob>;
}) => Promise<HealthGuardExecutionDependencies>;

/** Mainnet private composition root; it refuses raw browser-supplied mandates. */
export class HealthGuardPrivateExecutor {
  public constructor(
    private readonly config: HealthGuardConfig,
    private readonly readinessCheck: () => Promise<void>,
    private readonly canonicalRequest: (commerceJobId: string) => Promise<unknown>,
    private readonly dependencies: HealthGuardExecutionDependencyFactory,
  ) {}

  async readiness(): Promise<{ ready: boolean; detail?: string }> {
    try {
      await this.readinessCheck();
      return { ready: true };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : "Mainnet deployment verification failed" };
    }
  }

  async runCycle(input: { commerceJobId: string; cycle: HealthGuardCycleIdentity }): Promise<{
    status: number;
    body: unknown;
  }> {
    const readiness = await this.readiness();
    if (!readiness.ready) return { status: 503, body: { error: "executor_not_ready", detail: readiness.detail } };
    try {
      const canonicalJob = parseFundedHealthGuardJob(await this.canonicalRequest(input.commerceJobId));
      if (canonicalJob.mandate.jobId !== input.commerceJobId)
        throw new Error("Health Guard canonical request belongs to a different commerce job");
      const execution = await this.dependencies({ commerceJobId: input.commerceJobId, canonicalJob });
      const result = await executeHealthGuardCycle({
        config: this.config,
        job: canonicalJob,
        cycle: input.cycle,
        ...execution,
      });
      return { status: result.state === "RECOVERY_REQUIRED" ? 409 : 200, body: { commerceJobId: input.commerceJobId, cycleId: input.cycle.id, ...result } };
    } catch (error) {
      return { status: 422, body: { error: "execution_rejected", detail: error instanceof Error ? error.message : "invalid funded job" } };
    }
  }
}
