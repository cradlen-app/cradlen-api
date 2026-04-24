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
