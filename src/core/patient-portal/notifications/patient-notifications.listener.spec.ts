import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientNotificationsService } from './patient-notifications.service.js';
import type { PatientPushService } from '@core/patient-portal/push/patient-push.service.js';
import type { InvestigationReviewedEvent } from '@core/clinical/events/events.public.js';
import { PatientNotificationsListener } from './patient-notifications.listener.js';
import { PATIENT_NOTIFICATION_CODES } from './patient-notification-codes.js';

describe('PatientNotificationsListener', () => {
  let listener: PatientNotificationsListener;
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let sendToPatient: jest.Mock;

  const journey = { patient_id: 'p1', organization_id: 'org-1' };
  const visitWith = (over: Record<string, unknown>) => ({
    prescription: null,
    investigations: [],
    episode: { journey },
    ...over,
  });
  const completed = { payload: { id: 'v1', status: 'COMPLETED' } };

  beforeEach(() => {
    findUnique = jest.fn();
    create = jest.fn().mockResolvedValue({
      id: 'notif-x',
      patient_id: 'p1',
      title: 'Title',
      description: 'Description',
      navigate_to: '/x',
    });
    sendToPatient = jest.fn();
    const prisma = {
      db: { visit: { findUnique } },
    } as unknown as PrismaService;
    listener = new PatientNotificationsListener(
      prisma,
      { create } as unknown as PatientNotificationsService,
      { sendToPatient } as unknown as PatientPushService,
    );
  });

  it('ignores non-COMPLETED status transitions', async () => {
    await listener.handleVisitStatusUpdated({
      payload: { id: 'v1', status: 'CANCELLED' },
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('notifies the patient when their investigation is reviewed', async () => {
    await listener.handleInvestigationReviewed({
      investigation_id: 'inv-1',
      visit_id: 'v1',
      patient_id: 'p1',
      organization_id: 'org-1',
      test_name: 'CBC',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'p1',
        organizationId: 'org-1',
        code: PATIENT_NOTIFICATION_CODES.INVESTIGATION_REVIEWED.code,
        navigateTo: '/tests',
        metadata: { investigationId: 'inv-1', visitId: 'v1' },
      }),
    );
  });

  it('notifies the patient about a new prescription', async () => {
    findUnique.mockResolvedValue(
      visitWith({ prescription: { items: [{ id: 'i1' }] } }),
    );
    await listener.handleVisitStatusUpdated(completed);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'p1',
        organizationId: 'org-1',
        code: PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.code,
        navigateTo: '/medications',
        metadata: { visitId: 'v1' },
      }),
    );
  });

  it('notifies the patient about newly ordered tests', async () => {
    findUnique.mockResolvedValue(
      visitWith({ investigations: [{ id: 'inv1' }] }),
    );
    await listener.handleVisitStatusUpdated(completed);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: PATIENT_NOTIFICATION_CODES.VISIT_INVESTIGATION_ORDERED.code,
        navigateTo: '/tests',
      }),
    );
  });

  it('sends both notifications when the visit has a prescription and tests', async () => {
    findUnique.mockResolvedValue(
      visitWith({
        prescription: { items: [{ id: 'i1' }] },
        investigations: [{ id: 'inv1' }],
      }),
    );
    await listener.handleVisitStatusUpdated(completed);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('creates nothing when the visit has neither (empty prescription, no tests)', async () => {
    findUnique.mockResolvedValue(
      visitWith({ prescription: { items: [] }, investigations: [] }),
    );
    await listener.handleVisitStatusUpdated(completed);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates nothing when the visit resolves no journey', async () => {
    findUnique.mockResolvedValue({
      prescription: { items: [{ id: 'i1' }] },
      investigations: [],
      episode: null,
    });
    await listener.handleVisitStatusUpdated(completed);
    expect(create).not.toHaveBeenCalled();
  });
});

function makeDeps(created: {
  patient_id: string;
  title: string;
  description: string;
  navigate_to: string | null;
  id: string;
}) {
  const prisma = {} as unknown as PrismaService;
  const create = jest.fn().mockResolvedValue(created);
  const notifications = {
    create,
  } as unknown as PatientNotificationsService;
  const sendToPatient = jest.fn();
  const push = {
    sendToPatient,
  } as unknown as PatientPushService;
  return { prisma, notifications, push, create, sendToPatient };
}

const reviewedEvent = {
  patient_id: 'patient-1',
  organization_id: 'org-1',
  investigation_id: 'inv-1',
  visit_id: 'visit-1',
  test_name: 'CBC',
} as unknown as InvestigationReviewedEvent;

describe('PatientNotificationsListener push dispatch', () => {
  it('pushes to the patient after creating an investigation-reviewed notification', async () => {
    const created = {
      id: 'notif-1',
      patient_id: 'patient-1',
      title: 'Result reviewed',
      description: 'Your CBC result has been reviewed.',
      navigate_to: '/tests',
    };
    const { prisma, notifications, push, sendToPatient } = makeDeps(created);
    const listener = new PatientNotificationsListener(
      prisma,
      notifications,
      push,
    );

    await listener.handleInvestigationReviewed(reviewedEvent);

    expect(sendToPatient).toHaveBeenCalledWith('patient-1', {
      title: created.title,
      body: created.description,
      navigate_to: created.navigate_to,
      tag: created.id,
    });
  });

  it('does not throw out of the handler when create fails', async () => {
    const prisma = {} as unknown as PrismaService;
    const notifications = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PatientNotificationsService;
    const sendToPatient = jest.fn();
    const push = { sendToPatient } as unknown as PatientPushService;
    const listener = new PatientNotificationsListener(
      prisma,
      notifications,
      push,
    );

    await expect(
      listener.handleInvestigationReviewed(reviewedEvent),
    ).resolves.toBeUndefined();
    expect(sendToPatient).not.toHaveBeenCalled();
  });
});
