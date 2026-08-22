const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(request: Request) {
  const response = await fetch(`${apiUrl()}/v1/auth/wallet/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: await request.text(),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    data?: { id: string; message: string; address: string; chainId: number };
    error?: { message?: string };
  };
  return Response.json(
    payload.data ?? {
      error: payload.error?.message ?? "Wallet challenge failed",
    },
    { status: response.status },
  );
}
