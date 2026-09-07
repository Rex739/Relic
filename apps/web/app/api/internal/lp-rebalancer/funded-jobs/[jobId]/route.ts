export const dynamic = "force-dynamic";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/u, "");

/**
 * Public ingress for the private LP agent's funded-job handoff.
 *
 * The API is reachable from the web service through ECS Service Connect only;
 * this route preserves the agent's bearer credential and forwards precisely
 * one protected operation. The API still authenticates the token and resolves
 * the buyer mandate itself.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const response = await fetch(
    `${apiUrl()}/internal/lp-rebalancer/funded-jobs/${encodeURIComponent(jobId)}`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization,
      },
    },
  );

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
