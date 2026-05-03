-- Prevent duplicate pending invitations for the same email within an account.
-- The partial index fires only when status = 'PENDING' and the record is not soft-deleted,
-- so accepted/cancelled/expired invitations are never counted against the uniqueness constraint.
CREATE UNIQUE INDEX invitations_account_email_pending_idx
  ON invitations (account_id, email)
  WHERE status = 'PENDING' AND is_deleted = false;
