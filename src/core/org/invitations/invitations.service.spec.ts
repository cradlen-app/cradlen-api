import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus } from '@prisma/client';
import { InvitationsService } from './invitations.service';
import { hashInvitationToken } from './invitations.tokens';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

describe('InvitationsService.acceptInvitation', () => {
  let service: InvitationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let txClient: jest.Mock;
  let eventBus: { publish: jest.Mock };
  let subscriptions: { assertStaffLimit: jest.Mock };
  const RAW_TOKEN = 'good-token';
  let tokenHash: string;

  const buildInvitation = (
    overrides: Partial<{
      status: InvitationStatus;
      expires_at: Date;
    }> = {},
  ) => ({
    id: 'inv-1',
    organization_id: 'org-1',
    invited_by_id: 'user-inv-1',
    email: 'invitee@cradlen.com',
    first_name: 'Sara',
    last_name: 'Ahmed',
    phone_number: '+201111111111',
    executive_title: null,
    engagement_type: 'FULL_TIME',
    status: overrides.status ?? InvitationStatus.PENDING,
    token_hash: tokenHash,
    expires_at: overrides.expires_at ?? new Date(Date.now() + 60 * 60 * 1000),
    accepted_at: null,
    is_deleted: false,
    branches: [
      {
        branch_id: 'branch-1',
        branch: { id: 'branch-1', name: 'Main' },
      },
    ],
    roles: [{ role_id: 'role-1', role: { id: 'role-1', name: 'STAFF' } }],
    job_functions: [],
    specialty_links: [],
    invited_by: {
      id: 'user-inv-1',
      first_name: 'Inviter',
      last_name: 'One',
      email: 'inviter@cradlen.com',
    },
  });

  beforeEach(async () => {
    tokenHash = hashInvitationToken(RAW_TOKEN);

    db = {
      invitation: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      profile: {
        upsert: jest.fn(),
        count: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
      },
      profileRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      profileBranch: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      profileJobFunction: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      profileSpecialty: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // $transaction: forward to the callback with the same db handle
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db)),
    };
    txClient = db.$transaction;
    eventBus = { publish: jest.fn() };
    subscriptions = { assertStaffLimit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: { db } },
        {
          provide: AuthorizationService,
          useValue: {},
        },
        { provide: EmailService, useValue: {} },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: EventBus, useValue: eventBus },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'app'
                ? { appUrl: 'https://app.cradlen.com' }
                : { invitationExpireHours: 48 },
          },
        },
      ],
    }).compile();

    service = module.get(InvitationsService);
  });

  it('claims the invitation, provisions user+profile, and emits invitation.accepted', async () => {
    const invitation = buildInvitation();
    db.invitation.findFirst.mockResolvedValueOnce(invitation);
    db.user.findFirst.mockResolvedValue(null); // out-of-tx pre-check + in-tx lookup
    db.invitation.updateMany.mockResolvedValueOnce({ count: 1 });
    db.user.create.mockResolvedValueOnce({ id: 'user-2' });
    db.profile.upsert.mockResolvedValueOnce({ id: 'profile-2' });

    const result = await service.acceptInvitation({
      invitation_id: 'inv-1',
      token: RAW_TOKEN,
      password: 'StrongPass1!',
    });

    expect(result).toEqual({
      user_id: 'user-2',
      profile_id: 'profile-2',
      organization_id: 'org-1',
    });
    expect(txClient).toHaveBeenCalledTimes(1);
    expect(db.profileRole.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      'invitation.accepted',
      expect.objectContaining({
        invitationId: 'inv-1',
        organizationId: 'org-1',
        branchId: 'branch-1',
        inviteeName: 'Sara Ahmed',
      }),
    );
  });

  it('throws 401 when the token does not match the invitation', async () => {
    db.invitation.findFirst.mockResolvedValueOnce(buildInvitation());
    await expect(
      service.acceptInvitation({
        invitation_id: 'inv-1',
        token: 'wrong-token',
        password: 'StrongPass1!',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(txClient).not.toHaveBeenCalled();
  });

  it('throws 409 when the invitation is already ACCEPTED', async () => {
    db.invitation.findFirst.mockResolvedValueOnce(
      buildInvitation({ status: InvitationStatus.ACCEPTED }),
    );
    await expect(
      service.acceptInvitation({
        invitation_id: 'inv-1',
        token: RAW_TOKEN,
        password: 'StrongPass1!',
      }),
    ).rejects.toThrow(ConflictException);
    expect(txClient).not.toHaveBeenCalled();
  });

  it('rolls back when the subscription staff limit is reached inside the tx', async () => {
    db.invitation.findFirst.mockResolvedValueOnce(buildInvitation());
    db.user.findFirst.mockResolvedValue(null);
    db.invitation.updateMany.mockResolvedValueOnce({ count: 1 });
    subscriptions.assertStaffLimit.mockRejectedValueOnce(
      new ForbiddenException('Staff limit reached'),
    );

    await expect(
      service.acceptInvitation({
        invitation_id: 'inv-1',
        token: RAW_TOKEN,
        password: 'StrongPass1!',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.profile.upsert).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
