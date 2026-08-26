import ExecutionRoomPage, { metadata } from "../../[activationId]/page";

export { metadata };

export default function MandateExecutionRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ mandateId: string }>;
  searchParams: Promise<{ exactAuthorizationId?: string }>;
}) {
  return ExecutionRoomPage({
    params: params.then(({ mandateId }) => ({ activationId: mandateId })),
    searchParams,
  });
}
