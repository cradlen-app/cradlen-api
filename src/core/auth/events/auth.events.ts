/**
 * Auth domain events catalog.
 *
 * Single source of truth for event names emitted by the auth module.
 * Consumers subscribe via `@OnEvent('<name>')` from `@nestjs/event-emitter`.
 * Publishers go through `EventBus.publish(name, payload)` from
 * `@infrastructure/messaging/event-bus` — do not call `emit` directly.
 */

export const AUTH_EVENTS = {
  signup: {
    completed: 'auth.signup.completed',
  },
  login: {
    succeeded: 'auth.login.succeeded',
    failed: 'auth.login.failed',
  },
  passwordReset: {
    completed: 'auth.password_reset.completed',
  },
  refresh: {
    rotated: 'auth.refresh.rotated',
  },
} as const;

export interface AuthSignupCompletedPayload {
  user_id: string;
  organization_id: string;
  profile_id: string;
  email: string;
  completed_at: Date;
}

export interface AuthLoginSucceededPayload {
  user_id: string;
  email: string;
  at: Date;
}

export type AuthLoginFailureReason =
  | 'invalid_credentials'
  | 'inactive'
  | 'not_found';

export interface AuthLoginFailedPayload {
  email: string;
  reason: AuthLoginFailureReason;
  at: Date;
}

export interface AuthPasswordResetCompletedPayload {
  user_id: string;
  target: string;
  completed_at: Date;
}

export interface AuthRefreshRotatedPayload {
  user_id: string;
  profile_id: string;
  organization_id: string;
  old_jti: string;
  new_jti: string;
  rotated_at: Date;
}
