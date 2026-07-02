from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from relicTools import extractReviewRequest, formatAsiResponse, isSupportedReviewRequest
from schemas import ReviewJob, ReviewRequestState, VerificationResult
from settings import loadSettings


settings = loadSettings(requireSeeds=True)
pendingReviews: dict[str, ReviewRequestState] = {}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _make_agent() -> Agent:
    kwargs: dict[str, object] = {
        "name": "relic-review-agent",
        "seed": settings.reviewAgentSeed,
        "port": settings.reviewAgentPort,
        "mailbox": True,
        "publish_agent_details": True,
    }
    try:
        return Agent(**kwargs, readme_path="README.md")
    except TypeError:
        return Agent(**kwargs)


reviewAgent = _make_agent()
chatProtocol = Protocol(spec=chat_protocol_spec)


def _extract_text(msg: ChatMessage) -> str:
    parts: list[str] = []
    for item in msg.content:
        if isinstance(item, TextContent):
            parts.append(item.text)
        elif isinstance(item, StartSessionContent):
            continue
    return " ".join(part.strip() for part in parts if part.strip()).strip()


async def _send_final(ctx: Context, recipient: str, text: str) -> None:
    await ctx.send(
        recipient,
        ChatMessage(
            timestamp=_utc_now(),
            msg_id=uuid4(),
            content=[
                TextContent(type="text", text=text),
                EndSessionContent(type="end-session"),
            ],
        ),
    )


@chatProtocol.on_message(model=ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=_utc_now(),
            acknowledged_msg_id=msg.msg_id,
        ),
    )

    text = _extract_text(msg)
    if not text:
        await _send_final(
            ctx,
            sender,
            "Relic reviews high-risk legacy-system changes. Ask me to assess a billing or policy change, such as a surcharge update for Meridian Grid.",
        )
        return

    if not isSupportedReviewRequest(text):
        await _send_final(
            ctx,
            sender,
            "Relic reviews high-risk legacy-system changes. Ask me to assess a billing or policy change, such as a surcharge update for Meridian Grid.",
        )
        return

    if not settings.verificationAgentAddress:
        await _send_final(
            ctx,
            sender,
            "Relic's verification specialist is not configured yet. No release recommendation has been issued.",
        )
        return

    jobId = str(uuid4())
    requestedChange = extractReviewRequest(text)
    pendingReviews[jobId] = ReviewRequestState(
        originalSender=sender,
        createdAt=_utc_now(),
        requestedChange=requestedChange,
    )
    job = ReviewJob(
        jobId=jobId,
        requestedChange=requestedChange,
        systemName="Meridian Grid · Billing Core",
        riskSensitivity="Strict",
        requestedBy=sender,
        createdAt=_utc_now().isoformat(),
        replyToAgent=str(reviewAgent.address),
    )
    await ctx.send(settings.verificationAgentAddress, job)
    ctx.logger.info("delegated ReviewJob %s to verification agent", jobId)


@chatProtocol.on_message(model=ChatAcknowledgement)
async def handle_chat_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    ctx.logger.info("chat acknowledgement from %s for %s", sender, msg.acknowledged_msg_id)


@reviewAgent.on_message(model=VerificationResult)
async def handle_verification_result(ctx: Context, sender: str, msg: VerificationResult) -> None:
    state = pendingReviews.pop(msg.jobId, None)
    if state is None:
        ctx.logger.warning("received VerificationResult for unknown job %s from %s", msg.jobId, sender)
        return

    response = formatAsiResponse(msg, settings.relicAppUrl)
    await _send_final(ctx, state.originalSender, response)
    ctx.logger.info("completed ReviewJob %s", msg.jobId)


@reviewAgent.on_interval(period=10.0)
async def recover_timeouts(ctx: Context) -> None:
    now = _utc_now()
    timedOutJobs = [
        jobId
        for jobId, state in pendingReviews.items()
        if (now - state.createdAt).total_seconds() > settings.reviewTimeoutSeconds
    ]
    for jobId in timedOutJobs:
        state = pendingReviews.pop(jobId)
        await _send_final(
            ctx,
            state.originalSender,
            "Relic could not complete this review before the verification deadline.\n"
            "No release recommendation has been issued.\n"
            "Please retry after the verification service is online.",
        )
        ctx.logger.warning("ReviewJob %s timed out", jobId)


@reviewAgent.on_event("startup")
async def startup(ctx: Context) -> None:
    ctx.logger.info("relic-review-agent started")
    ctx.logger.info("agent address: %s", reviewAgent.address)
    ctx.logger.info("mailbox mode: enabled")
    ctx.logger.info("verification agent configured: %s", bool(settings.verificationAgentAddress))
    ctx.logger.info("Start Verification Agent first, copy its address into agents/.env, then start Review Agent.")


reviewAgent.include(chatProtocol, publish_manifest=True)


if __name__ == "__main__":
    reviewAgent.run()
