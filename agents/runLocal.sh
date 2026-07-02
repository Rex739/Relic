#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but was not found."
  exit 1
fi

python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 'Python 3.10 or newer is required for the Fetch chat protocol dependencies.')"

if [ ! -d agents/.venv ]; then
  python3 -m venv agents/.venv
fi

source agents/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r agents/requirements.txt

cat <<'INSTRUCTIONS'

Local environment setup:

cp agents/.env.example agents/.env

Generate local seeds with Python standard library:
python3 -c "import secrets; print(secrets.token_hex(32))"

Set each generated value in agents/.env:
RELIC_REVIEW_AGENT_SEED=
RELIC_VERIFICATION_AGENT_SEED=
RELIC_DEMO_CLIENT_SEED=

Next.js must be running separately at localhost:3000.

Terminal 1:
npm run dev

Terminal 2:
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/verificationAgent.py

Copy the Verification Agent address into:
RELIC_VERIFICATION_AGENT_ADDRESS=
inside agents/.env

Terminal 3:
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/reviewAgent.py

Copy the Review Agent address into:
RELIC_REVIEW_AGENT_ADDRESS=
inside agents/.env

Terminal 4:
source agents/.venv/bin/activate
set -a
source agents/.env
set +a
python agents/demoClient.py

INSTRUCTIONS
