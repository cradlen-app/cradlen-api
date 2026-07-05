-- CreateTable
CREATE TABLE "patient_push_subscriptions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_push_subscriptions_endpoint_key" ON "patient_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "patient_push_subscriptions_account_id_idx" ON "patient_push_subscriptions"("account_id");

-- AddForeignKey
ALTER TABLE "patient_push_subscriptions" ADD CONSTRAINT "patient_push_subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
