import { cookies } from "next/headers";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

async function proxy(
  request: Request,
  params: Promise<{ id: string; operationId: string }>,
) {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined)
    return Response.json({ error: "Connect a wallet" }, { status: 401 });
  const { id, operationId } = await params;
  const response = await fetch(
    `${apiUrl()}/v1/commerce-agreements/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}/wallet-transaction`,
    {
      method: request.method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(request.method === "POST"
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
    },
  );
  const payload = (await response.json()) as {
    data?: unknown;
    error?: { message?: string };
  };
  return Response.json(
    payload.data ?? {
      error: payload.error?.message ?? "Wallet transaction preflight failed",
    },
    { status: response.status },
  );
}

export function GET(
  request: Request,
  context: { params: Promise<{ id: string; operationId: string }> },
) {
  return proxy(request, context.params);
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; operationId: string }> },
) {
  return proxy(request, context.params);
}
