-- CreateTable
CREATE TABLE "visit_investigation_attachments" (
    "id" UUID NOT NULL,
    "investigation_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "source" "InvestigationResultSource" NOT NULL DEFAULT 'PATIENT',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_investigation_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_investigation_attachments_investigation_id_is_deleted_idx" ON "visit_investigation_attachments"("investigation_id", "is_deleted");

-- AddForeignKey
ALTER TABLE "visit_investigation_attachments" ADD CONSTRAINT "visit_investigation_attachments_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "visit_investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
