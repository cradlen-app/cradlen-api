import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AuthConfig } from '../../config/auth.config.js';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {
    const authConfig = this.configService.get<AuthConfig>('auth');
    if (!authConfig) throw new Error('Auth configuration not loaded');
    this.resend = new Resend(authConfig.resend.apiKey);
    this.fromEmail = authConfig.resend.fromEmail;
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    const { error } = await this.resend.emails.send({
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

    if (error) {
      this.logger.error(`Resend failed to ${to}: ${JSON.stringify(error)}`);
      throw new InternalServerErrorException('Failed to send verification email');
    }
  }
}
