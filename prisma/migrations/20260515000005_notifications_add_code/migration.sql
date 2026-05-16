-- M5 — notifications_add_code
--
-- Adds the stable machine `code` column to notifications and an index on
-- (user_id, code, is_deleted). Backfills existing rows from `category` so the
-- catalog mapping at @core/notifications/notification-codes.ts becomes the
-- single source of truth.

ALTER TABLE notifications ADD COLUMN code TEXT;
UPDATE notifications SET code = CASE
    WHEN category = 'staff' AND title ILIKE '%accepted%' THEN 'invitation.accepted'
    WHEN category = 'staff' AND title ILIKE '%declined%' THEN 'invitation.declined'
    ELSE category
END;
ALTER TABLE notifications ALTER COLUMN code SET NOT NULL;

CREATE INDEX notifications_user_code_deleted_idx
    ON notifications(user_id, code, is_deleted);
