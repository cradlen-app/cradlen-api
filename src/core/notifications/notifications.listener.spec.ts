import { Logger } from '@nestjs/common';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_CODES } from './notification-codes';
import {
  InvitationAcceptedEvent,
  InvitationDeclinedEvent,
} from '@core/org/invitations/invitations.public';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let service: { create: jest.Mock };

  const acceptedEvent = new InvitationAcceptedEvent({
    invitationId: 'inv-1',
    recipientProfileId: 'profile-inviter',
    inviteeName: 'Sara Ahmed',
    organizationId: 'org-1',
    branchId: 'branch-1',
  });

  beforeEach(() => {
    service = { create: jest.fn().mockResolvedValue(undefined) };
    listener = new NotificationsListener(
      service as unknown as NotificationsService,
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
