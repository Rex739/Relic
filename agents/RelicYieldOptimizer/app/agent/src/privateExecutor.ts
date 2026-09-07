import { verifyVenusDeployment } from "./deploymentVerifier.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { VenusReadClient } from "./deploymentVerifier.js";
import type { PrivateYieldExecutor } from "./privateRuntime.js";

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
  ) {}

  async readiness(): Promise<{ ready: boolean; detail?: string }> {
    try {
      await verifyVenusDeployment(this.venus, this.config);
      return { ready: true };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : "deployment verification failed" };
    }
  }

  async handleA2a(_body: unknown): Promise<{ status: number; body: unknown }> {
    const readiness = await this.readiness();
    if (!readiness.ready) return { status: 503, body: { error: "executor_not_ready", detail: readiness.detail } };
    return {
      status: 503,
      body: { error: "executor_not_enabled", detail: "Scoped-session execution wiring is not enabled" },
    };
  }
}
