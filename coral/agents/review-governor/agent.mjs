import { CANONICAL_MERIDIAN_REQUEST, validateMeridianRequest } from "../../lib/governance.mjs";
import { createMcpClient, requireCoralRuntime, selectTool } from "../../lib/coralMcpClient.mjs";

const request = validateMeridianRequest(process.env.RELIC_REVIEW_REQUEST ?? CANONICAL_MERIDIAN_REQUEST);
const runtime = requireCoralRuntime();
const client = await createMcpClient(runtime.connectionUrl);
const tools = await client.listTools();

const createThread = selectTool(tools, ["create", "thread"]);
const sendMessage = selectTool(tools, ["send", "message"]);
const waitForMentions = selectTool(tools, ["wait", "mention"]);

const thread = await client.callTool(createThread, {
  threadName: "meridian-grid-governance-review",
  participantNames: ["relic-verification-bridge", "relic-release-policy-guard"],
});

const threadId = thread?.thread?.id ?? thread?.threadId ?? thread?.id;
if (!threadId) {
  throw new Error("Coral did not return a thread id.");
}

await client.callTool(sendMessage, {
  threadId,
  content: JSON.stringify({
    type: "VERIFY_RELIC_EVIDENCE",
    request,
    workspaceUrl: process.env.RELIC_WORKSPACE_URL,
  }),
  mentions: ["relic-verification-bridge"],
});

const verification = await client.callTool(waitForMentions, {
  maxWaitMs: 60000,
});
const verifiedMessage = parseMessageContent(verification?.message);

await client.callTool(sendMessage, {
  threadId,
  content: JSON.stringify({
    type: "EVALUATE_RELEASE_POLICY",
    verifiedEvidence: verifiedMessage.evidence,
  }),
  mentions: ["relic-release-policy-guard"],
});

const policy = await client.callTool(waitForMentions, {
  maxWaitMs: 60000,
});
const policyMessage = parseMessageContent(policy?.message);

console.log(
  JSON.stringify(
    {
      sessionId: runtime.sessionId,
      threadId,
      governanceResult: policyMessage.policy,
      statement: "CoralOS is used as a local governance and observability layer for Relic’s review workflow. It scopes agent responsibilities, records handoffs, and prevents agents from issuing human release approval.",
    },
    null,
    2,
  ),
);

function parseMessageContent(message) {
  if (!message) {
    throw new Error("No Coral message received before the wait timeout.");
  }

  const text = message?.text ?? message?.content;
  if (!text) {
    throw new Error("Expected a Coral thread message with JSON text.");
  }

  return JSON.parse(text);
}
