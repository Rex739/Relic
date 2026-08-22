import { cookies } from "next/headers";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined)
    return Response.json({ error: "Connect a wallet" }, { status: 401 });
  const { id } = await params;
  const response = await fetch(
    `${apiUrl()}/v1/commerce-agreements/${encodeURIComponent(id)}/authorization-challenge`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: await request.text(),
    },
  );
  const payload = (await response.json()) as {
    data?: unknown;
    error?: { message?: string };
  };
  return Response.json(
    payload.data ?? {
      error: payload.error?.message ?? "Authorization challenge failed",
    },
    { status: response.status },
  );
}
