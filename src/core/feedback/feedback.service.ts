import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { CreateFeedbackDto } from './dto/feedback.dto.js';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async submit(user: AuthContext, dto: CreateFeedbackDto) {
    const displayName = await this.resolveDisplayName(user.profileId);

    const suggestion = await this.prisma.db.featureSuggestion.create({
      data: {
        category: dto.category,
        message: dto.message.trim(),
        credit_consent: dto.credit_consent ?? false,
        display_name: displayName,
        profile_id: user.profileId,
        organization_id: user.organizationId,
        branch_id: user.activeBranchId ?? null,
        role: user.role,
        page_url: dto.page_url,
        app_version: dto.app_version,
        locale: dto.locale,
      },
    });

    // Best-effort team notification: a mail failure must never fail the
    // submission — the suggestion is already safely persisted.
    try {
      await this.emailService.sendFeedbackEmail({
        category: suggestion.category,
        message: suggestion.message,
        displayName,
        role: user.role,
        organizationId: user.organizationId,
        branchId: user.activeBranchId ?? null,
        creditConsent: suggestion.credit_consent,
        pageUrl: suggestion.page_url,
        appVersion: suggestion.app_version,
        locale: suggestion.locale,
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to send feedback notification email',
        suggestionId: suggestion.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      id: suggestion.id,
      category: suggestion.category,
      status: suggestion.status,
      created_at: suggestion.created_at,
    };
  }

  /** Snapshot of the submitter's name for triage + future public credit. */
  private async resolveDisplayName(profileId: string): Promise<string> {
    const profile = await this.prisma.db.profile.findUnique({
      where: { id: profileId },
      select: { user: { select: { first_name: true, last_name: true } } },
    });
    if (!profile) return 'Unknown user';
    return `${profile.user.first_name} ${profile.user.last_name}`.trim();
  }
}
