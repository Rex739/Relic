-- Zero-value ERC-8183 calls are protocol lifecycle transitions, not economic
-- movements. Keep them in operations/artifacts/settlements and prevent the
-- append-only value ledger from implying that money moved.
ALTER TABLE public.commerce_value_movements
  DROP CONSTRAINT commerce_value_movements_amount_nonnegative,
  ADD CONSTRAINT commerce_value_movements_amount_positive CHECK (amount_base_units > 0);--> statement-breakpoint
