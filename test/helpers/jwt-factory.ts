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
