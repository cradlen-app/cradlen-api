-- Replace the hard unique on (organization_id, code) with a partial unique on
-- live rows only — soft-deleted medications should not block reuse of the
-- same code. Mirrors the prescription_items_prescription_id_order_live_unique
-- index added in 20260515000009_prescription_audit_and_integrity.

DROP INDEX IF EXISTS "medications_organization_id_code_key";

CREATE UNIQUE INDEX medications_organization_id_code_live_unique
    ON medications(organization_id, code)
    WHERE is_deleted = false;
