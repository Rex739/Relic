from __future__ import annotations

from uagents import Agent, Context

from relicTools import runRelicReview
from schemas import ReviewJob, VerificationResult
from settings import loadVerificationAgentSettings


settings = loadVerificationAgentSettings()


def _make_agent() -> Agent:
    kwargs: dict[str, object] = {
        "name": "relic-verification-agent",
        "seed": settings.verificationAgentSeed,
        "port": settings.verificationAgentPort,
        "mailbox": True,
        "publish_agent_details": True,
    }
    try:
        return Agent(**kwargs, readme_path="README.md")
    except TypeError:
        return Agent(**kwargs)


verificationAgent = _make_agent()


@verificationAgent.on_event("startup")
async def startup(ctx: Context) -> None:
    ctx.logger.info("relic-verification-agent started")
    ctx.logger.info("agent address: %s", verificationAgent.address)
    ctx.logger.info("mode: verification-only; no deployments or financial transactions")
    ctx.logger.info("Relic API base URL: %s", settings.relicApiBaseUrl)
    ctx.logger.info("mailbox mode: enabled")


@verificationAgent.on_message(model=ReviewJob)
async def handle_review_job(ctx: Context, sender: str, msg: ReviewJob) -> None:
    ctx.logger.info("received ReviewJob %s from %s", msg.jobId, sender)
    result = runRelicReview(settings.relicApiBaseUrl, settings.reviewTimeoutSeconds)
    resultPayload: dict[str, object]
    if hasattr(result, "model_dump"):
        resultPayload = result.model_dump()
    else:
        resultPayload = result.dict()
    resultPayload["jobId"] = msg.jobId
    resultWithJobId = VerificationResult(**resultPayload)

    try:
        await ctx.send(msg.replyToAgent, resultWithJobId)
        ctx.logger.info("sent VerificationResult for job %s", msg.jobId)
    except Exception as exc:
        ctx.logger.error("could not send VerificationResult for job %s: %s", msg.jobId, exc.__class__.__name__)


if __name__ == "__main__":
    verificationAgent.run()
