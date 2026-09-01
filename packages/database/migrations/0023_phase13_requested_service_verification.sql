alter table marketplace_services
  add column if not exists verification_requested_at timestamptz;

create index if not exists marketplace_services_requested_verification_idx
  on marketplace_services (verification_requested_at desc nulls last);
