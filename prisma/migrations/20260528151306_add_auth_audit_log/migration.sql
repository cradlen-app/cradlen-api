-- CreateTable
CREATE TABLE "auth_audit_log" (
    "id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_audit_log_user_id_created_at_idx" ON "auth_audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_log_event_name_created_at_idx" ON "auth_audit_log"("event_name", "created_at");

-- AddForeignKey
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
