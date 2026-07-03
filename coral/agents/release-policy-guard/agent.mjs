import { evaluateReleasePolicy } from "../../lib/governance.mjs";
import { createMcpClient, requireCoralRuntime, selectTool } from "../../lib/coralMcpClient.mjs";

const runtime = requireCoralRuntime();
const client = await createMcpClient(runtime.connectionUrl);
const tools = await client.listTools();
const waitForMentions = selectTool(tools, ["wait", "mention"]);
const sendMessage = selectTool(tools, ["send", "message"]);

const request = await client.callTool(waitForMentions, { maxWaitMs: 60000 });
const threadId = request?.message?.threadId ?? request?.threadId;
const message = parseMessageContent(request?.message);
const evidence = message?.verifiedEvidence?.evidence ?? message?.evidence ?? message?.verifiedEvidence;
if (!threadId) {
  throw new Error("Release Policy Guard could not determine the Coral thread id.");
}

const policy = evaluateReleasePolicy(evidence);

await client.callTool(sendMessage, {
  threadId,
  content: JSON.stringify({
    type: "GOVERNANCE_POLICY_RESULT",
    policy,
  }),
  mentions: ["relic-review-governor"],
});

console.log(JSON.stringify({ sessionId: runtime.sessionId, threadId, policy }, null, 2));

function parseMessageContent(message) {
  const text = message?.text ?? message?.content;
  if (!text) {
    throw new Error("Expected a Coral thread message with JSON text.");
  }

  return JSON.parse(text);
}
