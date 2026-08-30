"""Deterministic, read-only Venus yield observations for BSC Testnet.

The seller never asks an LLM to invent market data.  It reads the Venus Core
Pool at one pinned block, derives supply APY from the on-chain per-block rate
and the recently observed block interval, and returns canonical JSON evidence.
"""
from __future__ import annotations

import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware


CHAIN_ID = 97
PROTOCOL = "venus-core"
DEFAULT_COMPTROLLER = Web3.to_checksum_address(
    "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D"
)
RATE_SCALE = 10**18
SECONDS_PER_YEAR = 365 * 24 * 60 * 60
BLOCK_SAMPLE_SIZE = 120

COMPTROLLER_ABI = [
    {
        "type": "function",
        "name": "getAllMarkets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]"}],
    }
]

VTOKEN_ABI = [
    {
        "type": "function",
        "name": "symbol",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "string"}],
    },
    {
        "type": "function",
        "name": "supplyRatePerBlock",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "getCash",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalBorrows",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalReserves",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]


def _build_web3(rpc_url: str) -> Web3:
    """Create a BSC-compatible client without changing read-only semantics."""
    web3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 20}))
    web3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return web3


def _fixed(value: float, places: int = 6) -> str:
    return f"{value:.{places}f}"


def supply_apy_percent(rate_raw: int, seconds_per_block: float) -> float:
    """Convert a 1e18-scaled per-block supply rate to estimated annual APY."""
    if rate_raw < 0:
        raise ValueError("supply rate cannot be negative")
    if not math.isfinite(seconds_per_block) or seconds_per_block <= 0:
        raise ValueError("seconds_per_block must be positive")
    rate = rate_raw / RATE_SCALE
    exponent = math.log1p(rate) * (SECONDS_PER_YEAR / seconds_per_block)
    if exponent > 50:
        raise ValueError("derived APY is outside the supported range")
    return math.expm1(exponent) * 100


def utilization_percent(cash_raw: int, borrows_raw: int, reserves_raw: int) -> float | None:
    """Return protocol utilization without assuming token decimals or prices."""
    denominator = cash_raw + borrows_raw - reserves_raw
    if denominator <= 0:
        return None
    return borrows_raw / denominator * 100


def build_market_result(
    *,
    address: str,
    symbol: str,
    supply_rate_raw: int,
    cash_raw: int,
    borrows_raw: int,
    reserves_raw: int,
    seconds_per_block: float,
) -> dict[str, Any]:
    """Build one market row from raw values observed at the same block."""
    utilization = utilization_percent(cash_raw, borrows_raw, reserves_raw)
    return {
        "address": Web3.to_checksum_address(address),
        "symbol": symbol,
        "supplyRatePerBlockRaw": str(supply_rate_raw),
        "estimatedSupplyApyPercent": _fixed(
            supply_apy_percent(supply_rate_raw, seconds_per_block)
        ),
        "cashRaw": str(cash_raw),
        "totalBorrowsRaw": str(borrows_raw),
        "totalReservesRaw": str(reserves_raw),
        "utilizationPercent": None if utilization is None else _fixed(utilization),
    }


def _market_at_block(
    web3: Web3, address: str, block_number: int, seconds_per_block: float
) -> dict[str, Any]:
    market = web3.eth.contract(
        address=Web3.to_checksum_address(address), abi=VTOKEN_ABI
    )
    return build_market_result(
        address=address,
        symbol=str(market.functions.symbol().call(block_identifier=block_number)),
        supply_rate_raw=int(
            market.functions.supplyRatePerBlock().call(block_identifier=block_number)
        ),
        cash_raw=int(market.functions.getCash().call(block_identifier=block_number)),
        borrows_raw=int(
            market.functions.totalBorrows().call(block_identifier=block_number)
        ),
        reserves_raw=int(
            market.functions.totalReserves().call(block_identifier=block_number)
        ),
        seconds_per_block=seconds_per_block,
    )


def scan_venus_yields(top_n: int = 8) -> dict[str, Any]:
    """Read and rank Venus Core Pool markets using one BSC Testnet block."""
    rpc_url = (
        os.environ.get("RPC_URL_BSC_TESTNET", "").strip()
        or os.environ.get("BSC_TESTNET_RPC_URL", "").strip()
    )
    if not rpc_url:
        raise RuntimeError("RPC_URL_BSC_TESTNET or BSC_TESTNET_RPC_URL is required")
    top_n = max(1, min(int(top_n), 20))

    web3 = _build_web3(rpc_url)
    if not web3.is_connected():
        raise RuntimeError("BSC Testnet RPC is unavailable")
    if web3.eth.chain_id != CHAIN_ID:
        raise RuntimeError(
            f"RPC chain mismatch: expected {CHAIN_ID}, observed {web3.eth.chain_id}"
        )

    block_number = int(web3.eth.block_number)
    block = web3.eth.get_block(block_number)
    sample_number = max(0, block_number - BLOCK_SAMPLE_SIZE)
    sample = web3.eth.get_block(sample_number)
    elapsed = int(block["timestamp"]) - int(sample["timestamp"])
    block_delta = block_number - sample_number
    if elapsed <= 0 or block_delta <= 0:
        raise RuntimeError("could not derive the recent BSC block interval")
    seconds_per_block = elapsed / block_delta

    configured = os.environ.get("VENUS_BSC_TESTNET_COMPTROLLER", "").strip()
    comptroller_address = Web3.to_checksum_address(
        configured or DEFAULT_COMPTROLLER
    )
    comptroller = web3.eth.contract(
        address=comptroller_address, abi=COMPTROLLER_ABI
    )
    market_addresses = comptroller.functions.getAllMarkets().call(
        block_identifier=block_number
    )

    markets: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    # Public RPCs can be slow when every market is read serially. Keep a small,
    # bounded pool so the observation remains practical inside the signed quote
    # window without turning this into an unbounded RPC burst.
    worker_count = min(6, max(1, len(market_addresses)))
    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        pending = {
            pool.submit(
                _market_at_block,
                web3,
                address,
                block_number,
                seconds_per_block,
            ): address
            for address in market_addresses
        }
        for future in as_completed(pending):
            address = pending[future]
            try:
                markets.append(future.result())
            except Exception as error:  # one malformed market must remain visible
                failures.append(
                    {
                        "address": Web3.to_checksum_address(address),
                        "error": f"{type(error).__name__}: {error}",
                    }
                )

    markets.sort(
        key=lambda item: float(item["estimatedSupplyApyPercent"]), reverse=True
    )
    failures.sort(key=lambda item: item["address"].lower())
    return {
        "source": "onchain",
        "readOnly": True,
        "protocol": PROTOCOL,
        "chainId": CHAIN_ID,
        "blockNumber": str(block_number),
        "blockTimestamp": datetime.fromtimestamp(
            int(block["timestamp"]), timezone.utc
        ).isoformat(),
        "comptroller": comptroller_address,
        "recentAverageBlockSeconds": _fixed(seconds_per_block, 4),
        "rankingMethod": "estimated supply APY, descending",
        "markets": markets[:top_n],
        "marketReadFailures": failures,
        "limitations": [
            "APY is estimated from each market's on-chain per-block supply rate and the recent observed block interval.",
            "Raw liquidity values are not converted to fiat prices and are not directly comparable across token decimals.",
            "This observation is informational and does not move funds or submit DeFi transactions.",
        ],
    }


def render_yield_report(observation: dict[str, Any]) -> str:
    """Return deterministic canonical JSON for the immutable deliverable."""
    return json.dumps(observation, sort_keys=True, separators=(",", ":"))
