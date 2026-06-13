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
    visit: { findFirst: jest.Mock };
    invoice: { findFirst: jest.Mock };
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
      visit: { findFirst: jest.fn() },
      invoice: { findFirst: jest.fn() },
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
    db.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
    db.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });

    await listener.handleChargeCaptured(chargeEvent());

    expect(service.create).toHaveBeenCalledTimes(2);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'recep-1',
        code: NOTIFICATION_CODES.SERVICE_CHARGE_ADDED.code,
        category: 'billing',
        description: 'Dr. Sara Ali added "Consultation" for Jane Doe.',
        // Deep-links straight to the case invoice's detail page so reception can
        // collect — booking already created it before the doctor's mid-visit add.
        navigateTo: '/org-1/branch-1/dashboard/financial/invoices/inv-1',
        metadata: expect.objectContaining({
          chargeId: 'chg-1',
          patientId: 'pat-1',
          visitId: 'visit-1',
          episodeId: 'ep-1',
          invoiceId: 'inv-1',
        }),
      }),
    );
  });

  it('falls back to the episode-scoped search page when the invoice does not exist yet', async () => {
    db.profile.findMany.mockResolvedValue([{ id: 'recep-1' }]);
    db.patient.findUnique.mockResolvedValue({ full_name: 'Jane Doe' });
    db.profile.findUnique.mockResolvedValue({
      user: { first_name: 'Sara', last_name: 'Ali' },
    });
    db.service.findUnique.mockResolvedValue({ name: 'Consultation' });
    db.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
    // Rare failed-booking-accrual: the open invoice isn't there yet.
    db.invoice.findFirst.mockResolvedValue(null);

    await listener.handleChargeCaptured(chargeEvent());

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        navigateTo: '/org-1/branch-1/dashboard/financial/invoices?episode=ep-1',
        metadata: expect.objectContaining({ episodeId: 'ep-1', invoiceId: null }),
      }),
    );
  });

  it('falls back to the bare invoices path when the charge has no visit', async () => {
    db.profile.findMany.mockResolvedValue([{ id: 'recep-1' }]);
    db.patient.findUnique.mockResolvedValue({ full_name: 'Jane Doe' });
    db.profile.findUnique.mockResolvedValue({
      user: { first_name: 'Sara', last_name: 'Ali' },
    });
    db.service.findUnique.mockResolvedValue({ name: 'Consultation' });

    await listener.handleChargeCaptured(chargeEvent({ visit_id: null }));

    expect(db.visit.findFirst).not.toHaveBeenCalled();
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        navigateTo: '/org-1/branch-1/dashboard/financial/invoices',
        metadata: expect.objectContaining({
          visitId: null,
          episodeId: null,
          invoiceId: null,
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
