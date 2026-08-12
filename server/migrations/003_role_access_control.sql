-- Role model for the self-hosted RBAC layer:
-- admin = full access, manager = legacy alias of admin, warehouse = inventory,
-- cashier = POS/shift/report, customer = buyer catalog.

alter table if exists public.profiles
  drop constraint if exists profiles_role_check,
  add constraint profiles_role_check
    check (role in ('admin','manager','warehouse','cashier','customer')) not valid;
