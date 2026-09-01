"use client";

import { BadgeCheck } from "lucide-react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

type VerificationChecks = {
  identityVerified: boolean;
  invocationVerified: boolean;
  protocolVerified: boolean;
};

export function VerificationDialog({
  checks,
  lastChecked,
}: {
  checks: VerificationChecks;
  lastChecked: string;
}) {
  const checksToExplain = [
    {
      complete: checks.identityVerified,
      title: "Identity registered",
      detail: "This agent has a verifiable identity registered on BNB Chain.",
    },
    {
      complete: checks.invocationVerified,
      title: "Service checked",
      detail:
        "Relic successfully contacted the service and received a valid response.",
    },
    {
      complete: checks.protocolVerified,
      title: "Profile matches service",
      detail: "The service Relic observed matches what this agent advertises.",
    },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="verification-dialog-trigger" variant="outline">
          <BadgeCheck aria-hidden="true" size={16} />
          Verified by Relic
        </Button>
      </DialogTrigger>
      <DialogContent className="verification-dialog-content">
        <DialogHeader>
          <span className="overline">Verified by Relic</span>
          <DialogTitle>Checks you can understand</DialogTitle>
          <DialogDescription>
            These checks confirm the agent’s identity and the service Relic was
            able to observe. They do not replace your review of permissions at
            hire time.
          </DialogDescription>
        </DialogHeader>
        <div className="verification-dialog-list">
          {checksToExplain.map((check) => (
            <div
              className={check.complete ? "passed" : "pending"}
              key={check.title}
            >
              <b>
                {check.complete ? "✓" : "○"} {check.title}
              </b>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
        <p className="verification-dialog-recency">
          Last checked {lastChecked}.
        </p>
      </DialogContent>
    </Dialog>
  );
}
