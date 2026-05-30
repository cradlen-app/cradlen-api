import { InternalServerErrorException } from '@nestjs/common';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// Imported after the mock so the constructor's `new Resend()` is stubbed.
import { EmailService } from './email.service.js';

function makeService(): EmailService {
  return new EmailService({
    resend: { apiKey: 'key', fromEmail: 'noreply@test.dev' },
    verificationCodes: { otpTtlMinutes: 15 },
    invitationExpireHours: 72,
  } as never);
}

describe('EmailService.sendWithRetry', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns after a single send when there is no error', async () => {
    mockSend.mockResolvedValue({ error: null });
    const service = makeService();

    await service.sendVerificationEmail('to@test.dev', '123456');

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a non-retryable 4xx error (no retries)', async () => {
    mockSend.mockResolvedValue({
      error: { statusCode: 422, message: 'invalid recipient' },
    });
    const service = makeService();

    await expect(
      service.sendVerificationEmail('bad@test.dev', '123456'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('retries transient 5xx errors up to the attempt cap', async () => {
    mockSend.mockResolvedValue({ error: { statusCode: 503 } });
    const service = makeService();

    await expect(
      service.sendPasswordResetEmail('to@test.dev', '123456'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('recovers when a transient error is followed by success', async () => {
    mockSend
      .mockResolvedValueOnce({ error: { statusCode: 503 } })
      .mockResolvedValueOnce({ error: null });
    const service = makeService();

    await service.sendStaffInvitationEmail('to@test.dev', 'https://app/invite');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
