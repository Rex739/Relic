import { cookies } from "next/headers";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

export async function POST() {
  const jar = await cookies();
  const token = jar.get("relic_session")?.value;
  if (token !== undefined)
    await fetch(`${apiUrl()}/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
    }).catch(() => undefined);
  jar.delete("relic_session");
  return Response.json({ revoked: true });
}
