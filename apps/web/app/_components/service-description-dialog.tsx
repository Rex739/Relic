"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

const DESCRIPTION_PREVIEW_LENGTH = 180;

export function ServiceDescription({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  const hasMore = description.length > DESCRIPTION_PREVIEW_LENGTH;
  const preview = hasMore
    ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`
    : description;

  return (
    <div className="service-description">
      <p>{preview}</p>
      {hasMore ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              className="on-chain-data-trigger service-description-trigger"
              type="button"
            >
              View all
            </button>
          </DialogTrigger>
          <DialogContent className="description-dialog-content">
            <DialogHeader>
              <span className="overline">Service description</span>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
