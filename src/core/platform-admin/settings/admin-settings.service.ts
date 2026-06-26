import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type {
  AdminSettingsDto,
  UpdateAdminSettingsDto,
} from './dto/admin-settings.dto.js';

/**
 * Reads/writes the singleton platform-settings row. The row is created lazily on
 * first access with schema defaults, so the Settings page always has something to
 * render even on a fresh database. `free_trial_days` here is the source of truth
 * for new-org trial length (see OrganizationsService).
 */
@Injectable()
export class AdminSettingsService {
  constructor(private readonly prismaService: PrismaService) {}

  async get(): Promise<AdminSettingsDto> {
    return this.toDto(await this.ensureRow());
  }

  async update(dto: UpdateAdminSettingsDto): Promise<AdminSettingsDto> {
    const current = await this.ensureRow();
    const updated = await this.prismaService.db.platformSetting.update({
      where: { id: current.id },
      data: {
        ...(dto.instapay_handle !== undefined
          ? { instapay_handle: dto.instapay_handle }
          : {}),
        ...(dto.wallet_number !== undefined
          ? { wallet_number: dto.wallet_number }
          : {}),
        ...(dto.free_trial_days !== undefined
          ? { free_trial_days: dto.free_trial_days }
          : {}),
        ...(dto.auto_verify_gateway_payments !== undefined
          ? { auto_verify_gateway_payments: dto.auto_verify_gateway_payments }
          : {}),
        ...(dto.default_currency !== undefined
          ? { default_currency: dto.default_currency }
          : {}),
      },
    });
    return this.toDto(updated);
  }

  /** The platform-configured trial length, falling back to the schema default. */
  async freeTrialDays(): Promise<number> {
    const row = await this.prismaService.db.platformSetting.findFirst();
    return row?.free_trial_days ?? 14;
  }

  private async ensureRow() {
    const existing = await this.prismaService.db.platformSetting.findFirst();
    if (existing) return existing;
    return this.prismaService.db.platformSetting.create({ data: {} });
  }

  private toDto(row: {
    instapay_handle: string | null;
    wallet_number: string | null;
    free_trial_days: number;
    auto_verify_gateway_payments: boolean;
    default_currency: string;
  }): AdminSettingsDto {
    return {
      instapay_handle: row.instapay_handle,
      wallet_number: row.wallet_number,
      free_trial_days: row.free_trial_days,
      auto_verify_gateway_payments: row.auto_verify_gateway_payments,
      default_currency: row.default_currency,
    };
  }
}
