const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    const response = await fetch(`${apiUrl()}/v1/auth/wallet/challenge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: await request.text(),
      cache: "no-store",
    });
    const payload = await readJsonResponse<{
      data?: { id: string; message: string; address: string; chainId: number };
      error?: { message?: string };
    }>(response);
    if (payload === null)
      return Response.json(
        { error: "Wallet authentication service returned an empty response" },
        { status: 502 },
      );
    return Response.json(
      payload.data ?? {
        error: payload.error?.message ?? "Wallet challenge failed",
      },
      { status: response.status },
    );
  } catch {
    return Response.json(
      { error: "Wallet authentication service is unavailable" },
      { status: 503 },
    );
  }
}
import { readJsonResponse } from "../../../../../lib/http-json";
