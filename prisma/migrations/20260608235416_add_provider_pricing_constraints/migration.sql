-- DropIndex
DROP INDEX "provider_services_profile_id_service_id_organization_id_bra_key";

-- CreateIndex
CREATE INDEX "provider_services_profile_id_service_id_organization_id_bra_idx" ON "provider_services"("profile_id", "service_id", "organization_id", "branch_id");

-- One LIVE authorization per (provider, service, org, branch) scope. Partial
-- unique — excludes soft-deleted rows so re-authorizing after a revoke works;
-- COALESCE collapses NULL branch_id so org-wide authorizations also dedupe.
CREATE UNIQUE INDEX "provider_services_one_active_per_scope"
  ON "provider_services" ("profile_id", "service_id", "organization_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "is_deleted" = false;

-- One LIVE price override per (provider, service, org, branch) scope.
CREATE UNIQUE INDEX "provider_price_overrides_one_active_per_scope"
  ON "provider_price_overrides" ("profile_id", "service_id", "organization_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "is_deleted" = false;
