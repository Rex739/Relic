from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from uagents import Model


class ReviewJob(Model):
    jobId: str
    requestedChange: str
    systemName: str
    riskSensitivity: str
    requestedBy: str
    createdAt: str
    replyToAgent: str


class VerificationResult(Model):
    jobId: str
    success: bool
    decision: str
    riskLevel: str
    impactedComponents: int
    criticalPaths: int
    failedRegressionTests: int
    affectedAccounts: int
    requiredSignOff: list[str]
    reviewId: str
    receiptHash: str
    evidenceSummary: list[str]
    workspacePath: str
    errorMessage: Optional[str]


@dataclass(frozen=True)
class ReviewRequestState:
    originalSender: str
    createdAt: datetime
    requestedChange: str
