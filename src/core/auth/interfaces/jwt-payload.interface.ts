export interface JwtAccessPayload {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

/**
 * Short-lived ticket the browser passes in the Socket.IO handshake
 * (`handshake.auth.token`). Minted from a valid access token via
 * `POST /auth/ws-ticket` so the real access token can stay httpOnly and never
 * reach client JS. Mirrors the access-token claims the gateway needs to derive
 * room membership (`profileId`, `activeBranchId`).
 */
export interface JwtWsTicketPayload {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  type: 'ws';
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  userId: string;
  profileId?: string;
  organizationId?: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

export interface SignupTokenPayload {
  userId: string;
  type: 'signup' | 'profile_selection';
  iat?: number;
  exp?: number;
}

export interface PasswordResetTokenPayload {
  userId: string;
  target: string;
  jti: string;
  type: 'password_reset';
  verified: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Short-lived token bridging patient self-signup step 1 (identity match) and
 * step 2 (set password). No User exists yet, so the subject is the matched
 * Patient/Guardian row.
 */
export interface PatientSignupTokenPayload {
  subjectType: 'PATIENT' | 'GUARDIAN';
  subjectId: string;
  type: 'patient_signup';
  iat?: number;
  exp?: number;
}

/**
 * Access token for a self-registered patient/guardian. Carries no
 * profile/organization — the patient-facing strategy validates `type` and
 * loads a PatientAuthContext instead of a staff ProfileContext.
 */
export interface JwtPatientAccessPayload {
  userId: string;
  patientId?: string;
  guardianId?: string;
  type: 'patient_access';
  iat?: number;
  exp?: number;
}

export interface JwtPatientRefreshPayload {
  userId: string;
  patientId?: string;
  guardianId?: string;
  jti: string;
  type: 'patient_refresh';
  iat?: number;
  exp?: number;
}
