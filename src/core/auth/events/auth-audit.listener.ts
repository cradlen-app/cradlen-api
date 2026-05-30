import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import {
  AUTH_EVENTS,
  type AuthLoginFailedPayload,
  type AuthLoginSucceededPayload,
  type AuthPasswordResetCompletedPayload,
  type AuthRefreshRotatedPayload,
  type AuthSignupCompletedPayload,
} from './auth.events.js';

/**
 * Materializes every AUTH_EVENTS firing into the auth_audit_log table.
 *
 * Subscribers run AFTER the publishing service returns to the caller,
 * so a listener failure cannot fail the user-facing request. Each
 * handler still wraps its write in a try/catch + log so a single bad
 * row never silently disables the audit trail.
 */
@Injectable()
export class AuthAuditListener {
  private readonly logger = new Logger(AuthAuditListener.name);

  constructor(private readonly prismaService: PrismaService) {}

  @OnEvent(AUTH_EVENTS.signup.completed)
  async onSignupCompleted(payload: AuthSignupCompletedPayload): Promise<void> {
    await this.write({
      event_name: AUTH_EVENTS.signup.completed,
      user_id: payload.user_id,
      email: payload.email,
      payload,
      at: payload.completed_at,
    });
  }

  @OnEvent(AUTH_EVENTS.login.succeeded)
  async onLoginSucceeded(payload: AuthLoginSucceededPayload): Promise<void> {
    await this.write({
      event_name: AUTH_EVENTS.login.succeeded,
      user_id: payload.user_id,
      email: payload.email,
      payload,
      at: payload.at,
    });
  }

  @OnEvent(AUTH_EVENTS.login.failed)
  async onLoginFailed(payload: AuthLoginFailedPayload): Promise<void> {
    await this.write({
      event_name: AUTH_EVENTS.login.failed,
      // No user_id — the credentials didn't resolve to anyone, or
      // matched a row we deliberately don't want to associate with
      // a failure event in the audit trail.
      user_id: null,
      email: payload.email,
      payload,
      at: payload.at,
    });
  }

  @OnEvent(AUTH_EVENTS.passwordReset.completed)
  async onPasswordResetCompleted(
    payload: AuthPasswordResetCompletedPayload,
  ): Promise<void> {
    await this.write({
      event_name: AUTH_EVENTS.passwordReset.completed,
      user_id: payload.user_id,
      email: payload.target,
      payload,
      at: payload.completed_at,
    });
  }

  @OnEvent(AUTH_EVENTS.refresh.rotated)
  async onRefreshRotated(payload: AuthRefreshRotatedPayload): Promise<void> {
    await this.write({
      event_name: AUTH_EVENTS.refresh.rotated,
      user_id: payload.user_id,
      email: null,
      payload,
      at: payload.rotated_at,
    });
  }

  private async write(data: {
    event_name: string;
    user_id: string | null;
    email: string | null;
    payload: object;
    at: Date;
  }): Promise<void> {
    try {
      await this.prismaService.db.authAuditLog.create({
        data: {
          event_name: data.event_name,
          user_id: data.user_id,
          email: data.email,
          // The payload is already a plain object literal from the
          // emitter; serialize through Prisma's Json column.
          payload: data.payload,
          at: data.at,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write auth audit log for ${data.event_name}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
