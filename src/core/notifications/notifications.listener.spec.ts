import { Logger } from '@nestjs/common';
import { ChargeSource, Prisma } from '@prisma/client';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_CODES } from './notification-codes';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  InvitationAcceptedEvent,
  InvitationDeclinedEvent,
} from '@core/org/invitations/invitations.public';
import type { ChargeCapturedEvent } from '@core/financial/financial.public';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: { create: jest.Mock };
  let db: {
    profile: { findMany: jest.Mock; findUnique: jest.Mock };
    patient: { findUnique: jest.Mock };
    service: { findUnique: jest.Mock };
  };

  const acceptedEvent = new InvitationAcceptedEvent({
    invitationId: 'inv-1',
    recipientProfileId: 'profile-inviter',
    inviteeName: 'Sara Ahmed',
    organizationId: 'org-1',
    branchId: 'branch-1',
  });

  const chargeEvent = (
    overrides: Partial<ChargeCapturedEvent> = {},
  ): ChargeCapturedEvent => ({
    charge_id: 'chg-1',
    organization_id: 'org-1',
    branch_id: 'branch-1',
    patient_id: 'pat-1',
    visit_id: 'visit-1',
    service_id: 'svc-1',
    amount: new Prisma.Decimal('200.00'),
    pricing_source: 'CUSTOM',
    source: ChargeSource.DOCTOR,
    captured_by_id: 'doc-1',
    ...overrides,
  });

  beforeEach(() => {
    service = { create: jest.fn().mockResolvedValue(undefined) };
    db = {
      profile: { findMany: jest.fn(), findUnique: jest.fn() },
      patient: { findUnique: jest.fn() },
      service: { findUnique: jest.fn() },
    };
    listener = new NotificationsListener(
      service as unknown as NotificationsService,
      { db } as unknown as PrismaService,
    );
  });

  it('creates a profile-scoped notification on invitation.accepted', async () => {
    await listener.handleInvitationAccepted(acceptedEvent);

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'profile-inviter',
        code: NOTIFICATION_CODES.INVITATION_ACCEPTED.code,
        category: NOTIFICATION_CODES.INVITATION_ACCEPTED.category,
        description: 'Sara Ahmed accepted your invitation.',
        navigateTo: '/org-1/branch-1/dashboard/staff/invitations/inv-1',
        metadata: { invitationId: 'inv-1', inviteeName: 'Sara Ahmed' },
      }),
    );
  });

  it('omits the branch segment from navigateTo when branchId is null', async () => {
    await listener.handleInvitationDeclined(
      new InvitationDeclinedEvent({
        invitationId: 'inv-2',
        recipientProfileId: 'profile-inviter',
        inviteeName: 'Lina Omar',
        organizationId: 'org-1',
        branchId: null,
      }),
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'profile-inviter',
        description: 'Lina Omar declined your invitation.',
        navigateTo: '/org-1/dashboard/staff/invitations/inv-2',
      }),
    );
  });

  it('notifies the ordering doctor on investigation.result_uploaded', async () => {
    await listener.handleInvestigationResultUploaded({
      investigation_id: 'inv-9',
      visit_id: 'visit-9',
      ordered_by_id: 'doctor-1',
      organization_id: 'org-1',
      branch_id: 'branch-1',
      patient_id: 'pat-1',
      patient_name: 'Ebtesam Alaa',
      test_name: 'Complete blood count (CBC)',
    });

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'doctor-1',
        code: NOTIFICATION_CODES.INVESTIGATION_RESULT_UPLOADED.code,
        category: NOTIFICATION_CODES.INVESTIGATION_RESULT_UPLOADED.category,
        description:
          'Ebtesam Alaa uploaded a result for Complete blood count (CBC).',
        navigateTo: '/org-1/branch-1/dashboard/visits/visit-9',
        metadata: {
          investigationId: 'inv-9',
          visitId: 'visit-9',
          patientId: 'pat-1',
        },
      }),
    );
  });

  it('notifies each branch receptionist when a doctor adds a service charge', async () => {
    db.profile.findMany.mockResolvedValue([
      { id: 'recep-1' },
      { id: 'recep-2' },
    ]);
    db.patient.findUnique.mockResolvedValue({ full_name: 'Jane Doe' });
    db.profile.findUnique.mockResolvedValue({
      user: { first_name: 'Sara', last_name: 'Ali' },
    });
    db.service.findUnique.mockResolvedValue({ name: 'Consultation' });

    await listener.handleChargeCaptured(chargeEvent());

    expect(service.create).toHaveBeenCalledTimes(2);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'recep-1',
        code: NOTIFICATION_CODES.SERVICE_CHARGE_ADDED.code,
        category: 'billing',
        description: 'Dr. Sara Ali added "Consultation" for Jane Doe.',
        navigateTo: '/org-1/branch-1/dashboard/visits/visit-1',
        metadata: expect.objectContaining({
          chargeId: 'chg-1',
          patientId: 'pat-1',
        }),
      }),
    );
  });

  it('does not notify reception for a reception-entered charge', async () => {
    await listener.handleChargeCaptured(
      chargeEvent({ source: ChargeSource.RECEPTION }),
    );

    expect(db.profile.findMany).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('no-ops when the branch has no receptionists', async () => {
    db.profile.findMany.mockResolvedValue([]);

    await listener.handleChargeCaptured(chargeEvent());

    expect(service.create).not.toHaveBeenCalled();
  });

  it('swallows and logs a create failure so the invite flow is unaffected', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service.create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      listener.handleInvitationAccepted(acceptedEvent),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
