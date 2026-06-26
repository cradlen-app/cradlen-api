-- Platform-admin invite flow: a newly added admin is created with no password
-- and sets one via an emailed single-use link. The invite token is stored in
-- verification_codes under this dedicated purpose (distinct from ADMIN_LOGIN).

-- AlterEnum
ALTER TYPE "VerificationPurpose" ADD VALUE 'ADMIN_SET_PASSWORD';
