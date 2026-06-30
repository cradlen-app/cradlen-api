import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { FeedbackService } from './feedback.service.js';
import type { CreateFeedbackDto } from './dto/feedback.dto.js';

const user: AuthContext = {
  userId: 'user-1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  activeBranchId: 'branch-1',
  role: 'OWNER',
  jobFunction: 'DOCTOR',
  branchIds: ['branch-1'],
};

const dto: CreateFeedbackDto = {
  category: 'FEATURE',
  message: '  Filter visits by doctor please  ',
  credit_consent: true,
  page_url: '/en/org/branch/dashboard/calendar',
  app_version: '1.2.3',
  locale: 'en',
};

function makeService(overrides?: {
  create?: jest.Mock;
  findUnique?: jest.Mock;
  sendFeedbackEmail?: jest.Mock;
}) {
  const create =
    overrides?.create ??
    jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'sg-1',
        status: 'NEW',
        created_at: new Date('2026-06-30T00:00:00Z'),
        ...data,
      }),
    );
  const findUnique =
    overrides?.findUnique ??
    jest.fn().mockResolvedValue({
      user: { first_name: 'Sara', last_name: 'Ahmed' },
    });
  const sendFeedbackEmail =
    overrides?.sendFeedbackEmail ?? jest.fn().mockResolvedValue(undefined);

  const prisma = {
    db: {
      featureSuggestion: { create },
      profile: { findUnique },
    },
  } as unknown as PrismaService;
  const email = { sendFeedbackEmail } as unknown as EmailService;

  return {
    service: new FeedbackService(prisma, email),
    create,
    findUnique,
    sendFeedbackEmail,
  };
}

describe('FeedbackService', () => {
  it('persists a trimmed suggestion with snapshotted submitter + context', async () => {
    const { service, create, sendFeedbackEmail } = makeService();

    const result = await service.submit(user, dto);

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.category).toBe('FEATURE');
    expect(data.message).toBe('Filter visits by doctor please');
    expect(data.credit_consent).toBe(true);
    expect(data.display_name).toBe('Sara Ahmed');
    expect(data.profile_id).toBe('profile-1');
    expect(data.organization_id).toBe('org-1');
    expect(data.branch_id).toBe('branch-1');
    expect(data.role).toBe('OWNER');

    expect(sendFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: 'sg-1',
      category: 'FEATURE',
      status: 'NEW',
      created_at: expect.any(Date),
    });
  });

  it('falls back to "Unknown user" when the profile is missing', async () => {
    const { service, create } = makeService({
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await service.submit(user, dto);

    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.display_name).toBe('Unknown user');
  });

  it('still succeeds when the notification email fails', async () => {
    const { service } = makeService({
      sendFeedbackEmail: jest.fn().mockRejectedValue(new Error('resend down')),
    });

    await expect(service.submit(user, dto)).resolves.toEqual(
      expect.objectContaining({ id: 'sg-1', status: 'NEW' }),
    );
  });
});
