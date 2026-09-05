"use client";

import { Trash2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { removeSavedHireSetup } from "../mandate-actions";

export function RemoveSavedHireSetup({
  agentId,
  mandateId,
  offerId,
}: {
  agentId: string;
  mandateId: string;
  offerId: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="existing-setup-remove" type="button">
          <Trash2 aria-hidden="true" size={15} />
          Remove
        </button>
      </DialogTrigger>
      <DialogContent className="remove-setup-dialog">
        <DialogHeader>
          <span className="overline">Remove saved setup</span>
          <DialogTitle>Remove this monitoring setup?</DialogTitle>
          <DialogDescription>
            This revokes its read-only mandate and removes it from your saved
            setups. It cannot move funds or submit a transaction.
          </DialogDescription>
        </DialogHeader>
        <form action={removeSavedHireSetup}>
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="mandateId" value={mandateId} />
          <input type="hidden" name="offerId" value={offerId} />
          <DialogFooter>
            <DialogClose className="ui-button ui-button-outline ui-button-size-default">
              Keep setup
            </DialogClose>
            <button
              className="ui-button ui-button-destructive ui-button-size-default"
              type="submit"
            >
              Remove setup
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
