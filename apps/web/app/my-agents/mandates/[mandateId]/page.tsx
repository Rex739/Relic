import ExecutionRoomPage, { metadata } from "../../[activationId]/page";

export { metadata };

export default function MandateExecutionRoomPage({
  params,
}: {
  params: Promise<{ mandateId: string }>;
}) {
  return ExecutionRoomPage({
    params: params.then(({ mandateId }) => ({ activationId: mandateId })),
  });
}
