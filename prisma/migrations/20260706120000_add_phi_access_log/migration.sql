-- CreateTable
CREATE TABLE "phi_access_log" (
    "id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "user_id" UUID,
    "profile_id" UUID,
    "patient_account_id" UUID,
    "organization_id" UUID,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "patient_id" UUID,
    "action" TEXT NOT NULL DEFAULT 'VIEW',
    "resource" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "purpose" TEXT,
    "request_id" TEXT,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phi_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phi_access_log_patient_id_at_idx" ON "phi_access_log"("patient_id", "at");

-- CreateIndex
CREATE INDEX "phi_access_log_subject_type_subject_id_at_idx" ON "phi_access_log"("subject_type", "subject_id", "at");

-- CreateIndex
CREATE INDEX "phi_access_log_organization_id_at_idx" ON "phi_access_log"("organization_id", "at");

-- CreateIndex
CREATE INDEX "phi_access_log_user_id_at_idx" ON "phi_access_log"("user_id", "at");
