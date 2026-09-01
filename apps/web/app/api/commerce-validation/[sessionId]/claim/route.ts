import { cookies } from "next/headers";

import { readJsonResponse } from "../../../../../lib/http-json";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined)
    return Response.json(
      { error: "Connect and authenticate the buyer wallet first." },
      { status: 401 },
    );
  const { sessionId } = await context.params;
  const response = await fetch(
    `${apiUrl()}/v1/commerce-validation-sessions/${encodeURIComponent(sessionId)}/claim`,
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
  const payload = await readJsonResponse<Record<string, unknown>>(response);
  return Response.json(
    payload ?? { error: { message: "Validation claim returned no response." } },
    { status: response.status },
  );
}
