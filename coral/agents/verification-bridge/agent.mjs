import { fetchRelicEvidence } from "../../lib/governance.mjs";
import { createMcpClient, requireCoralRuntime, selectTool } from "../../lib/coralMcpClient.mjs";

const runtime = requireCoralRuntime();
const client = await createMcpClient(runtime.connectionUrl);
const tools = await client.listTools();
const waitForMentions = selectTool(tools, ["wait", "mention"]);
const sendMessage = selectTool(tools, ["send", "message"]);

const request = await client.callTool(waitForMentions, { maxWaitMs: 60000 });
const threadId = request?.message?.threadId ?? request?.threadId;
if (!threadId) {
  throw new Error("Verification Bridge could not determine the Coral thread id.");
}

const evidence = await fetchRelicEvidence({
  baseUrl: process.env.RELIC_API_BASE_URL,
  workspaceUrl: process.env.RELIC_WORKSPACE_URL,
});

await client.callTool(sendMessage, {
  threadId,
  content: JSON.stringify({
    type: "VERIFIED_RELIC_EVIDENCE",
    evidence,
  }),
  mentions: ["relic-review-governor"],
});

console.log(JSON.stringify({ sessionId: runtime.sessionId, threadId, evidence }, null, 2));
