import { JwtService } from '@nestjs/jwt';

const jwt = new JwtService({});

export function signAccessToken(payload: {
  sub: string;
  email: string;
}): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: '15m',
    },
  );
}

export function signRefreshToken(payload: {
  sub: string;
  jti: string;
}): string {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: '7d',
    },
  );
}

export function signRegistrationToken(
  userId: string,
  verified = false,
): string {
  return jwt.sign(
    { sub: userId, type: 'registration', verified },
    { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '30m' },
  );
}

export function signExpiredToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, {
    secret: process.env.JWT_ACCESS_SECRET!,
    expiresIn: '-1s',
  });
}

// A secret that is NOT the access secret — a token signed with this is a
// forgery and the verifier must reject it on signature alone.
const BOGUS_SECRET = 'bogus-secret-definitely-not-the-access-one-32+';

/** Well-formed `access` token signed with the wrong secret → must 401. */
export function signWithWrongSecret(payload: Record<string, unknown>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    { secret: BOGUS_SECRET, expiresIn: '15m' },
  );
}

/**
 * Token signed with the REAL access secret but carrying an arbitrary `type`
 * claim (e.g. 'refresh' / 'password_reset' / 'patient_access') — exercises the
 * JwtStrategy `type !== 'access'` rejection.
 */
export function signWithType(
  payload: Record<string, unknown>,
  type: string,
): string {
  return jwt.sign(
    { ...payload, type },
    { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
  );
}

/**
 * A hand-assembled `{"alg":"none"}` JWT (header.payload. with an empty
 * signature) — asserts the verifier refuses unsigned tokens.
 */
export function signAlgNone(payload: Record<string, unknown>): string {
  const encode = (obj: object): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const body = encode({ ...payload, type: 'access' });
  return `${header}.${body}.`;
}
