import { createHash } from "node:crypto";
import type { HealthGuardPrivateExecutor } from "./private-executor.js";

const UUID_VERSION = 0x50;
const UUID_VARIANT = 0x80;

/** Deterministic UUIDv5-shaped delivery ID: retries in the same slot are identical. */
export function deliveryId(commerceJobId: string, slot: number): string {
  const digest = createHash("sha256").update(`relic-health-guard:${commerceJobId}:${String(slot)}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | UUID_VERSION;
  bytes[8] = (bytes[8]! & 0x3f) | UUID_VARIANT;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type HealthGuardJobDirectory = Readonly<{ list(limit?: number): Promise<readonly string[]> }>;
export type HealthGuardSchedulerResult = Readonly<{ attempted: number; succeeded: number; recoveryRequired: number; failed: number }>;

/**
 * Polls only Relic's internal eligible-job directory. It never owns a session,
 * manufactures mandates, or uses a random retry key.
 */
export class HealthGuardScheduler {
  private running = false;
  public constructor(
    private readonly directory: HealthGuardJobDirectory,
    private readonly executor: Pick<HealthGuardPrivateExecutor, "runCycle">,
    private readonly config: Readonly<{ pollSeconds: number; maxJobsPerTick?: number }>,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(config.pollSeconds) || config.pollSeconds < 60 || config.pollSeconds > 3_600)
      throw new Error("Health Guard poll interval must be between 60 seconds and one hour");
  }

  async tick(): Promise<HealthGuardSchedulerResult> {
    if (this.running) return { attempted: 0, succeeded: 0, recoveryRequired: 0, failed: 0 };
    this.running = true;
    try {
      const jobs = await this.directory.list(this.config.maxJobsPerTick ?? 100);
      const slot = Math.floor(this.now().getTime() / (this.config.pollSeconds * 1_000));
      let succeeded = 0;
      let recoveryRequired = 0;
      let failed = 0;
      for (const commerceJobId of jobs) {
        try {
          const result = await this.executor.runCycle({
            commerceJobId,
            cycle: {
              id: deliveryId(commerceJobId, slot),
              idempotencyKey: `health-guard-cycle:${commerceJobId}:${String(slot)}`,
            },
          });
          if (result.status === 200) succeeded += 1;
          else if (result.status === 409) recoveryRequired += 1;
          else failed += 1;
        } catch {
          // Continue other isolated buyer jobs; the next identical slot retry is safe.
          failed += 1;
        }
      }
      return { attempted: jobs.length, succeeded, recoveryRequired, failed };
    } finally {
      this.running = false;
    }
  }

  start(log: (result: HealthGuardSchedulerResult) => void = () => undefined): () => void {
    const run = () => { void this.tick().then(log).catch(() => undefined); };
    run();
    const timer = setInterval(run, this.config.pollSeconds * 1_000);
    return () => clearInterval(timer);
  }
}
