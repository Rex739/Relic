# Relic Fetch.ai Agent Layer

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)

![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Relic helps enterprise teams decide whether a proposed legacy-system change is safe before it reaches production. The current simulation focuses on Meridian Grid's billing core, where a surcharge policy change can trigger duplicate ledger entries for historical commercial accounts.

Legacy enterprise change review is slow because critical knowledge is scattered across undocumented code, historical business rules, dependency paths, regression plans, and a small number of specialists. Relic compresses that review into an evidence-backed decision while keeping release authority with named humans.

## Architecture

ASI:One / agent chat user
→ Relic Review Agent
→ Relic Verification Agent
→ Relic API
→ evidence-backed decision

Review Agent responsibilities:
- Receives Fetch Agent Chat Protocol messages.
- Acknowledges user messages immediately.
- Detects whether the request is the supported Meridian Grid billing-policy review.
- Delegates a typed `ReviewJob` to the Verification Agent.
- Returns the final readable decision and ends the chat session.

Verification Agent responsibilities:
- Receives typed `ReviewJob` messages from the Review Agent.
- Calls `POST {RELIC_API_BASE_URL}/api/review/run`.
- Validates the Relic API response.
- Returns a typed `VerificationResult`.
- Never deploys code, performs financial transactions, or bypasses human sign-off.

Human sign-off remains mandatory. Relic can produce dependency intelligence, recovered legacy knowledge, regression evidence, and a recommendation, but it does not deploy changes.

## Local Setup

```bash
cd /Users/progressojemeh/Projects/hackathons/Relic
python3 --version # Python 3.10 or newer is required
python3 -m venv agents/.venv
source agents/.venv/bin/activate
python -m pip install -r agents/requirements.txt
cp agents/.env.example agents/.env
```

Generate three local-only seeds:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Set the generated values in `agents/.env`.

## Environment Variables

- `RELIC_API_BASE_URL`: local Relic API base URL.
- `RELIC_APP_URL`: local Relic workspace URL.
- `RELIC_REVIEW_AGENT_SEED`: local seed for the Review Agent.
- `RELIC_VERIFICATION_AGENT_SEED`: local seed for the Verification Agent.
- `RELIC_DEMO_CLIENT_SEED`: local seed for the demo client.
- `RELIC_REVIEW_AGENT_PORT`: local Review Agent port.
- `RELIC_VERIFICATION_AGENT_PORT`: local Verification Agent port.
- `RELIC_DEMO_CLIENT_PORT`: local demo client port.
- `RELIC_VERIFICATION_AGENT_ADDRESS`: copied from the Verification Agent local launch.
- `RELIC_REVIEW_AGENT_ADDRESS`: copied from the Review Agent local launch.
- `RELIC_REVIEW_TIMEOUT_SECONDS`: pending review timeout.

## Local Demo

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/verificationAgent.py
```

Copy the Verification Agent address into `RELIC_VERIFICATION_AGENT_ADDRESS` inside `agents/.env`.

Terminal 3:

```bash
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/reviewAgent.py
```

Copy the Review Agent address into `RELIC_REVIEW_AGENT_ADDRESS` inside `agents/.env`.

Terminal 4:

```bash
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/demoClient.py
```

## Agentverse And ASI:One

Mailbox connection will be completed later through Agentverse after local launch confirms the Review Agent address and Agent Inspector URL.

ASI:One testing will be completed later after the mailbox-connected Review Agent is discoverable.

Current simulation limitation: Relic currently supports the Meridian Grid billing-policy scenario only.

- Review Agent address: pending local launch
- Verification Agent address: pending local launch
- Agentverse profile URL: pending mailbox connection
- ASI:One shared chat URL: pending discovery setup

## Production Deployment On Render

Production keeps the Relic web app and review API on Vercel while the Fetch/uAgents layer runs as two Render Background Workers.

```text
ASI:One / Agentverse
  -> relic-review-agent
  -> relic-verification-agent
  -> Relic public review API
  -> https://relic-brown.vercel.app
```

Render services:

- `relic-review-agent`: public, chat-enabled Review Agent.
- `relic-verification-agent`: internal Verification Agent for typed agent-to-agent review work.

Both services use Agentverse mailbox communication. Render must create Background Worker services, not public web services. The Relic API remains deployed separately on Vercel at `https://relic-brown.vercel.app`.

All secrets are entered in Render and never committed. Use the exact existing seed values to preserve the current Agentverse identities and addresses. See `agents/RENDER_ENVIRONMENT.md` for the full Render environment matrix.

Deployment order:

1. Deploy `relic-verification-agent`.
2. Confirm its Render logs show mailbox startup and the expected Verification Agent address.
3. Deploy `relic-review-agent`.
4. Confirm its Render logs show mailbox startup and the expected Review Agent address.
5. Test through ASI:One.

Run local validation before deployment:

```bash
python -m unittest discover -s agents/tests -p "test*.py" -v
python -m py_compile agents/reviewAgent.py agents/verificationAgent.py
```
