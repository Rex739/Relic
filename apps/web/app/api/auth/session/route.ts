import { cookies } from "next/headers";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function GET() {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined)
    return Response.json({ error: "No session" }, { status: 401 });
  const response = await fetch(`${apiUrl()}/v1/auth/session`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const payload = (await response.json()) as {
    data?: { walletAddress: string; chainId: number; principalId: string };
  };
  if (!response.ok || payload.data === undefined) {
    (await cookies()).delete("relic_session");
    return Response.json({ error: "Session expired" }, { status: 401 });
  }
  return Response.json(payload.data);
}
