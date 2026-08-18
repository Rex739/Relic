#!/usr/bin/env python3
"""Register Relic's reference seller with paymaster sponsorship only.

This intentionally disables the SDK's self-pay fallback. If MegaFuel declines
either write, execution stops before any wallet-funded broadcast is attempted.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bnbagent import (
    AgentEndpoint,
    ERC8004Agent,
    EVMWalletProvider,
    TransactionPendingError,
)
from bnbagent.wallets.local_executor import LocalExecutor


NAME = "Relic Health Factor Monitor"
DESCRIPTION = (
    "Relic-operated reference agent for read-only Venus health-factor "
    "monitoring on BSC Testnet."
)
DEFAULT_ENDPOINT = "http://127.0.0.1:8003/erc8183"
NETWORK = "bsc-testnet"


class SponsorshipRequiredExecutor(LocalExecutor):
    """Fail closed instead of falling back to wallet-funded gas."""

    def _send_self_pay(self, function, gas_limit, wallet_address, description):
        raise RuntimeError(
            f"STOP: paymaster sponsorship unavailable for {description}; "
            "self-pay fallback is disabled"
        )


def _jsonable(value: Any) -> Any:
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "items"):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return value


def _tx_evidence(result: dict[str, Any]) -> dict[str, Any]:
    receipt = result.get("receipt")
    return {
        "transaction_hash": result.get("transactionHash"),
        "block_number": receipt.get("blockNumber") if receipt else None,
        "block_hash": _jsonable(receipt.get("blockHash")) if receipt else None,
        "status": receipt.get("status") if receipt else None,
        "gas_used": receipt.get("gasUsed") if receipt else None,
    }


def _persist(path: Path, evidence: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(_jsonable(evidence), indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    password = os.environ.get("WALLET_PASSWORD")
    if not password:
        raise RuntimeError("WALLET_PASSWORD is required")

    root = Path(__file__).resolve().parents[1]
    evidence_path = root / ".agent-data" / "phase05-erc8004-registration.json"
    requested_endpoint = os.environ.get("ERC8183_AGENT_URL", DEFAULT_ENDPOINT)
    wallet = EVMWalletProvider(
        password=password,
        wallets_dir=str(root / ".studio" / "wallets"),
    )
    sdk = ERC8004Agent(wallet_provider=wallet, network=NETWORK)
    sdk.contract._executor = SponsorshipRequiredExecutor(
        web3=sdk.web3,
        wallet_provider=wallet,
        paymaster=sdk.contract.paymaster,
        receipt_timeout=sdk.contract.receipt_timeout,
    )

    endpoint = AgentEndpoint(name="ERC8183", endpoint=requested_endpoint)
    initial_uri = sdk.generate_agent_uri(
        name=NAME,
        description=DESCRIPTION,
        endpoints=[endpoint],
    )
    if evidence_path.exists():
        evidence = json.loads(evidence_path.read_text())
        if evidence.get("completed") and evidence.get("endpoint") == requested_endpoint:
            print(json.dumps(evidence, indent=2))
            return
        agent_id = evidence.get("agent_id")
        if agent_id is None or sdk.contract.contract.functions.ownerOf(agent_id).call() != wallet.address:
            raise RuntimeError("Checkpointed ERC-8004 identity is not owned by this wallet")
        if evidence.get("completed"):
            evidence.setdefault("endpoint_history", []).append(
                {
                    "endpoint": evidence.get("endpoint"),
                    "uri_update": evidence.get("uri_update"),
                    "replaced_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            evidence["completed"] = False
    else:
        evidence = {
            "kind": "real_onchain",
            "network": NETWORK,
            "chain_id": sdk.web3.eth.chain_id,
            "registry": sdk.contract.contract_address,
            "owner": wallet.address,
            "name": NAME,
            "endpoint": requested_endpoint,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "initial_agent_uri": initial_uri,
            "registration": None,
            "uri_update": None,
            "uri_update_attempts": [],
            "completed": False,
        }

        registration = sdk.contract.register_agent(agent_uri=initial_uri)
        agent_id = registration.get("agentId")
        evidence["agent_id"] = agent_id
        evidence["registration"] = _tx_evidence(registration)
        _persist(evidence_path, evidence)
        if agent_id is None:
            raise RuntimeError("Registration confirmed but no ERC-8004 agent ID was emitted")

    final_uri = sdk.generate_agent_uri(
        name=NAME,
        description=DESCRIPTION,
        endpoints=[endpoint],
        agent_id=agent_id,
    )
    evidence["final_agent_uri"] = final_uri
    evidence["endpoint"] = requested_endpoint
    _persist(evidence_path, evidence)

    try:
        uri_update = sdk.contract.set_agent_uri(agent_id, final_uri)
    except TransactionPendingError as error:
        evidence.setdefault("uri_update_attempts", []).append(
            {
                "transaction_hash": error.tx_hash,
                "state": "broadcast_unconfirmed",
                "observed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        _persist(evidence_path, evidence)
        raise
    evidence["uri_update"] = _tx_evidence(uri_update)
    evidence.setdefault("uri_update_attempts", []).append(
        {**evidence["uri_update"], "state": "confirmed"}
    )
    evidence["completed"] = True
    evidence["completed_at"] = datetime.now(timezone.utc).isoformat()
    _persist(evidence_path, evidence)

    print(json.dumps(_jsonable(evidence), indent=2))


if __name__ == "__main__":
    main()
