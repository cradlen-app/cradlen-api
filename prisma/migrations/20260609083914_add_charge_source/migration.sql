-- CreateEnum
CREATE TYPE "ChargeSource" AS ENUM ('DOCTOR', 'RECEPTION', 'SYSTEM');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN     "source" "ChargeSource" NOT NULL DEFAULT 'RECEPTION';
