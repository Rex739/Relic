import { cookies } from "next/headers";

import { readJsonResponse } from "../../../../../lib/http-json";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(request: Request) {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/v1/auth/wallet/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Wallet authentication service is unavailable" },
      { status: 503 },
    );
  }
  const payload = await readJsonResponse<{
    data?: {
      sessionToken: string;
      expiresAt: string;
      principal: {
        walletAddress: string;
        chainId: number;
        principalId: string;
      };
    };
    error?: { message?: string };
  }>(response);
  if (payload === null)
    return Response.json(
      { error: "Wallet authentication service returned an empty response" },
      { status: 502 },
    );
  if (!response.ok || payload.data === undefined)
    return Response.json(
      { error: payload.error?.message ?? "Wallet verification failed" },
      { status: response.status },
    );
  (await cookies()).set("relic_session", payload.data.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(payload.data.expiresAt),
  });
  return Response.json(payload.data.principal);
}
