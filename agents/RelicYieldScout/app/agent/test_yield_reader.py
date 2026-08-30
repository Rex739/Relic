from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from yield_reader import (
    _build_web3,
    build_market_result,
    render_yield_report,
    supply_apy_percent,
    utilization_percent,
)


class YieldReaderTests(unittest.TestCase):
    @patch("yield_reader.Web3")
    def test_bsc_client_installs_poa_middleware(self, web3_type: MagicMock) -> None:
        client = MagicMock()
        web3_type.return_value = client

        self.assertIs(_build_web3("https://example.invalid"), client)
        web3_type.HTTPProvider.assert_called_once_with(
            "https://example.invalid", request_kwargs={"timeout": 20}
        )
        client.middleware_onion.inject.assert_called_once()

    def test_builds_an_onchain_market_result_without_inventing_prices(self) -> None:
        result = build_market_result(
            address="0x1111111111111111111111111111111111111111",
            symbol="vTEST",
            supply_rate_raw=1_000_000_000,
            cash_raw=700,
            borrows_raw=300,
            reserves_raw=0,
            seconds_per_block=0.75,
        )
        self.assertEqual(result["utilizationPercent"], "30.000000")
        self.assertGreater(float(result["estimatedSupplyApyPercent"]), 0)
        self.assertNotIn("usd", json.dumps(result).lower())

    def test_zero_denominator_has_no_utilization(self) -> None:
        self.assertIsNone(utilization_percent(0, 0, 0))

    def test_rejects_invalid_block_interval(self) -> None:
        with self.assertRaisesRegex(ValueError, "seconds_per_block"):
            supply_apy_percent(1, 0)

    def test_report_is_canonical_json(self) -> None:
        report = render_yield_report({"z": 1, "a": {"b": 2}})
        self.assertEqual(report, '{"a":{"b":2},"z":1}')


if __name__ == "__main__":
    unittest.main()
