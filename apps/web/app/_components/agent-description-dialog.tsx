"use client";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

const DESCRIPTION_PREVIEW_LENGTH = 280;

export function AgentDescription({
  description,
  agentName,
}: {
  description: string;
  agentName: string;
}) {
  const hasMore = description.length > DESCRIPTION_PREVIEW_LENGTH;
  const preview = hasMore
    ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`
    : description;

  return (
    <div className="profile-description">
      <p>{preview}</p>
      {hasMore ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button className="description-dialog-trigger" variant="outline">
              View more
            </Button>
          </DialogTrigger>
          <DialogContent className="description-dialog-content">
            <DialogHeader>
              <span className="overline">About this agent</span>
              <DialogTitle>{agentName}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
