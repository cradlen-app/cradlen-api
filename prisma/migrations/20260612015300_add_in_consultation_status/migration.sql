-- AlterEnum
-- Adds the doctor-driven consultation state between IN_PROGRESS (reception
-- queue) and COMPLETED. Safe inside Prisma's migration transaction on
-- PostgreSQL 12+ because the new value is not referenced in this migration.
ALTER TYPE "VisitStatus" ADD VALUE 'IN_CONSULTATION' AFTER 'IN_PROGRESS';

-- AlterTable
-- Records when the doctor actually began the consultation (IN_CONSULTATION),
-- kept separate from started_at (queue entry / IN_PROGRESS).
ALTER TABLE "visits" ADD COLUMN "consultation_started_at" TIMESTAMP(3);
