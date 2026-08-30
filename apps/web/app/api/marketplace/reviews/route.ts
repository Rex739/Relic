import { cookies } from "next/headers";

import { readJsonResponse } from "../../../../lib/http-json";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(request: Request) {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined)
    return Response.json(
      { error: "Connect a wallet to continue" },
      { status: 401 },
    );
  const response = await fetch(`${apiUrl()}/v1/marketplace/reviews`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: await request.text(),
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response);
  return Response.json(
    payload ?? { error: "Review service returned an empty response" },
    {
      status: response.status,
    },
  );
}
