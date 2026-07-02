from __future__ import annotations

import sys
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from settings import loadSettings


settings = loadSettings(requireSeeds=True)
reviewAgentAddress = sys.argv[1].strip() if len(sys.argv) > 1 else settings.reviewAgentAddress
if not reviewAgentAddress:
    raise RuntimeError("RELIC_REVIEW_AGENT_ADDRESS is required, or pass the Review Agent address as the first argument.")

demoClient = Agent(
    name="relic-demo-client",
    seed=settings.demoClientSeed,
    port=settings.demoClientPort,
    mailbox=True,
    publish_agent_details=False,
)
chatProtocol = Protocol(spec=chat_protocol_spec)
sentRequest = False
receivedFinal = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@demoClient.on_event("startup")
async def startup(ctx: Context) -> None:
    ctx.logger.info("relic-demo-client started")
    ctx.logger.info("sending standard Meridian Grid review request")


@demoClient.on_interval(period=1.0)
async def send_request(ctx: Context) -> None:
    global sentRequest
    if sentRequest:
        return
    sentRequest = True
    await ctx.send(
        reviewAgentAddress,
        ChatMessage(
            timestamp=_utc_now(),
            msg_id=uuid4(),
            content=[
                TextContent(
                    type="text",
                    text=(
                        "Review Meridian Grid’s proposed 7% regulatory surcharge for commercial customers above "
                        "10,000 kWh. Check for billing and ledger regression risk."
                    ),
                )
            ],
        ),
    )


@chatProtocol.on_message(model=ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    ctx.logger.info("received ChatAcknowledgement from %s for %s", sender, msg.acknowledged_msg_id)


@chatProtocol.on_message(model=ChatMessage)
async def handle_final(ctx: Context, sender: str, msg: ChatMessage) -> None:
    global receivedFinal
    textParts: list[str] = []
    ended = False
    for item in msg.content:
        if isinstance(item, TextContent):
            textParts.append(item.text)
        elif isinstance(item, EndSessionContent):
            ended = True
    if textParts:
        print("\n".join(textParts))
    if ended:
        receivedFinal = True
        ctx.logger.info("review chat session ended by %s", sender)


demoClient.include(chatProtocol, publish_manifest=False)


if __name__ == "__main__":
    demoClient.run()
