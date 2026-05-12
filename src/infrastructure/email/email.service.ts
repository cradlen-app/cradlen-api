import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AuthConfig } from '@config/auth.config.js';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly logger = new Logger(EmailService.name);
  private readonly maxSendAttempts = 3;

  constructor(private readonly configService: ConfigService) {
    const authConfig = this.configService.get<AuthConfig>('auth');
    if (!authConfig) throw new Error('Auth configuration not loaded');
    this.resend = new Resend(authConfig.resend.apiKey);
    this.fromEmail = authConfig.resend.fromEmail;
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'Your verification code',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2>Verify your email</h2>
          <p>Use the code below to verify your email address. It expires in <strong>15 minutes</strong>.</p>
          <div style="font-size:2rem;font-weight:bold;letter-spacing:0.5rem;padding:1rem;background:#f5f5f5;text-align:center;border-radius:8px">
            ${code}
          </div>
          <p style="color:#888;font-size:0.85rem">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
  }

  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'Reset your password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2>Reset your password</h2>
          <p>Use the code below to reset your password. It expires in <strong>15 minutes</strong>.</p>
          <div style="font-size:2rem;font-weight:bold;letter-spacing:0.5rem;padding:1rem;background:#f5f5f5;text-align:center;border-radius:8px">
            ${code}
          </div>
          <p style="color:#888;font-size:0.85rem">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
  }

  async sendStaffInvitationEmail(to: string, inviteUrl: string): Promise<void> {
    await this.sendWithRetry(to, {
      from: this.fromEmail,
      to,
      subject: 'You have been invited to join an organization',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2>You're invited!</h2>
          <p>You have been invited to join an organization on Cradlen. Click the button below to set your password and get started.</p>
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">
            Accept Invitation
          </a>
          <p style="color:#888;font-size:0.85rem;margin-top:1rem">This invitation expires in 72 hours. If you didn't expect this, you can safely ignore it.</p>
        </div>
      `,
    });
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
      this.logger.warn({
        message: 'Resend email attempt failed',
        to,
        attempt,
        statusCode: (error as { statusCode?: unknown }).statusCode,
        errorMessage: (error as { message?: unknown }).message,
      });

      if (attempt < this.maxSendAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    this.logger.error({
      message: 'Resend failed after retries',
      to,
      statusCode: (lastError as { statusCode?: unknown } | undefined)
        ?.statusCode,
      errorMessage: (lastError as { message?: unknown } | undefined)?.message,
    });
    throw new InternalServerErrorException('Failed to send email');
  }
}
