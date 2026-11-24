-- Technical serialization boundary only. Do not impose an invented business
-- planning window. PostgreSQL infinity/BC/five-digit years cannot round-trip
-- through the app's YYYY-MM-DD date contract.
begin;
alter table public.nam_tasks add constraint nam_tasks_due_date_supported
 check(due_date is null or (due_date>=date '0001-01-01 AD' and due_date<=date '9999-12-31 AD'));
commit;
