export interface JwtAccessPayload {
  userId: string;
  profileId: string;
  accountId: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  userId: string;
  profileId?: string;
  accountId?: string;
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
