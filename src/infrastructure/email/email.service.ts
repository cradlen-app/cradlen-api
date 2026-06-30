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

export interface FeedbackEmailPayload {
  category: string;
  message: string;
  displayName: string;
  role: string;
  organizationId: string;
  branchId: string | null;
  creditConsent: boolean;
  pageUrl?: string | null;
  appVersion?: string | null;
  locale?: string | null;
}

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly feedbackNotifyEmail: string;
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
    this.feedbackNotifyEmail = config.resend.feedbackNotifyEmail;
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

  async sendAdminInviteEmail(to: string, inviteUrl: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'You have been added as a Cradlen platform admin',
      html: this.renderEmail({
        title: 'Set your admin password',
        bodyHtml: `
          <p>You have been added as a platform admin on Cradlen. Click the button below to set your password and sign in.</p>
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">
            Set your password
          </a>
          <p style="color:#888;font-size:0.85rem;margin-top:1rem">This link expires in ${this.invitationExpireHours} hours. If you weren't expecting this, you can safely ignore it.</p>
        `,
      }),
    });
  }

  async sendFeedbackEmail(payload: FeedbackEmailPayload): Promise<void> {
    const meta: Array<[string, string]> = [
      ['Category', payload.category],
      ['From', payload.displayName],
      ['Role', payload.role],
      ['Organization', payload.organizationId],
      ['Branch', payload.branchId ?? '—'],
      ['Credit consent', payload.creditConsent ? 'Yes' : 'No'],
      ['Page', payload.pageUrl ?? '—'],
      ['App version', payload.appVersion ?? '—'],
      ['Locale', payload.locale ?? '—'],
    ];
    const metaHtml = meta
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${this.escapeHtml(
            label,
          )}</td><td style="padding:4px 0">${this.escapeHtml(value)}</td></tr>`,
      )
      .join('');

    await this.sendWithRetry(this.feedbackNotifyEmail, {
      from: this.fromEmail,
      to: this.feedbackNotifyEmail,
      subject: `New Cradlen feedback: ${payload.category}`,
      html: this.renderEmail({
        title: 'New product feedback',
        bodyHtml: `
          <div style="white-space:pre-wrap;padding:1rem;background:#f5f5f5;border-radius:8px;margin-bottom:1rem">${this.escapeHtml(
            payload.message,
          )}</div>
          <table style="font-size:0.9rem;border-collapse:collapse">${metaHtml}</table>
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

  /** Escape user-supplied text before embedding it in email HTML. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
