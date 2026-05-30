import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Resend } from 'resend';
import authConfig from '@config/auth.config.js';

interface ResendErrorShape {
  statusCode?: number;
  message?: string;
}

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly logger = new Logger(EmailService.name);
  private readonly maxSendAttempts = 3;
  private readonly otpTtlMinutes: number;
  private readonly invitationExpireHours: number;

  constructor(
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
  ) {
    this.resend = new Resend(config.resend.apiKey);
    this.fromEmail = config.resend.fromEmail;
    this.otpTtlMinutes = config.verificationCodes.otpTtlMinutes;
    this.invitationExpireHours = config.invitationExpireHours;
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'Your verification code',
      html: this.renderEmail({
        title: 'Verify your email',
        bodyHtml: `
          <p>Use the code below to verify your email address. It expires in <strong>${this.otpTtlMinutes} minutes</strong>.</p>
          ${this.renderCode(code)}
          <p style="color:#888;font-size:0.85rem">If you didn't request this, you can safely ignore this email.</p>
        `,
      }),
    });
  }

  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'Reset your password',
      html: this.renderEmail({
        title: 'Reset your password',
        bodyHtml: `
          <p>Use the code below to reset your password. It expires in <strong>${this.otpTtlMinutes} minutes</strong>.</p>
          ${this.renderCode(code)}
          <p style="color:#888;font-size:0.85rem">If you didn't request this, you can safely ignore this email.</p>
        `,
      }),
    });
  }

  async sendStaffInvitationEmail(to: string, inviteUrl: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'You have been invited to join an organization',
      html: this.renderEmail({
        title: "You're invited!",
        bodyHtml: `
          <p>You have been invited to join an organization on Cradlen. Click the button below to set your password and get started.</p>
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">
            Accept Invitation
          </a>
          <p style="color:#888;font-size:0.85rem;margin-top:1rem">This invitation expires in ${this.invitationExpireHours} hours. If you didn't expect this, you can safely ignore it.</p>
        `,
      }),
    });
  }

  /** Shared responsive email shell. Keeps copy/markup consistent across emails. */
  private renderEmail(params: { title: string; bodyHtml: string }): string {
    return `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>${params.title}</h2>
        ${params.bodyHtml}
      </div>
    `;
  }

  private renderCode(code: string): string {
    return `
      <div style="font-size:2rem;font-weight:bold;letter-spacing:0.5rem;padding:1rem;background:#f5f5f5;text-align:center;border-radius:8px">
        ${code}
      </div>
    `;
  }

  private async sendWithRetry(
    to: string,
    payload: Parameters<Resend['emails']['send']>[0],
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxSendAttempts; attempt += 1) {
      const { error } = await this.resend.emails.send(payload);
      if (!error) return;

      lastError = error;
      const { statusCode, message } = this.describeResendError(error);

      // Permanent failures (e.g. 422 invalid recipient) won't succeed on retry —
      // fail fast instead of burning attempts and quota.
      if (!this.isRetryableError(statusCode)) {
        this.logger.error({
          message: 'Resend failed with non-retryable error',
          to,
          attempt,
          statusCode,
          errorMessage: message,
        });
        throw new InternalServerErrorException('Failed to send email');
      }

      this.logger.warn({
        message: 'Resend email attempt failed',
        to,
        attempt,
        statusCode,
        errorMessage: message,
      });

      if (attempt < this.maxSendAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    const { statusCode, message } = this.describeResendError(lastError);
    this.logger.error({
      message: 'Resend failed after retries',
      to,
      statusCode,
      errorMessage: message,
    });
    throw new InternalServerErrorException('Failed to send email');
  }

  /** Retry only transient failures: network errors (no status), 429, or 5xx. */
  private isRetryableError(statusCode: number | undefined): boolean {
    if (statusCode === undefined) return true;
    return statusCode === 429 || statusCode >= 500;
  }

  private describeResendError(error: unknown): ResendErrorShape {
    const shape = (error ?? {}) as ResendErrorShape;
    return {
      statusCode:
        typeof shape.statusCode === 'number' ? shape.statusCode : undefined,
      message: typeof shape.message === 'string' ? shape.message : undefined,
    };
  }
}
