-- M4 — invitations_hardening
--
-- - @unique on token_hash so token lookups hit an index and DB rejects collisions.
-- - Composite (status, expires_at) for the expire-stale-invites scan.
-- - Partial unique on (organization_id, email) WHERE status='PENDING' AND is_deleted=false
--   to stop duplicate live invites in the same org.

CREATE UNIQUE INDEX invitations_token_hash_key ON invitations(token_hash);
CREATE INDEX invitations_status_expires_at_idx ON invitations(status, expires_at);
CREATE UNIQUE INDEX invitations_org_email_pending_unique
    ON invitations(organization_id, email)
    WHERE status = 'PENDING' AND is_deleted = false;
