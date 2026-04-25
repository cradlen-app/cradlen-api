export interface JwtAccessPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface RegistrationTokenPayload {
  sub: string;
  type: 'registration';
  iat?: number;
  exp?: number;
}

export interface PasswordResetTokenPayload {
  sub: string;
  email: string;
  type: 'password_reset';
  verified: boolean;
  iat?: number;
  exp?: number;
}
