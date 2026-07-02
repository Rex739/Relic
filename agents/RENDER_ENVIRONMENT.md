# Relic Render Environment

Relic deploys the Fetch/uAgents layer as two Render Background Workers. The Review Agent is public and chat-enabled through Agentverse mailbox communication. The Verification Agent is internal and receives typed agent-to-agent work from the Review Agent.

Do not commit real seed values, API keys, mailbox credentials, or private tokens. Enter secret values manually in the Render dashboard.

## Environment Matrix

### `relic-review-agent`

| Key | Secret or public | Value source | Manually entered in Render |
| --- | --- | --- | --- |
| `PYTHON_VERSION` | Public | `3.10.9`, matching the tested local Python version | No, set in `render.yaml` |
| `RELIC_APP_URL` | Public | `https://relic-brown.vercel.app` | No, set in `render.yaml` |
| `RELIC_REVIEW_AGENT_SEED` | Secret | `<existing review agent seed>` | Yes |
| `RELIC_REVIEW_AGENT_PORT` | Public | `8001` | No, set in `render.yaml` |
| `RELIC_VERIFICATION_AGENT_ADDRESS` | Public | Existing Verification Agent address: `agent1q2nkm6zdul4lnchpmxk0jummy9uefwf2esvanenjsu629pmjau6m5usxcaf` | No, set in `render.yaml` |
| `RELIC_REVIEW_TIMEOUT_SECONDS` | Public | `30` | No, set in `render.yaml` |

The Review Agent does not receive `RELIC_VERIFICATION_AGENT_SEED`, `RELIC_DEMO_CLIENT_SEED`, or `RELIC_DEMO_CLIENT_PORT`.

### `relic-verification-agent`

| Key | Secret or public | Value source | Manually entered in Render |
| --- | --- | --- | --- |
| `PYTHON_VERSION` | Public | `3.10.9`, matching the tested local Python version | No, set in `render.yaml` |
| `RELIC_API_BASE_URL` | Public | `https://relic-brown.vercel.app` | No, set in `render.yaml` |
| `RELIC_VERIFICATION_AGENT_SEED` | Secret | `<existing verification agent seed>` | Yes |
| `RELIC_VERIFICATION_AGENT_PORT` | Public | `8002` | No, set in `render.yaml` |
| `RELIC_REVIEW_TIMEOUT_SECONDS` | Public | `30` | No, set in `render.yaml` |

The Verification Agent does not receive `RELIC_REVIEW_AGENT_SEED`, `RELIC_DEMO_CLIENT_SEED`, or `RELIC_DEMO_CLIENT_PORT`. It also does not need `RELIC_REVIEW_AGENT_ADDRESS` at deploy time because each `ReviewJob` carries its `replyToAgent` address.

## Local And Cloud Safety

- Deploy the Verification Agent before the Review Agent so the Review Agent can delegate to the configured Verification Agent address.
- Preserve the existing seeds to preserve the existing Agentverse identities and addresses.
- Do not run duplicate cloud and local instances using the same agent seed at the same time.
- After both Render workers are confirmed healthy, stop local copies of the same agents.
- Verify mailbox connection in Render logs before testing through ASI:One.
