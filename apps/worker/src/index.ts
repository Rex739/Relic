import { z } from "zod";

export const ingestionJobSchema = z.object({
  type: z.literal("registry.scan"),
  chainId: z.number().int().positive(),
  cursor: z
    .object({
      blockNumber: z.string().regex(/^\d+$/),
      logIndex: z.number().int().nonnegative(),
    })
    .nullable(),
  limit: z.number().int().min(1).max(100),
});
export type IngestionJob = z.infer<typeof ingestionJobSchema>;

export interface QueueMessage<T> {
  readonly body: T;
  acknowledge(): void;
  retry(): void;
}

export interface RegistryScanHandler {
  handle(job: IngestionJob): Promise<void>;
}

export function createQueueConsumer(handler: RegistryScanHandler) {
  return async (messages: readonly QueueMessage<unknown>[]): Promise<void> => {
    for (const message of messages) {
      const result = ingestionJobSchema.safeParse(message.body);
      if (!result.success) {
        message.acknowledge();
        continue;
      }
      try {
        await handler.handle(result.data);
        message.acknowledge();
      } catch (error) {
        message.retry();
        throw error;
      }
    }
  };
}

export interface ScheduledRegistryScan {
  enqueue(job: IngestionJob): Promise<void>;
}

export function createCronHandler(
  queue: ScheduledRegistryScan,
  chainId: number,
) {
  return () =>
    queue.enqueue({ type: "registry.scan", chainId, cursor: null, limit: 50 });
}
