import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';

/**
 * Patient-portal integration helpers. A portal session is authenticated by the
 * live `PatientJwtStrategy`, which only verifies the access secret + `type` and
 * resolves the account/accessible-patient scope from the DB. So a spec can mint
 * a `patient_access` token directly (no HTTP signup) and exercise the real guard
 * against a seeded `PatientAccount`.
 */
const jwt = new JwtService({});

/** Mint a patient-portal access token the PatientJwtStrategy will accept. */
export function patientToken(accountId: string, patientId: string): string {
  return jwt.sign(
    { accountId, patientId, type: 'patient_access' },
    { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
  );
}

/**
 * Create an active `PatientAccount` for a seeded patient and return its id plus
 * a ready-to-use portal access token scoped to that patient.
 */
export async function createPatientAccount(
  prisma: PrismaClient,
  patientId: string,
): Promise<{ accountId: string; token: string }> {
  const account = await prisma.patientAccount.create({
    data: { patient_id: patientId, is_active: true },
  });
  return {
    accountId: account.id,
    token: patientToken(account.id, patientId),
  };
}
