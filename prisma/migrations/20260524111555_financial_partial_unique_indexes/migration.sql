-- Enforce single default price list per org/branch scope
CREATE UNIQUE INDEX "price_lists_default_org_branch_unique"
ON "price_lists"("organization_id", "branch_id")
WHERE "is_default" = true AND "is_deleted" = false;

-- Enforce unique system-wide service codes (where organization_id IS NULL)
CREATE UNIQUE INDEX "services_system_code_unique"
ON "services"("code")
WHERE "organization_id" IS NULL;

-- Enforce single org-level provider price override per (provider, service, org) when branch_id IS NULL
CREATE UNIQUE INDEX "provider_price_overrides_org_level_unique"
ON "provider_price_overrides"("profile_id", "service_id", "organization_id")
WHERE "branch_id" IS NULL AND "is_deleted" = false;
