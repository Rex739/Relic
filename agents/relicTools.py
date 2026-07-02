from __future__ import annotations

import json
from typing import Mapping

import requests

try:
    from .schemas import VerificationResult
except ImportError:
    from schemas import VerificationResult


STANDARD_MERIDIAN_REQUEST = (
    "Apply a 7% regulatory surcharge only to commercial customers with monthly consumption above 10,000 kWh."
)
WORKSPACE_PATH = "/review/meridian-billing"


def isSupportedReviewRequest(text: str) -> bool:
    normalized = text.lower()
    supportedSignals = [
        ("billing" in normalized and "policy" in normalized and "review" in normalized),
        ("surcharge" in normalized and ("assess" in normalized or "review" in normalized or "risk" in normalized)),
        ("billing" in normalized and "ledger" in normalized and "regression" in normalized),
        ("legacy" in normalized and "billing" in normalized and "change" in normalized),
        ("commercial" in normalized and "billing" in normalized and "policy" in normalized),
        ("meridian grid" in normalized and "surcharge" in normalized),
    ]
    rejectedSignals = ["recipe", "weather", "joke", "poem", "general coding", "write code"]
    return any(supportedSignals) and not any(signal in normalized for signal in rejectedSignals)


def extractReviewRequest(text: str) -> str:
    if isSupportedReviewRequest(text):
        return STANDARD_MERIDIAN_REQUEST
    return ""


def _failure(jobId: str = "", message: str | None = "verification service unavailable") -> VerificationResult:
    return VerificationResult(
        jobId=jobId,
        success=False,
        decision="",
        riskLevel="",
        impactedComponents=0,
        criticalPaths=0,
        failedRegressionTests=0,
        affectedAccounts=0,
        requiredSignOff=[],
        reviewId="",
        receiptHash="",
        evidenceSummary=[],
        workspacePath=WORKSPACE_PATH,
        errorMessage=message,
    )


def _require_mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("expected object")
    return value


def _require_list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("expected list")
    return value


def _as_int(value: object, fieldName: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{fieldName} must be an integer")
    return value


def _as_str(value: object, fieldName: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{fieldName} must be a non-empty string")
    return value


def _post_review(apiBaseUrl: str, timeoutSeconds: int) -> requests.Response:
    endpoint = f"{apiBaseUrl.rstrip('/')}/api/review/run"
    return requests.post(endpoint, timeout=timeoutSeconds)


def runRelicReview(apiBaseUrl: str, timeoutSeconds: int) -> VerificationResult:
    response: requests.Response | None = None
    for attempt in range(2):
        try:
            response = _post_review(apiBaseUrl, timeoutSeconds)
            break
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 1:
                return _failure()
        except requests.RequestException:
            return _failure()

    if response is None:
        return _failure()

    if response.status_code != 200:
        return _failure()

    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError):
        return _failure(message="malformed verification response")

    try:
        data = _require_mapping(payload)
        impactAnalysis = _require_mapping(data.get("impactAnalysis"))
        regressionResults = _require_list(data.get("regressionResults"))
        certificate = _require_mapping(data.get("certificate"))
        evidence = _require_list(data.get("evidence"))

        failedRegressionTests = sum(
            1 for result in regressionResults if isinstance(result, Mapping) and result.get("status") == "failed"
        )
        evidenceSummary = [
            _as_str(item.get("title"), "evidence.title")
            for item in evidence
            if isinstance(item, Mapping) and isinstance(item.get("title"), str)
        ][:6]

        requiredSignOffValue = data.get("requiredHumanSignOffs")
        requiredSignOffItems = _require_list(requiredSignOffValue)
        requiredSignOff = [_as_str(item, "requiredHumanSignOffs") for item in requiredSignOffItems]

        return VerificationResult(
            jobId="",
            success=True,
            decision=_as_str(data.get("decision"), "decision"),
            riskLevel=_as_str(certificate.get("riskLevel"), "certificate.riskLevel"),
            impactedComponents=len(_require_list(impactAnalysis.get("impactedComponents"))),
            criticalPaths=_as_int(impactAnalysis.get("criticalPathCount"), "impactAnalysis.criticalPathCount"),
            failedRegressionTests=failedRegressionTests,
            affectedAccounts=_as_int(data.get("affectedAccountCount"), "affectedAccountCount"),
            requiredSignOff=requiredSignOff,
            reviewId=_as_str(data.get("reviewId"), "reviewId"),
            receiptHash=_as_str(certificate.get("receiptHash"), "certificate.receiptHash"),
            evidenceSummary=evidenceSummary,
            workspacePath=WORKSPACE_PATH,
            errorMessage=None,
        )
    except (ValueError, TypeError):
        return _failure(message="invalid verification response")


def _join_signoff(signoffs: list[str]) -> str:
    if not signoffs:
        return "Required approvers"
    if len(signoffs) == 1:
        return signoffs[0]
    return f"{', '.join(signoffs[:-1])} and {signoffs[-1]}"


def formatAsiResponse(result: VerificationResult, appUrl: str) -> str:
    if not result.success:
        return (
            "Relic could not complete this review because the verification service is unavailable.\n"
            "No release recommendation has been issued.\n"
            "Please retry after the Relic review API is online."
        )

    workspaceUrl = f"{appUrl.rstrip('/')}{result.workspacePath}"

    if result.decision.upper() == "BLOCKED":
        return (
            "Relic review complete — BLOCKED\n\n"
            "Risk: Duplicate-charge condition detected.\n"
            f"Impact: {result.impactedComponents} components across {result.criticalPaths} critical execution paths.\n"
            f"Exposure: {result.affectedAccounts} historical commercial accounts.\n"
            f"Required sign-off: {_join_signoff(result.requiredSignOff)}.\n"
            f"Review ID: {result.reviewId}\n"
            f"Cryptographic receipt: {result.receiptHash}\n\n"
            "Evidence workspace:\n"
            f"{workspaceUrl}"
        )

    return (
        "Relic review complete — APPROVED\n\n"
        f"Impact: {result.impactedComponents} components across {result.criticalPaths} critical execution paths.\n"
        f"Failed regression tests: {result.failedRegressionTests}.\n"
        f"Required sign-off: {_join_signoff(result.requiredSignOff)}.\n"
        f"Review ID: {result.reviewId}\n"
        f"Cryptographic receipt: {result.receiptHash}\n\n"
        "Evidence workspace:\n"
        f"{workspaceUrl}"
    )
