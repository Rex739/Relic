import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import requests

AGENTS_DIR = Path(__file__).resolve().parents[1]
if str(AGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(AGENTS_DIR))

from agents.relicTools import (
    extractReviewRequest,
    formatAsiResponse,
    isSupportedReviewRequest,
    runRelicReview,
)
from agents.schemas import VerificationResult


class RelicToolsTest(unittest.TestCase):
    def test_is_supported_review_request(self) -> None:
        self.assertTrue(isSupportedReviewRequest("Review Meridian Grid surcharge risk for commercial billing."))
        self.assertTrue(isSupportedReviewRequest("Check billing and ledger regression risk for a policy update."))
        self.assertFalse(isSupportedReviewRequest("What is a good soup recipe?"))

    def test_extract_review_request(self) -> None:
        extracted = extractReviewRequest("Assess a Meridian Grid surcharge change.")
        self.assertIn("7% regulatory surcharge", extracted)
        self.assertTrue(extracted)

    def test_format_blocked_response(self) -> None:
        result = VerificationResult(
            jobId="job-1",
            success=True,
            decision="BLOCKED",
            riskLevel="critical",
            impactedComponents=8,
            criticalPaths=5,
            failedRegressionTests=1,
            affectedAccounts=842,
            requiredSignOff=["Finance Systems Owner", "Billing Policy Lead"],
            reviewId="REL-TEST-001",
            receiptHash="abc123",
            evidenceSummary=["Surcharge rule order"],
            workspacePath="/review/meridian-billing",
            errorMessage=None,
        )
        formatted = formatAsiResponse(result, "http://127.0.0.1:3000")
        self.assertIn("BLOCKED", formatted)
        self.assertIn("842", formatted)
        self.assertIn("REL-TEST-001", formatted)
        self.assertIn("abc123", formatted)
        self.assertIn("/review/meridian-billing", formatted)

    def test_api_failure_conversion(self) -> None:
        with patch("agents.relicTools.requests.post", side_effect=requests.ConnectionError("socket exploded")):
            result = runRelicReview("http://127.0.0.1:3000", 1)

        self.assertFalse(result.success)
        formatted = formatAsiResponse(result, "http://127.0.0.1:3000")
        self.assertIn("No release recommendation has been issued.", formatted)
        self.assertNotIn("socket exploded", formatted)
        self.assertNotIn("Traceback", formatted)

    def test_api_success_conversion(self) -> None:
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "reviewId": "REL-MOCK-001",
            "decision": "BLOCKED",
            "affectedAccountCount": 842,
            "requiredHumanSignOffs": ["Finance Systems Owner", "Billing Policy Lead"],
            "impactAnalysis": {
                "impactedComponents": [{"id": "a"}, {"id": "b"}],
                "criticalPathCount": 5,
            },
            "regressionResults": [
                {"status": "passed"},
                {"status": "failed"},
            ],
            "evidence": [
                {"title": "Surcharge rule order"},
                {"title": "Legacy discount ledger behavior"},
            ],
            "certificate": {
                "riskLevel": "critical",
                "receiptHash": "mock-receipt-hash",
            },
        }

        with patch("agents.relicTools.requests.post", return_value=response):
            result = runRelicReview("http://127.0.0.1:3000", 3)

        self.assertTrue(result.success)
        self.assertEqual(result.decision, "BLOCKED")
        self.assertEqual(result.impactedComponents, 2)
        self.assertEqual(result.criticalPaths, 5)
        self.assertEqual(result.failedRegressionTests, 1)
        self.assertEqual(result.affectedAccounts, 842)
        self.assertEqual(result.receiptHash, "mock-receipt-hash")
        self.assertEqual(result.evidenceSummary[0], "Surcharge rule order")


if __name__ == "__main__":
    unittest.main()
